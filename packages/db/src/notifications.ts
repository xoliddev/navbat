/**
 * Transactional outbox for Telegram messages. Services enqueue jobs in the same transaction as
 * the booking change; the bot worker claims due jobs, renders them with @navbat/core templates
 * and sends them. Nothing is lost if Telegram is down and nothing is sent for rolled-back work.
 */
import {
  addDays,
  type Lang,
  MS,
  type NotificationKind,
  type NotificationPayload,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from '@navbat/core';
import { sql } from 'kysely';
import { toCard } from './booking-read.js';
import { getBusiness } from './catalog.js';
import { type AppContext, type Db, json, ms } from './context.js';
import type { BookingDTO, NotificationDTO } from './dto.js';
import type { NotificationJobRow } from './schema.js';

export interface Recipient {
  audience: 'customer' | 'staff';
  chatId: number;
  lang: Lang;
}

export interface EnqueueInput {
  businessId: string;
  bookingId: string | null;
  kind: NotificationKind;
  recipient: Recipient;
  payload: NotificationPayload;
  sendAt: number;
  dedupeKey?: string;
}

export async function enqueue(db: Db, job: EnqueueInput): Promise<void> {
  await db
    .insertInto('notification_jobs')
    .values({
      business_id: job.businessId,
      booking_id: job.bookingId,
      kind: job.kind,
      audience: job.recipient.audience,
      chat_id: job.recipient.chatId,
      lang: job.recipient.lang,
      payload: json(job.payload),
      send_at: new Date(job.sendAt),
      dedupe_key: job.dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

export async function customerRecipient(db: Db, customerId: string): Promise<Recipient | null> {
  const c = await db
    .selectFrom('customers')
    .select(['telegram_user_id', 'lang'])
    .where('id', '=', customerId)
    .executeTakeFirst();
  if (!c?.telegram_user_id) return null;
  return { audience: 'customer', chatId: c.telegram_user_id, lang: c.lang };
}

/** Owners/admins plus the booking's master, each once, if they have Telegram linked. */
export async function staffRecipients(
  db: Db,
  businessId: string,
  masterId: string | null,
): Promise<Recipient[]> {
  const rows = await db
    .selectFrom('staff')
    .select(['id', 'telegram_user_id', 'lang', 'role'])
    .where('business_id', '=', businessId)
    .where('active', '=', true)
    .where('telegram_user_id', 'is not', null)
    .execute();
  const seen = new Set<number>();
  const out: Recipient[] = [];
  for (const r of rows) {
    if (r.role === 'master' && r.id !== masterId) continue;
    if (!r.telegram_user_id || seen.has(r.telegram_user_id)) continue;
    seen.add(r.telegram_user_id);
    out.push({ audience: 'staff', chatId: r.telegram_user_id, lang: r.lang });
  }
  return out;
}

type BookingKind = Exclude<NotificationKind, 'admin_running_late' | 'master_digest'>;

export async function notifyBooking(
  db: Db,
  ctx: { now: number; timeZone: string },
  booking: BookingDTO,
  businessId: string,
  kind: BookingKind,
  recipients: Recipient[],
  opts: { sendAt?: number; dedupe?: string } = {},
): Promise<void> {
  for (const r of recipients) {
    await enqueue(db, {
      businessId,
      bookingId: booking.id,
      kind,
      recipient: r,
      payload: { kind, card: toCard(booking, r.lang, ctx.timeZone), bookingId: booking.id },
      sendAt: opts.sendAt ?? ctx.now,
      dedupeKey: opts.dedupe ? `${opts.dedupe}:${r.chatId}` : undefined,
    });
  }
}

/** Schedules 24h and 2h reminders (skipping the ones already in the past). */
export async function scheduleReminders(
  db: Db,
  ctx: { now: number; timeZone: string },
  booking: BookingDTO,
  businessId: string,
): Promise<void> {
  const customer = await customerRecipient(db, booking.customer.id);
  if (!customer) return;
  const plan: [BookingKind, number][] = [
    ['reminder_24h', booking.startAt - 24 * MS.HOUR],
    ['reminder_2h', booking.startAt - 2 * MS.HOUR],
  ];
  for (const [kind, at] of plan) {
    if (at <= ctx.now) continue;
    await notifyBooking(db, ctx, booking, businessId, kind, [customer], {
      sendAt: at,
      dedupe: `${booking.id}:${kind}:${booking.startAt}`,
    });
  }
}

export async function cancelPendingJobs(
  db: Db,
  bookingId: string,
  kinds?: NotificationKind[],
): Promise<void> {
  let q = db
    .updateTable('notification_jobs')
    .set({ status: 'cancelled' })
    .where('booking_id', '=', bookingId)
    .where('status', '=', 'pending');
  if (kinds) q = q.where('kind', 'in', kinds);
  await q.execute();
}

export function toNotification(r: NotificationJobRow): NotificationDTO {
  return {
    id: r.id,
    kind: r.kind,
    audience: r.audience,
    chatId: r.chat_id,
    lang: r.lang,
    payload: r.payload,
    sendAt: ms(r.send_at),
    status: r.status,
    sentAt: r.sent_at ? ms(r.sent_at) : null,
    bookingId: r.booking_id,
  };
}

/** Atomically claims due jobs (FOR UPDATE SKIP LOCKED — safe with several bot replicas). */
export async function claimDueJobs(db: Db, now: number, limit = 25): Promise<NotificationDTO[]> {
  const res = await sql<NotificationJobRow>`
    UPDATE notification_jobs SET status = 'sending', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM notification_jobs
      WHERE status = 'pending' AND send_at <= ${new Date(now)}
      ORDER BY send_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`.execute(db);
  return res.rows.map(toNotification).sort((a, b) => a.sendAt - b.sendAt);
}

export async function markSent(db: Db, id: string, now: number): Promise<void> {
  await db
    .updateTable('notification_jobs')
    .set({ status: 'sent', sent_at: new Date(now), last_error: null })
    .where('id', '=', id)
    .execute();
}

/** Retries with backoff (1, 4, 9, 16 min); gives up after 5 attempts or on a permanent error. */
export async function markFailed(
  db: Db,
  id: string,
  now: number,
  error: string,
  permanent = false,
): Promise<void> {
  const job = await db
    .selectFrom('notification_jobs')
    .select('attempts')
    .where('id', '=', id)
    .executeTakeFirst();
  const attempts = job?.attempts ?? 1;
  const giveUp = permanent || attempts >= 5;
  await db
    .updateTable('notification_jobs')
    .set({
      status: giveUp ? 'failed' : 'pending',
      last_error: error.slice(0, 500),
      send_at: new Date(now + attempts * attempts * MS.MINUTE),
    })
    .where('id', '=', id)
    .execute();
}

export async function markCancelled(db: Db, id: string, reason: string): Promise<void> {
  await db
    .updateTable('notification_jobs')
    .set({ status: 'cancelled', last_error: reason })
    .where('id', '=', id)
    .execute();
}

export async function listNotifications(
  db: Db,
  businessId: string,
  opts: { chatId?: number; limit?: number } = {},
): Promise<NotificationDTO[]> {
  let q = db.selectFrom('notification_jobs').selectAll().where('business_id', '=', businessId);
  if (opts.chatId !== undefined) q = q.where('chat_id', '=', opts.chatId);
  const rows = await q
    .orderBy('send_at')
    .orderBy('created_at')
    .limit(opts.limit ?? 200)
    .execute();
  return rows.map(toNotification);
}

/**
 * Once a day, at the business's digest hour, queues each master's schedule for the day.
 * Idempotent: the dedupe key makes repeated calls (or several workers) harmless.
 */
export async function enqueueDailyDigests(ctx: AppContext, businessId: string): Promise<number> {
  const { db } = ctx;
  const now = ctx.now();
  const business = await getBusiness(db, businessId);
  const tz = business.timezone;
  const local = utcToZoned(now, tz);
  if (local.minute < business.settings.digestHour * 60) return 0;
  const date = todayIn(tz, now);
  const from = zonedToUtc(date, 0, tz);
  const to = zonedToUtc(addDays(date, 1), 0, tz);
  const masters = await db
    .selectFrom('staff')
    .select(['id', 'telegram_user_id', 'lang'])
    .where('business_id', '=', business.id)
    .where('active', '=', true)
    .where('bookable', '=', true)
    .where('telegram_user_id', 'is not', null)
    .execute();
  let queued = 0;
  for (const m of masters) {
    const rows = await db
      .selectFrom('bookings as b')
      .innerJoin('customers as c', 'c.id', 'b.customer_id')
      .select(['b.id', 'b.start_at', 'b.end_at', 'b.notes', 'c.name', 'c.phone'])
      .where('b.staff_id', '=', m.id)
      .where('b.status', 'in', ['confirmed', 'pending'])
      .where('b.start_at', '>=', new Date(from))
      .where('b.start_at', '<', new Date(to))
      .orderBy('b.start_at')
      .execute();
    const items = await db
      .selectFrom('booking_items')
      .select(['booking_id', 'name'])
      .where(
        'booking_id',
        'in',
        rows.length ? rows.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'],
      )
      .orderBy('position')
      .execute();
    const lang = m.lang;
    const before = await db
      .selectFrom('notification_jobs')
      .select('id')
      .where('dedupe_key', '=', `digest:${m.id}:${date}`)
      .executeTakeFirst();
    if (before) continue;
    await enqueue(db, {
      businessId: business.id,
      bookingId: null,
      kind: 'master_digest',
      recipient: { audience: 'staff', chatId: m.telegram_user_id!, lang },
      payload: {
        kind: 'master_digest',
        date,
        timeZone: tz,
        items: rows.map((r) => ({
          startAt: ms(r.start_at),
          endAt: ms(r.end_at),
          services: items.filter((i) => i.booking_id === r.id).map((i) => i.name[lang] ?? i.name.uz ?? ''),
          customerName: r.name,
          customerPhone: r.phone,
          note: r.notes,
        })),
      },
      sendAt: now,
      dedupeKey: `digest:${m.id}:${date}`,
    });
    queued++;
  }
  return queued;
}
