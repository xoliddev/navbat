import {
  type Actor,
  assertRating,
  type BookingEvent,
  type BookingSnapshot,
  bookingCode,
  canReview,
  checkFit,
  DomainError,
  depositAmount,
  type FitFailure,
  type Lang,
  normalizePhone,
  type ProviderId,
  pickOption,
  type SlotOption,
  transition,
  utcToZoned,
} from '@navbat/core';
import { sql, type Transaction } from 'kysely';
import {
  bookableStaffIds,
  dayWindow,
  engineRules,
  loadAvailability,
  loadServiceSpecs,
} from './availability.js';
import { loadBooking, loadBookings, toCard } from './booking-read.js';
import { getBusiness } from './catalog.js';
import { type AppContext, type Db, isSlotConflict, json, ms, pgCode } from './context.js';
import type { BookingDTO, BusinessDTO, CreatedBookingDTO } from './dto.js';
import {
  cancelPendingJobs,
  customerRecipient,
  enqueue,
  notifyBooking,
  scheduleReminders,
  staffRecipients,
} from './notifications.js';
import type { BookingSource, DB } from './schema.js';

const FIT_TO_ERROR: Record<FitFailure, DomainError['code']> = {
  NO_SERVICES: 'VALIDATION',
  SERVICE_NOT_OFFERED: 'SERVICE_NOT_OFFERED',
  IN_PAST: 'TOO_SOON',
  TOO_SOON: 'TOO_SOON',
  OUTSIDE_HORIZON: 'OUTSIDE_HORIZON',
  NOT_WORKING: 'NOT_WORKING',
  CONFLICT: 'SLOT_UNAVAILABLE',
};

function actorLabel(actor: Actor): string {
  if (actor.kind === 'customer') return `customer:${actor.customerId}`;
  if (actor.kind === 'staff') return `staff:${actor.staffId}`;
  return 'system';
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  telegramUserId?: number | null;
  lang?: Lang;
}

/** Finds or creates the customer record (by Telegram id, then by phone). */
export async function upsertCustomer(db: Db, businessId: string, input: CustomerInput): Promise<string> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new DomainError('VALIDATION', 'Name is required');
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone)
    throw new DomainError('VALIDATION', 'Phone number looks wrong', { field: 'phone' });
  if (input.telegramUserId) {
    const existing = await db
      .selectFrom('customers')
      .select(['id', 'phone'])
      .where('business_id', '=', businessId)
      .where('telegram_user_id', '=', input.telegramUserId)
      .executeTakeFirst();
    if (existing) {
      const phoneTaken =
        phone && phone !== existing.phone
          ? await db
              .selectFrom('customers')
              .select('id')
              .where('business_id', '=', businessId)
              .where('phone', '=', phone)
              .executeTakeFirst()
          : undefined;
      await db
        .updateTable('customers')
        .set({
          name,
          ...(phone && !phoneTaken ? { phone } : {}),
          ...(input.lang ? { lang: input.lang } : {}),
        })
        .where('id', '=', existing.id)
        .execute();
      return existing.id;
    }
  }
  if (phone) {
    const byPhone = await db
      .selectFrom('customers')
      .select(['id', 'telegram_user_id'])
      .where('business_id', '=', businessId)
      .where('phone', '=', phone)
      .executeTakeFirst();
    if (byPhone) {
      // Link a phone-only record (created by an admin) to the Telegram account.
      await db
        .updateTable('customers')
        .set({
          name,
          ...(input.telegramUserId && !byPhone.telegram_user_id
            ? { telegram_user_id: input.telegramUserId }
            : {}),
        })
        .where('id', '=', byPhone.id)
        .execute();
      return byPhone.id;
    }
  }
  const row = await db
    .insertInto('customers')
    .values({
      business_id: businessId,
      name,
      phone,
      telegram_user_id: input.telegramUserId ?? null,
      lang: input.lang ?? 'uz',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Updates name/phone of a known customer; a phone that belongs to someone else is ignored. */
export async function updateCustomerContact(
  db: Db,
  businessId: string,
  customerId: string,
  input: CustomerInput,
): Promise<void> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new DomainError('VALIDATION', 'Name is required', { field: 'name' });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone)
    throw new DomainError('VALIDATION', 'Phone number looks wrong', { field: 'phone' });
  const taken = phone
    ? await db
        .selectFrom('customers')
        .select('id')
        .where('business_id', '=', businessId)
        .where('phone', '=', phone)
        .where('id', '<>', customerId)
        .executeTakeFirst()
    : undefined;
  await db
    .updateTable('customers')
    .set({ name, ...(phone && !taken ? { phone } : {}), ...(input.lang ? { lang: input.lang } : {}) })
    .where('id', '=', customerId)
    .execute();
}

/**
 * Serialises writers per master. The exclusion constraint alone is already correct, but
 * concurrent conflicting inserts can deadlock (each waits for the other's index entry) and
 * PostgreSQL resolves that only after deadlock_timeout. A transaction-scoped advisory lock makes
 * racers queue instead, so the loser fails fast with a clean 23P01. Locks are taken in a stable
 * order so two masters never deadlock each other.
 */
export async function lockMasters(trx: Db, staffIds: string[]): Promise<void> {
  for (const id of [...new Set(staffIds)].sort()) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`navbat:staff:${id}`}))`.execute(trx);
  }
}

async function uniqueCode(db: Db, businessId: string, random?: () => number): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = bookingCode(random);
    const exists = await db
      .selectFrom('bookings')
      .select('id')
      .where('business_id', '=', businessId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!exists) return code;
  }
  throw new Error('Could not allocate a booking code');
}

async function bookedMinutesOn(
  db: Db,
  staffIds: string[],
  date: string,
  tz: string,
): Promise<Record<string, number>> {
  const w = dayWindow(date, tz);
  const rows = await db
    .selectFrom('bookings')
    .select(['staff_id', 'start_at', 'end_at'])
    .where('staff_id', 'in', staffIds)
    .where('status', '<>', 'cancelled')
    .where('start_at', '>=', new Date(w.start))
    .where('start_at', '<', new Date(w.end))
    .execute();
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (utcToZoned(ms(r.start_at), tz).date !== date) continue;
    out[r.staff_id] = (out[r.staff_id] ?? 0) + (ms(r.end_at) - ms(r.start_at)) / 60_000;
  }
  return out;
}

export interface CreateBookingInput {
  businessId: string;
  serviceIds: string[];
  /** null = "any master". */
  staffId: string | null;
  start: number;
  actor: Actor;
  /** Required unless the actor is a known customer. */
  customer?: CustomerInput;
  source?: BookingSource;
  notes?: string | null;
}

async function insertBooking(
  trx: Transaction<DB>,
  ctx: AppContext,
  business: BusinessDTO,
  input: CreateBookingInput,
  option: SlotOption,
  customerId: string,
): Promise<{ id: string; deposit: number }> {
  await lockMasters(trx, [option.staffId]);
  const staff = await trx
    .selectFrom('staff')
    .select(['branch_id'])
    .where('id', '=', option.staffId)
    .executeTakeFirstOrThrow();
  const fromMiniApp = (input.source ?? 'miniapp') === 'miniapp';
  const provider = business.settings.paymentProvider;
  const deposit =
    fromMiniApp && provider !== 'none' ? depositAmount(option.price, business.settings.depositPercent) : 0;
  const code = await uniqueCode(trx, business.id, ctx.random);
  const row = await trx
    .insertInto('bookings')
    .values({
      business_id: business.id,
      branch_id: staff.branch_id,
      staff_id: option.staffId,
      customer_id: customerId,
      code,
      status: deposit > 0 ? 'pending' : 'confirmed',
      start_at: new Date(option.start),
      end_at: new Date(option.end),
      occupied_start: new Date(option.occupied.start),
      occupied_end: new Date(option.occupied.end),
      total_price: option.price,
      deposit_amount: deposit,
      payment_status: deposit > 0 ? 'pending' : 'none',
      source: input.source ?? 'miniapp',
      notes: input.notes?.slice(0, 500) ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const services = await trx
    .selectFrom('services')
    .select(['id', 'name'])
    .where('id', 'in', input.serviceIds)
    .execute();
  await trx
    .insertInto('booking_items')
    .values(
      option.plan.items.map((item, position) => ({
        booking_id: row.id,
        service_id: item.serviceId,
        position,
        start_at: new Date(option.start + item.offsetMin * 60_000),
        end_at: new Date(option.start + (item.offsetMin + item.durationMin) * 60_000),
        price: item.price,
        name: json(services.find((s) => s.id === item.serviceId)?.name),
      })),
    )
    .execute();
  await trx
    .insertInto('booking_events')
    .values({
      booking_id: row.id,
      type: 'created',
      actor: actorLabel(input.actor),
      data: json({ source: input.source }),
    })
    .execute();
  return { id: row.id, deposit };
}

/**
 * Creates a booking. Validation happens twice: in the slot engine (friendly reasons) and in
 * PostgreSQL's exclusion constraint (the final word under concurrency). For "any master" a
 * lost race is retried with the next free master.
 */
export async function createBooking(ctx: AppContext, input: CreateBookingInput): Promise<CreatedBookingDTO> {
  const { db } = ctx;
  const business = await getBusiness(db, input.businessId);
  const tz = business.timezone;
  const now = ctx.now();
  const enforce = input.actor.kind === 'customer';
  const services = await loadServiceSpecs(db, business.id, input.serviceIds);
  const candidates = await bookableStaffIds(db, business.id, input.staffId);
  const excluded = new Set<string>();

  for (let attempt = 0; attempt <= candidates.length + 3; attempt++) {
    const pool = candidates.filter((id) => !excluded.has(id));
    const date = utcToZoned(input.start, tz).date;
    const availability = await loadAvailability(db, business.id, pool, dayWindow(date, tz));
    const options: SlotOption[] = [];
    let firstFailure: FitFailure | null = null;
    for (const staff of availability) {
      const fit = checkFit({
        timeZone: tz,
        services,
        staff,
        start: input.start,
        now,
        rules: engineRules(business.settings),
        enforceCustomerRules: enforce,
      });
      if (fit.ok) options.push(fit.option);
      else firstFailure ??= fit.reason;
    }
    if (options.length === 0) {
      const reason = input.staffId ? (firstFailure ?? 'CONFLICT') : 'CONFLICT';
      throw new DomainError(FIT_TO_ERROR[reason], `Slot not available: ${reason}`, { reason });
    }
    const option =
      options.length === 1 ? options[0]! : pickOption(options, await bookedMinutesOn(db, pool, date, tz));

    try {
      const result = await db.transaction().execute(async (trx) => {
        const customerId =
          input.actor.kind === 'customer'
            ? input.actor.customerId
            : await upsertCustomer(trx, business.id, input.customer ?? { name: '' });
        if (input.actor.kind === 'customer' && input.customer) {
          await updateCustomerContact(trx, business.id, customerId, input.customer);
        }
        const { id, deposit } = await insertBooking(trx, ctx, business, input, option, customerId);
        let payment: CreatedBookingDTO['payment'] = null;
        if (deposit > 0) {
          const providerId = business.settings.paymentProvider as ProviderId;
          const provider = ctx.payments?.(providerId);
          if (!provider)
            throw new DomainError('PAYMENT_FAILED', `Payment provider ${providerId} is not configured`);
          const session = await provider.createPayment({
            bookingId: id,
            amount: deposit,
            currency: providerId === 'stars' ? 'XTR' : 'UZS',
            description: `${business.name} — deposit`,
          });
          await trx
            .insertInto('payments')
            .values({
              booking_id: id,
              provider: providerId,
              reference: session.reference,
              amount: deposit,
              currency: providerId === 'stars' ? 'XTR' : 'UZS',
              pay_url: session.payUrl,
            })
            .execute();
          payment = {
            provider: providerId,
            reference: session.reference,
            payUrl: session.payUrl,
            amount: deposit,
          };
        }
        const booking = (await loadBooking(trx, id))!;
        const n = { now, timeZone: tz };
        const customer = await customerRecipient(trx, customerId);
        if (deposit > 0) {
          if (customer)
            await notifyBooking(trx, n, booking, business.id, 'booking_awaiting_payment', [customer]);
        } else {
          await announceConfirmed(trx, n, booking, business.id, input.actor);
        }
        return { booking, payment };
      });
      return result;
    } catch (e) {
      if (isSlotConflict(e)) {
        if (input.staffId) throw new DomainError('SLOT_UNAVAILABLE', 'Someone has just taken this time');
        // Exclusion violation: that master is taken. Deadlock: we don't know who won, so just
        // re-read availability (the winner is committed by now) and try again.
        if (pgCode(e) !== '40P01') excluded.add(option.staffId);
        continue;
      }
      throw e;
    }
  }
  throw new DomainError('SLOT_UNAVAILABLE', 'Someone has just taken this time');
}

async function announceConfirmed(
  db: Db,
  n: { now: number; timeZone: string },
  booking: BookingDTO,
  businessId: string,
  actor: Actor,
): Promise<void> {
  const customer = await customerRecipient(db, booking.customer.id);
  if (customer) await notifyBooking(db, n, booking, businessId, 'booking_confirmed', [customer]);
  await scheduleReminders(db, n, booking, businessId);
  // Staff are told about bookings they did not make themselves.
  if (actor.kind !== 'staff') {
    await notifyBooking(
      db,
      n,
      booking,
      businessId,
      'admin_new_booking',
      await staffRecipients(db, businessId, booking.staffId),
    );
  }
}

async function snapshot(
  db: Db,
  bookingId: string,
  businessId: string,
): Promise<BookingSnapshot & { id: string }> {
  const b = await db
    .selectFrom('bookings')
    .select(['id', 'status', 'customer_id', 'staff_id', 'start_at', 'end_at'])
    .where('id', '=', bookingId)
    .where('business_id', '=', businessId)
    .executeTakeFirst();
  if (!b) throw new DomainError('NOT_FOUND', 'Booking not found');
  return {
    id: b.id,
    status: b.status,
    customerId: b.customer_id,
    staffId: b.staff_id,
    startAt: ms(b.start_at),
    endAt: ms(b.end_at),
  };
}

export async function getBookingFor(
  db: Db,
  businessId: string,
  bookingId: string,
  actor: Actor,
): Promise<BookingDTO> {
  const snap = await snapshot(db, bookingId, businessId);
  if (actor.kind === 'customer' && snap.customerId !== actor.customerId)
    throw new DomainError('NOT_FOUND', 'Booking not found');
  if (actor.kind === 'staff' && actor.role === 'master' && snap.staffId !== actor.staffId) {
    throw new DomainError('FORBIDDEN', 'Not your client');
  }
  return (await loadBooking(db, bookingId))!;
}

export interface RescheduleInput {
  businessId: string;
  bookingId: string;
  start: number;
  /** Move to another master (admin drag between columns). */
  staffId?: string;
  actor: Actor;
}

export async function rescheduleBooking(ctx: AppContext, input: RescheduleInput): Promise<BookingDTO> {
  const { db } = ctx;
  const business = await getBusiness(db, input.businessId);
  const tz = business.timezone;
  const now = ctx.now();
  const snap = await snapshot(db, input.bookingId, business.id);
  transition(snap, 'reschedule', {
    actor: input.actor,
    now,
    cancelWindowMin: business.settings.cancelWindowMin,
  });
  const targetStaff = input.staffId ?? snap.staffId;
  if (input.actor.kind === 'staff' && input.actor.role === 'master' && targetStaff !== input.actor.staffId) {
    throw new DomainError('FORBIDDEN', 'Masters can only move bookings within their own calendar');
  }
  const items = await db
    .selectFrom('booking_items')
    .select('service_id')
    .where('booking_id', '=', input.bookingId)
    .orderBy('position')
    .execute();
  const services = await loadServiceSpecs(
    db,
    business.id,
    items.map((i) => i.service_id),
  ).catch(() => {
    throw new DomainError('VALIDATION', 'A service of this booking is no longer offered');
  });
  await bookableStaffIds(db, business.id, targetStaff);
  const date = utcToZoned(input.start, tz).date;
  const [staff] = await loadAvailability(
    db,
    business.id,
    [targetStaff],
    dayWindow(date, tz),
    input.bookingId,
  );
  const fit = checkFit({
    timeZone: tz,
    services,
    staff: staff!,
    start: input.start,
    now,
    rules: engineRules(business.settings),
    enforceCustomerRules: input.actor.kind === 'customer',
  });
  if (!fit.ok)
    throw new DomainError(FIT_TO_ERROR[fit.reason], `Cannot move here: ${fit.reason}`, {
      reason: fit.reason,
    });
  const option = fit.option;
  try {
    return await db.transaction().execute(async (trx) => {
      await lockMasters(trx, [snap.staffId, option.staffId]);
      await trx
        .updateTable('bookings')
        .set({
          staff_id: option.staffId,
          start_at: new Date(option.start),
          end_at: new Date(option.end),
          occupied_start: new Date(option.occupied.start),
          occupied_end: new Date(option.occupied.end),
          total_price: option.price,
          running_late_min: null,
          updated_at: new Date(now),
        })
        .where('id', '=', input.bookingId)
        .execute();
      for (const [position, item] of option.plan.items.entries()) {
        await trx
          .updateTable('booking_items')
          .set({
            start_at: new Date(option.start + item.offsetMin * 60_000),
            end_at: new Date(option.start + (item.offsetMin + item.durationMin) * 60_000),
            price: item.price,
          })
          .where('booking_id', '=', input.bookingId)
          .where('position', '=', position)
          .execute();
      }
      await trx
        .insertInto('booking_events')
        .values({
          booking_id: input.bookingId,
          type: 'rescheduled',
          actor: actorLabel(input.actor),
          data: json({
            from: snap.startAt,
            to: option.start,
            fromStaff: snap.staffId,
            toStaff: option.staffId,
          }),
        })
        .execute();
      await cancelPendingJobs(trx, input.bookingId, ['reminder_24h', 'reminder_2h']);
      const booking = (await loadBooking(trx, input.bookingId))!;
      const n = { now, timeZone: tz };
      if (booking.status === 'confirmed') await scheduleReminders(trx, n, booking, business.id);
      const customer = await customerRecipient(trx, booking.customer.id);
      if (customer) {
        await notifyBooking(trx, n, booking, business.id, 'booking_rescheduled', [customer], {
          dedupe: `${booking.id}:rescheduled:${option.start}`,
        });
      }
      if (input.actor.kind === 'customer') {
        await notifyBooking(
          trx,
          n,
          booking,
          business.id,
          'admin_rescheduled',
          await staffRecipients(trx, business.id, booking.staffId),
        );
      }
      return booking;
    });
  } catch (e) {
    if (isSlotConflict(e)) throw new DomainError('SLOT_UNAVAILABLE', 'Someone has just taken this time');
    throw e;
  }
}

export interface CancelInput {
  businessId: string;
  bookingId: string;
  actor: Actor;
  reason?: string | null;
}

export async function cancelBooking(ctx: AppContext, input: CancelInput): Promise<BookingDTO> {
  const { db } = ctx;
  const business = await getBusiness(db, input.businessId);
  const now = ctx.now();
  const snap = await snapshot(db, input.bookingId, business.id);
  transition(snap, 'cancel', { actor: input.actor, now, cancelWindowMin: business.settings.cancelWindowMin });
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('bookings')
      .set({
        status: 'cancelled',
        cancel_reason: input.reason?.slice(0, 300) ?? null,
        cancelled_by: actorLabel(input.actor),
        updated_at: new Date(now),
      })
      .where('id', '=', input.bookingId)
      .execute();
    await trx
      .insertInto('booking_events')
      .values({
        booking_id: input.bookingId,
        type: 'cancelled',
        actor: actorLabel(input.actor),
        data: json({ reason: input.reason }),
      })
      .execute();
    await trx
      .updateTable('payments')
      .set({ status: 'failed', updated_at: new Date(now) })
      .where('booking_id', '=', input.bookingId)
      .where('status', '=', 'pending')
      .execute();
    await cancelPendingJobs(trx, input.bookingId);
    const booking = (await loadBooking(trx, input.bookingId))!;
    const n = { now, timeZone: business.timezone };
    const customer = await customerRecipient(trx, booking.customer.id);
    if (input.actor.kind === 'customer') {
      if (customer) await notifyBooking(trx, n, booking, business.id, 'booking_cancelled', [customer]);
      await notifyBooking(
        trx,
        n,
        booking,
        business.id,
        'admin_cancelled',
        await staffRecipients(trx, business.id, booking.staffId),
      );
    } else if (customer && snap.startAt > now) {
      await notifyBooking(trx, n, booking, business.id, 'booking_cancelled_by_business', [customer]);
    }
    return booking;
  });
}

export interface StatusInput {
  businessId: string;
  bookingId: string;
  event: Extract<BookingEvent, 'complete' | 'no_show' | 'confirm'>;
  actor: Actor;
}

/** Marks a visit completed / no-show, or confirms a pending booking manually. */
export async function setBookingStatus(ctx: AppContext, input: StatusInput): Promise<BookingDTO> {
  const { db } = ctx;
  const business = await getBusiness(db, input.businessId);
  const now = ctx.now();
  const snap = await snapshot(db, input.bookingId, business.id);
  const next = transition(snap, input.event, {
    actor: input.actor,
    now,
    cancelWindowMin: business.settings.cancelWindowMin,
  });
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('bookings')
      .set({ status: next, updated_at: new Date(now) })
      .where('id', '=', input.bookingId)
      .execute();
    await trx
      .insertInto('booking_events')
      .values({ booking_id: input.bookingId, type: input.event, actor: actorLabel(input.actor), data: '{}' })
      .execute();
    const booking = (await loadBooking(trx, input.bookingId))!;
    const n = { now, timeZone: business.timezone };
    if (input.event === 'complete') {
      const customer = await customerRecipient(trx, booking.customer.id);
      if (customer) {
        await notifyBooking(trx, n, booking, business.id, 'review_request', [customer], {
          sendAt: Math.max(now, booking.endAt + 30 * 60_000),
          dedupe: `${booking.id}:review`,
        });
      }
    }
    if (input.event === 'no_show') await cancelPendingJobs(trx, input.bookingId);
    if (input.event === 'confirm') await announceConfirmed(trx, n, booking, business.id, input.actor);
    return booking;
  });
}

/** Called by payment webhooks (or the sandbox) when a deposit is paid. Idempotent. */
export async function confirmPayment(
  ctx: AppContext,
  input: { reference: string; providerTxId?: string },
): Promise<BookingDTO | null> {
  const { db } = ctx;
  const now = ctx.now();
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom('payments')
      .selectAll()
      .where('reference', '=', input.reference)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (payment.status === 'paid') return (await loadBooking(trx, payment.booking_id)) ?? null;
    await trx
      .updateTable('payments')
      .set({ status: 'paid', provider_tx_id: input.providerTxId ?? null, updated_at: new Date(now) })
      .where('id', '=', payment.id)
      .execute();
    const b = await trx
      .selectFrom('bookings')
      .select(['status', 'business_id'])
      .where('id', '=', payment.booking_id)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('bookings')
      .set({
        payment_status: 'paid',
        ...(b.status === 'pending' ? { status: 'confirmed' } : {}),
        updated_at: new Date(now),
      })
      .where('id', '=', payment.booking_id)
      .execute();
    await trx
      .insertInto('booking_events')
      .values({
        booking_id: payment.booking_id,
        type: 'paid',
        actor: `payment:${payment.provider}`,
        data: json({ amount: payment.amount }),
      })
      .execute();
    const booking = (await loadBooking(trx, payment.booking_id))!;
    if (b.status === 'pending') {
      const business = await getBusiness(trx, b.business_id);
      await announceConfirmed(trx, { now, timeZone: business.timezone }, booking, business.id, {
        kind: 'system',
      });
    }
    return booking;
  });
}

export async function reportRunningLate(
  ctx: AppContext,
  input: { businessId: string; bookingId: string; minutes: number; actor: Actor },
): Promise<BookingDTO> {
  const { db } = ctx;
  const now = ctx.now();
  if (![5, 10, 15, 20, 30].includes(input.minutes)) throw new DomainError('VALIDATION', 'Unsupported delay');
  const business = await getBusiness(db, input.businessId);
  const snap = await snapshot(db, input.bookingId, business.id);
  if (input.actor.kind === 'customer' && input.actor.customerId !== snap.customerId)
    throw new DomainError('FORBIDDEN');
  if (snap.status !== 'confirmed') throw new DomainError('INVALID_TRANSITION', 'Booking is not active');
  if (now < snap.startAt - 3 * 3_600_000 || now > snap.endAt) {
    throw new DomainError('VALIDATION', 'You can report a delay only shortly before the visit');
  }
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('bookings')
      .set({ running_late_min: input.minutes, updated_at: new Date(now) })
      .where('id', '=', input.bookingId)
      .execute();
    await trx
      .insertInto('booking_events')
      .values({
        booking_id: input.bookingId,
        type: 'running_late',
        actor: actorLabel(input.actor),
        data: json({ minutes: input.minutes }),
      })
      .execute();
    const booking = (await loadBooking(trx, input.bookingId))!;
    for (const r of await staffRecipients(trx, business.id, booking.staffId)) {
      await enqueue(trx, {
        businessId: business.id,
        bookingId: booking.id,
        kind: 'admin_running_late',
        recipient: r,
        payload: {
          kind: 'admin_running_late',
          card: toCard(booking, r.lang, business.timezone),
          bookingId: booking.id,
          minutes: input.minutes,
        },
        sendAt: now,
      });
    }
    return booking;
  });
}

export async function listCustomerBookings(
  db: Db,
  businessId: string,
  customerId: string,
): Promise<BookingDTO[]> {
  const rows = await db
    .selectFrom('bookings')
    .select('id')
    .where('business_id', '=', businessId)
    .where('customer_id', '=', customerId)
    .orderBy('start_at', 'desc')
    .limit(100)
    .execute();
  const list = await loadBookings(
    db,
    rows.map((r) => r.id),
  );
  return list.sort((a, b) => b.startAt - a.startAt);
}

export async function leaveReview(
  ctx: AppContext,
  input: {
    businessId: string;
    bookingId: string;
    customerId: string;
    rating: number;
    comment?: string | null;
  },
): Promise<BookingDTO> {
  const { db } = ctx;
  assertRating(input.rating);
  const snap = await snapshot(db, input.bookingId, input.businessId);
  if (snap.customerId !== input.customerId) throw new DomainError('NOT_FOUND', 'Booking not found');
  const existing = await db
    .selectFrom('reviews')
    .select('id')
    .where('booking_id', '=', input.bookingId)
    .executeTakeFirst();
  if (!canReview({ status: snap.status, endAt: snap.endAt, hasReview: !!existing }, ctx.now())) {
    throw new DomainError('REVIEW_NOT_ALLOWED', 'You can rate a visit once, after it is completed');
  }
  await db
    .insertInto('reviews')
    .values({
      business_id: input.businessId,
      booking_id: input.bookingId,
      customer_id: input.customerId,
      staff_id: snap.staffId,
      rating: input.rating,
      comment: input.comment?.trim().slice(0, 1000) || null,
    })
    .execute();
  return (await loadBooking(db, input.bookingId))!;
}
