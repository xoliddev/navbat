import {
  addDays,
  availableIntervals,
  type BusinessSettings,
  DomainError,
  diffDays,
  type Interval,
  isValidTimeZone,
  type Lang,
  type LocalizedText,
  normalizePhone,
  pickText,
  type Role,
  totalLength,
  utcToZoned,
  zonedToUtc,
} from '@navbat/core';
import { sql } from 'kysely';
import { loadAvailability } from './availability.js';
import { loadBookings } from './booking-read.js';
import { getBusiness, listStaff, toService, toTimeOff } from './catalog.js';
import { type Db, json, ms } from './context.js';
import type {
  AnalyticsDTO,
  BusinessDTO,
  CalendarDTO,
  ClientDetailsDTO,
  ClientDTO,
  ScheduleRuleDTO,
  ServiceDTO,
  StaffDTO,
  TimeOffDTO,
} from './dto.js';
import type { BookingSource } from './schema.js';

function rangeWindow(from: string, to: string, tz: string): Interval {
  if (diffDays(from, to) < 0 || diffDays(from, to) > 92)
    throw new DomainError('VALIDATION', 'Range must be 1–93 days');
  return { start: zonedToUtc(from, 0, tz), end: zonedToUtc(addDays(to, 1), 0, tz) };
}

function datesBetween(from: string, to: string): string[] {
  const n = diffDays(from, to);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Calendar for the admin panel: bookings, blocks and working hours for [from, to]. */
export async function getCalendar(
  db: Db,
  q: { businessId: string; from: string; to: string; staffIds?: string[] },
): Promise<CalendarDTO> {
  const business = await getBusiness(db, q.businessId);
  const tz = business.timezone;
  const window = rangeWindow(q.from, q.to, tz);
  let staff = (await listStaff(db, business.id)).filter((s) => s.bookable);
  if (q.staffIds) staff = staff.filter((s) => q.staffIds!.includes(s.id));
  const ids = staff.map((s) => s.id);
  const bookingIds = ids.length
    ? await db
        .selectFrom('bookings')
        .select('id')
        .where('business_id', '=', business.id)
        .where('staff_id', 'in', ids)
        .where('start_at', '<', new Date(window.end))
        .where('end_at', '>', new Date(window.start))
        .execute()
    : [];
  const timeOff = await db
    .selectFrom('time_off')
    .selectAll()
    .where('business_id', '=', business.id)
    .where('start_at', '<', new Date(window.end))
    .where('end_at', '>', new Date(window.start))
    .execute();
  const availability = await loadAvailability(db, business.id, ids, window);
  const working = availability.flatMap((a) =>
    datesBetween(q.from, q.to).map((date) => {
      const dayStart = zonedToUtc(date, 0, tz);
      const dayEnd = zonedToUtc(addDays(date, 1), 0, tz);
      // working time without breaks, but ignoring time off (rendered separately)
      const intervals = availableIntervals({ ...a, timeOff: [] }, date, tz)
        .map((i) => ({ start: Math.max(i.start, dayStart), end: Math.min(i.end, dayEnd) }))
        .filter((i) => i.end > i.start);
      return { staffId: a.staffId, date, intervals };
    }),
  );
  return {
    from: q.from,
    to: q.to,
    timezone: tz,
    staff,
    bookings: await loadBookings(
      db,
      bookingIds.map((b) => b.id),
    ),
    timeOff: timeOff.filter((t) => t.staff_id === null || ids.includes(t.staff_id)).map(toTimeOff),
    working,
  };
}

export async function createTimeOff(
  db: Db,
  input: {
    businessId: string;
    staffId: string | null;
    start: number;
    end: number;
    kind?: TimeOffDTO['kind'];
    reason?: string | null;
  },
): Promise<TimeOffDTO> {
  if (!(input.end > input.start)) throw new DomainError('VALIDATION', 'End must be after start');
  const row = await db
    .insertInto('time_off')
    .values({
      business_id: input.businessId,
      staff_id: input.staffId,
      kind: input.kind ?? 'block',
      start_at: new Date(input.start),
      end_at: new Date(input.end),
      reason: input.reason?.slice(0, 200) ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toTimeOff(row);
}

export async function deleteTimeOff(db: Db, businessId: string, id: string): Promise<void> {
  const res = await db
    .deleteFrom('time_off')
    .where('id', '=', id)
    .where('business_id', '=', businessId)
    .executeTakeFirst();
  if (!res.numDeletedRows) throw new DomainError('NOT_FOUND', 'Block not found');
}

export interface ServiceInput {
  id?: string;
  categoryId?: string | null;
  name: LocalizedText;
  description?: LocalizedText;
  durationMin: number;
  price: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  position?: number;
  active?: boolean;
}

function assertName(name: LocalizedText): void {
  if (!Object.values(name).some((v) => v && v.trim().length > 0))
    throw new DomainError('VALIDATION', 'Name is required');
}

export async function saveService(db: Db, businessId: string, input: ServiceInput): Promise<ServiceDTO> {
  assertName(input.name);
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 720) {
    throw new DomainError('VALIDATION', 'Duration must be 5–720 minutes', { field: 'durationMin' });
  }
  if (!Number.isInteger(input.price) || input.price < 0)
    throw new DomainError('VALIDATION', 'Price must be ≥ 0');
  const values = {
    category_id: input.categoryId ?? null,
    name: json(input.name),
    description: json(input.description ?? {}),
    duration_min: input.durationMin,
    price: input.price,
    buffer_before_min: input.bufferBeforeMin ?? 0,
    buffer_after_min: input.bufferAfterMin ?? 0,
    position: input.position ?? 0,
    active: input.active ?? true,
  };
  if (input.id) {
    const row = await db
      .updateTable('services')
      .set(values)
      .where('id', '=', input.id)
      .where('business_id', '=', businessId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new DomainError('NOT_FOUND', 'Service not found');
    return toService(row);
  }
  const row = await db
    .insertInto('services')
    .values({ business_id: businessId, ...values })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toService(row);
}

export interface StaffInput {
  id?: string;
  branchId?: string | null;
  name: string;
  title?: LocalizedText;
  bio?: LocalizedText;
  color?: string;
  role?: Role;
  bookable?: boolean;
  active?: boolean;
  position?: number;
  telegramUserId?: number | null;
  lang?: Lang;
  services?: { serviceId: string; durationMin?: number | null; price?: number | null }[];
}

export async function saveStaff(db: Db, businessId: string, input: StaffInput): Promise<StaffDTO> {
  if (!input.name.trim()) throw new DomainError('VALIDATION', 'Name is required');
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color))
    throw new DomainError('VALIDATION', 'Color must be #rrggbb');
  const values = {
    branch_id: input.branchId ?? null,
    name: input.name.trim(),
    title: json(input.title ?? {}),
    bio: json(input.bio ?? {}),
    color: input.color ?? '#3355dd',
    role: input.role ?? 'master',
    bookable: input.bookable ?? true,
    active: input.active ?? true,
    position: input.position ?? 0,
    telegram_user_id: input.telegramUserId ?? null,
    lang: input.lang ?? 'uz',
  };
  let id = input.id;
  if (id) {
    const res = await db
      .updateTable('staff')
      .set(values)
      .where('id', '=', id)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new DomainError('NOT_FOUND', 'Staff member not found');
  } else {
    id = (
      await db
        .insertInto('staff')
        .values({ business_id: businessId, ...values })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }
  if (input.services) {
    const valid = await db
      .selectFrom('services')
      .select('id')
      .where('business_id', '=', businessId)
      .where(
        'id',
        'in',
        input.services.length
          ? input.services.map((s) => s.serviceId)
          : ['00000000-0000-0000-0000-000000000000'],
      )
      .execute();
    if (valid.length !== input.services.length) throw new DomainError('VALIDATION', 'Unknown service');
    await db.deleteFrom('staff_services').where('staff_id', '=', id).execute();
    if (input.services.length) {
      await db
        .insertInto('staff_services')
        .values(
          input.services.map((s) => ({
            staff_id: id!,
            service_id: s.serviceId,
            duration_min: s.durationMin ?? null,
            price: s.price ?? null,
          })),
        )
        .execute();
    }
  }
  const all = await listStaff(db, businessId, { includeInactive: true });
  return all.find((s) => s.id === id)!;
}

/** Replaces a master's weekly schedule (working intervals and breaks). */
export async function saveSchedule(
  db: Db,
  businessId: string,
  staffId: string,
  rules: ScheduleRuleDTO[],
): Promise<void> {
  const staff = await db
    .selectFrom('staff')
    .select('id')
    .where('id', '=', staffId)
    .where('business_id', '=', businessId)
    .executeTakeFirst();
  if (!staff) throw new DomainError('NOT_FOUND', 'Staff member not found');
  for (const r of rules) {
    if (
      r.weekday < 1 ||
      r.weekday > 7 ||
      r.startMin < 0 ||
      r.startMin >= 1440 ||
      r.endMin <= r.startMin ||
      r.endMin > 2880
    ) {
      throw new DomainError('VALIDATION', 'Invalid schedule interval', { rule: r });
    }
  }
  await db.deleteFrom('schedule_rules').where('staff_id', '=', staffId).execute();
  if (rules.length) {
    await db
      .insertInto('schedule_rules')
      .values(
        rules.map((r) => ({
          staff_id: staffId,
          kind: r.kind,
          weekday: r.weekday,
          start_min: r.startMin,
          end_min: r.endMin,
        })),
      )
      .execute();
  }
}

export async function saveSettings(
  db: Db,
  businessId: string,
  input: { name?: string; timezone?: string; phone?: string | null; settings?: Partial<BusinessSettings> },
): Promise<BusinessDTO> {
  const current = await getBusiness(db, businessId);
  if (input.timezone && !isValidTimeZone(input.timezone))
    throw new DomainError('VALIDATION', 'Unknown time zone');
  const s = { ...current.settings, ...(input.settings ?? {}) };
  if (s.slotStepMin < 5 || s.slotStepMin > 120)
    throw new DomainError('VALIDATION', 'Slot step must be 5–120');
  if (s.horizonDays < 1 || s.horizonDays > 365)
    throw new DomainError('VALIDATION', 'Horizon must be 1–365 days');
  if (s.depositPercent < 0 || s.depositPercent > 100)
    throw new DomainError('VALIDATION', 'Deposit must be 0–100%');
  await db
    .updateTable('businesses')
    .set({
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      settings: json(s),
    })
    .where('id', '=', businessId)
    .execute();
  return getBusiness(db, businessId);
}

export async function listClients(
  db: Db,
  q: { businessId: string; search?: string; now: number; limit?: number },
): Promise<ClientDTO[]> {
  const now = new Date(q.now);
  let query = db
    .selectFrom('customers as c')
    .leftJoin('bookings as b', 'b.customer_id', 'c.id')
    .select([
      'c.id',
      'c.name',
      'c.phone',
      'c.lang',
      'c.telegram_user_id',
      'c.notes',
      'c.created_at',
      sql<number>`count(b.id) filter (where b.status = 'completed')::int`.as('visits'),
      sql<number>`count(b.id) filter (where b.status = 'no_show')::int`.as('no_shows'),
      sql<number>`count(b.id) filter (where b.status = 'cancelled')::int`.as('cancellations'),
      sql<number>`coalesce(sum(b.total_price) filter (where b.status = 'completed'), 0)::int`.as(
        'total_spent',
      ),
      sql<Date | null>`max(b.start_at) filter (where b.status = 'completed')`.as('last_visit'),
      sql<Date | null>`min(b.start_at) filter (where b.status in ('pending', 'confirmed') and b.start_at > ${now})`.as(
        'next_visit',
      ),
    ])
    .where('c.business_id', '=', q.businessId)
    .groupBy('c.id');
  if (q.search?.trim()) {
    const term = `%${q.search.trim().toLowerCase()}%`;
    const digits = q.search.replace(/\D/g, '');
    query = query.where((eb) =>
      eb.or([
        eb(sql`lower(c.name)`, 'like', term),
        ...(digits.length >= 3 ? [eb('c.phone', 'like', `%${digits}%`)] : []),
      ]),
    );
  }
  const rows = await query
    .orderBy(sql`max(b.start_at)`, sql`desc nulls last`)
    .orderBy('c.name')
    .limit(q.limit ?? 500)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    lang: r.lang,
    telegramUserId: r.telegram_user_id,
    notes: r.notes,
    visits: Number(r.visits),
    noShows: Number(r.no_shows),
    cancellations: Number(r.cancellations),
    totalSpent: Number(r.total_spent),
    lastVisit: r.last_visit ? ms(r.last_visit) : null,
    nextVisit: r.next_visit ? ms(r.next_visit) : null,
    createdAt: ms(r.created_at),
  }));
}

export async function getClient(
  db: Db,
  q: { businessId: string; customerId: string; now: number },
): Promise<ClientDetailsDTO> {
  const all = await listClients(db, { businessId: q.businessId, now: q.now, limit: 100_000 });
  const client = all.find((c) => c.id === q.customerId);
  if (!client) throw new DomainError('NOT_FOUND', 'Client not found');
  const ids = await db
    .selectFrom('bookings')
    .select('id')
    .where('customer_id', '=', q.customerId)
    .orderBy('start_at', 'desc')
    .limit(200)
    .execute();
  const history = (
    await loadBookings(
      db,
      ids.map((i) => i.id),
    )
  ).sort((a, b) => b.startAt - a.startAt);
  return { ...client, history };
}

export async function saveClient(
  db: Db,
  input: {
    businessId: string;
    id?: string;
    name: string;
    phone?: string | null;
    notes?: string | null;
    lang?: Lang;
  },
): Promise<string> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone)
    throw new DomainError('VALIDATION', 'Phone number looks wrong', { field: 'phone' });
  if (!input.name.trim()) throw new DomainError('VALIDATION', 'Name is required');
  const values = { name: input.name.trim(), phone, notes: input.notes ?? null, lang: input.lang ?? 'uz' };
  if (input.id) {
    await db
      .updateTable('customers')
      .set(values)
      .where('id', '=', input.id)
      .where('business_id', '=', input.businessId)
      .execute();
    return input.id;
  }
  return (
    await db
      .insertInto('customers')
      .values({ business_id: input.businessId, ...values })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

/** Key numbers for [from, to] (local dates, inclusive). */
export async function getAnalytics(
  db: Db,
  q: { businessId: string; from: string; to: string; now: number },
): Promise<AnalyticsDTO> {
  const business = await getBusiness(db, q.businessId);
  const tz = business.timezone;
  const window = rangeWindow(q.from, q.to, tz);
  const staff = (await listStaff(db, business.id)).filter((s) => s.bookable);
  const rows = await db
    .selectFrom('bookings')
    .select(['id', 'staff_id', 'status', 'start_at', 'end_at', 'total_price', 'source', 'customer_id'])
    .where('business_id', '=', business.id)
    .where('start_at', '>=', new Date(window.start))
    .where('start_at', '<', new Date(window.end))
    .execute();
  const items = rows.length
    ? await db
        .selectFrom('booking_items as i')
        .innerJoin('bookings as b', 'b.id', 'i.booking_id')
        .select(['i.service_id', 'i.name', 'i.price', 'b.status'])
        .where(
          'i.booking_id',
          'in',
          rows.map((r) => r.id),
        )
        .execute()
    : [];
  const live = rows.filter((r) => r.status !== 'cancelled');
  const completed = rows.filter((r) => r.status === 'completed');
  const revenue = completed.reduce((s, r) => s + r.total_price, 0);
  const upcoming = rows.filter(
    (r) => (r.status === 'confirmed' || r.status === 'pending') && ms(r.start_at) > q.now,
  );

  // Utilisation = booked minutes / working minutes (breaks and time off excluded).
  const availability = await loadAvailability(
    db,
    business.id,
    staff.map((s) => s.id),
    window,
  );
  const dates = datesBetween(q.from, q.to);
  const workMinutes = new Map<string, number>();
  for (const a of availability) {
    let total = 0;
    for (const date of dates) {
      const dayStart = zonedToUtc(date, 0, tz);
      const dayEnd = zonedToUtc(addDays(date, 1), 0, tz);
      const free = availableIntervals({ ...a, busy: [] }, date, tz)
        .map((i) => ({ start: Math.max(i.start, dayStart), end: Math.min(i.end, dayEnd) }))
        .filter((i) => i.end > i.start);
      total += totalLength(free) / 60_000;
    }
    workMinutes.set(a.staffId, total);
  }
  const bookedMinutes = (staffId?: string) =>
    live
      .filter((r) => !staffId || r.staff_id === staffId)
      .reduce((s, r) => s + (ms(r.end_at) - ms(r.start_at)) / 60_000, 0);
  const totalWork = [...workMinutes.values()].reduce((a, b) => a + b, 0);

  const byDay = dates.map((date) => {
    const day = rows.filter((r) => utcToZoned(ms(r.start_at), tz).date === date);
    return {
      date,
      bookings: day.filter((r) => r.status !== 'cancelled').length,
      revenue: day.filter((r) => r.status === 'completed').reduce((s, r) => s + r.total_price, 0),
    };
  });

  const svc = new Map<string, { serviceId: string; name: LocalizedText; count: number; revenue: number }>();
  for (const i of items) {
    if (i.status === 'cancelled') continue;
    const cur = svc.get(i.service_id) ?? { serviceId: i.service_id, name: i.name, count: 0, revenue: 0 };
    cur.count += 1;
    if (i.status === 'completed') cur.revenue += i.price;
    svc.set(i.service_id, cur);
  }

  const sources = new Map<BookingSource, number>();
  for (const r of live) sources.set(r.source, (sources.get(r.source) ?? 0) + 1);

  const firstVisits = await db
    .selectFrom('customers')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('business_id', '=', business.id)
    .where('created_at', '>=', new Date(window.start))
    .where('created_at', '<', new Date(window.end))
    .executeTakeFirst();
  const rating = await db
    .selectFrom('reviews')
    .select(sql<number | null>`avg(rating)::float8`.as('avg'))
    .where('business_id', '=', business.id)
    .executeTakeFirst();

  return {
    from: q.from,
    to: q.to,
    totals: {
      bookings: live.length,
      completed: completed.length,
      cancelled: rows.length - live.length,
      noShows: rows.filter((r) => r.status === 'no_show').length,
      upcoming: upcoming.length,
      revenue,
      expectedRevenue: upcoming.reduce((s, r) => s + r.total_price, 0),
      averageTicket: completed.length ? Math.round(revenue / completed.length) : 0,
      utilisation: totalWork ? Math.min(1, bookedMinutes() / totalWork) : 0,
      newClients: Number(firstVisits?.n ?? 0),
      rating: rating?.avg ? Math.round(Number(rating.avg) * 10) / 10 : null,
    },
    byDay,
    topServices: [...svc.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 6),
    byStaff: staff.map((s) => {
      const mine = live.filter((r) => r.staff_id === s.id);
      const work = workMinutes.get(s.id) ?? 0;
      return {
        staffId: s.id,
        name: s.name,
        color: s.color,
        bookings: mine.length,
        revenue: mine.filter((r) => r.status === 'completed').reduce((sum, r) => sum + r.total_price, 0),
        utilisation: work ? Math.min(1, bookedMinutes(s.id) / work) : 0,
      };
    }),
    sources: [...sources.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote everything that needs it.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_HEADERS: Record<Lang, string[]> = {
  uz: [
    'Kod',
    'Sana',
    'Boshlanish',
    'Tugash',
    'Usta',
    'Xizmatlar',
    'Mijoz',
    'Telefon',
    'Holat',
    'Narx',
    'Manba',
  ],
  ru: [
    'Код',
    'Дата',
    'Начало',
    'Конец',
    'Мастер',
    'Услуги',
    'Клиент',
    'Телефон',
    'Статус',
    'Цена',
    'Источник',
  ],
  en: ['Code', 'Date', 'Start', 'End', 'Master', 'Services', 'Client', 'Phone', 'Status', 'Price', 'Source'],
};

/** Bookings in [from, to] as CSV (UTF-8 with BOM so Excel opens Cyrillic correctly). */
export async function exportBookingsCsv(
  db: Db,
  q: { businessId: string; from: string; to: string; lang: Lang },
): Promise<string> {
  const business = await getBusiness(db, q.businessId);
  const tz = business.timezone;
  const window = rangeWindow(q.from, q.to, tz);
  const ids = await db
    .selectFrom('bookings')
    .select('id')
    .where('business_id', '=', business.id)
    .where('start_at', '>=', new Date(window.start))
    .where('start_at', '<', new Date(window.end))
    .execute();
  const bookings = await loadBookings(
    db,
    ids.map((i) => i.id),
  );
  const fmt = (t: number) => {
    const z = utcToZoned(t, tz);
    return {
      date: z.date,
      time: `${String(Math.floor(z.minute / 60)).padStart(2, '0')}:${String(z.minute % 60).padStart(2, '0')}`,
    };
  };
  const lines = [CSV_HEADERS[q.lang].join(',')];
  for (const b of bookings) {
    const s = fmt(b.startAt);
    const e = fmt(b.endAt);
    lines.push(
      [
        b.code,
        s.date,
        s.time,
        e.time,
        b.staffName,
        b.items.map((i) => pickText(i.name, q.lang)).join(' + '),
        b.customer.name,
        b.customer.phone,
        b.status,
        b.totalPrice,
        b.source,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
