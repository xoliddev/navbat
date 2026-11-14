import {
  addDays,
  type BusinessSettings,
  bookableDates,
  DomainError,
  heatLevel,
  type Interval,
  monthDates,
  type ServiceSpec,
  type StaffAvailability,
  scanDay,
  utcToZoned,
  zonedToUtc,
} from '@navbat/core';
import { getBusiness } from './catalog.js';
import { type Db, ms } from './context.js';
import type { DayHeatDTO, SlotDTO } from './dto.js';

export async function loadServiceSpecs(
  db: Db,
  businessId: string,
  serviceIds: string[],
): Promise<ServiceSpec[]> {
  if (serviceIds.length === 0) throw new DomainError('VALIDATION', 'Pick at least one service');
  if (new Set(serviceIds).size !== serviceIds.length)
    throw new DomainError('VALIDATION', 'Duplicate services');
  const rows = await db
    .selectFrom('services')
    .selectAll()
    .where('business_id', '=', businessId)
    .where('id', 'in', serviceIds)
    .where('active', '=', true)
    .execute();
  return serviceIds.map((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new DomainError('VALIDATION', `Unknown service ${id}`);
    return {
      id: r.id,
      durationMin: r.duration_min,
      bufferBeforeMin: r.buffer_before_min,
      bufferAfterMin: r.buffer_after_min,
      price: r.price,
    };
  });
}

export async function bookableStaffIds(
  db: Db,
  businessId: string,
  staffId: string | null,
): Promise<string[]> {
  let q = db
    .selectFrom('staff')
    .select('id')
    .where('business_id', '=', businessId)
    .where('active', '=', true)
    .where('bookable', '=', true);
  if (staffId) q = q.where('id', '=', staffId);
  const rows = await q.orderBy('position').orderBy('name').execute();
  if (staffId && rows.length === 0) throw new DomainError('NOT_FOUND', 'Master not found');
  return rows.map((r) => r.id);
}

/**
 * Loads everything the slot engine needs for `staffIds` within `window`.
 * `excludeBookingId` lets a booking be moved without colliding with itself.
 */
export async function loadAvailability(
  db: Db,
  businessId: string,
  staffIds: string[],
  window: Interval,
  excludeBookingId?: string,
): Promise<StaffAvailability[]> {
  if (staffIds.length === 0) return [];
  const from = new Date(window.start);
  const to = new Date(window.end);
  let busyQ = db
    .selectFrom('bookings')
    .select(['staff_id', 'occupied_start', 'occupied_end'])
    .where('staff_id', 'in', staffIds)
    .where('status', '<>', 'cancelled')
    .where('occupied_start', '<', to)
    .where('occupied_end', '>', from);
  if (excludeBookingId) busyQ = busyQ.where('id', '<>', excludeBookingId);
  const [offers, rules, timeOff, busy] = await Promise.all([
    db.selectFrom('staff_services').selectAll().where('staff_id', 'in', staffIds).execute(),
    db.selectFrom('schedule_rules').selectAll().where('staff_id', 'in', staffIds).execute(),
    db
      .selectFrom('time_off')
      .select(['staff_id', 'start_at', 'end_at'])
      .where('business_id', '=', businessId)
      .where((eb) => eb.or([eb('staff_id', 'in', staffIds), eb('staff_id', 'is', null)]))
      .where('start_at', '<', to)
      .where('end_at', '>', from)
      .execute(),
    busyQ.execute(),
  ]);
  return staffIds.map((id) => ({
    staffId: id,
    services: Object.fromEntries(
      offers
        .filter((o) => o.staff_id === id)
        .map((o) => [o.service_id, { durationMin: o.duration_min, price: o.price }]),
    ),
    workingHours: rules
      .filter((r) => r.staff_id === id && r.kind === 'work')
      .map((r) => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min })),
    breaks: rules
      .filter((r) => r.staff_id === id && r.kind === 'break')
      .map((r) => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min })),
    timeOff: timeOff
      .filter((t) => t.staff_id === id || t.staff_id === null)
      .map((t) => ({ start: ms(t.start_at), end: ms(t.end_at) })),
    busy: busy
      .filter((b) => b.staff_id === id)
      .map((b) => ({ start: ms(b.occupied_start), end: ms(b.occupied_end) })),
  }));
}

/** Window that covers a local date plus overnight spill on both sides. */
export function dayWindow(date: string, timeZone: string): Interval {
  return {
    start: zonedToUtc(addDays(date, -1), 0, timeZone),
    end: zonedToUtc(addDays(date, 2), 0, timeZone),
  };
}

export function engineRules(s: BusinessSettings) {
  return { minNoticeMin: s.minNoticeMin, horizonDays: s.horizonDays, slotStepMin: s.slotStepMin };
}

export interface SlotsQuery {
  businessId: string;
  date: string;
  serviceIds: string[];
  staffId: string | null;
  now: number;
}

export async function getSlots(db: Db, q: SlotsQuery): Promise<SlotDTO[]> {
  const business = await getBusiness(db, q.businessId);
  const services = await loadServiceSpecs(db, business.id, q.serviceIds);
  const staffIds = await bookableStaffIds(db, business.id, q.staffId);
  const staff = await loadAvailability(db, business.id, staffIds, dayWindow(q.date, business.timezone));
  const { slots } = scanDay({
    timeZone: business.timezone,
    date: q.date,
    services,
    staff,
    now: q.now,
    rules: engineRules(business.settings),
  });
  return slots.map((s) => ({
    start: s.start,
    options: s.options.map((o) => ({ staffId: o.staffId, end: o.end, price: o.price })),
  }));
}

export interface MonthQuery extends Omit<SlotsQuery, 'date'> {
  /** Any date inside the month, 'YYYY-MM-DD'. */
  month: string;
}

/** Per-day availability for the calendar heatmap. */
export async function getMonthAvailability(db: Db, q: MonthQuery): Promise<DayHeatDTO[]> {
  const business = await getBusiness(db, q.businessId);
  const tz = business.timezone;
  const services = await loadServiceSpecs(db, business.id, q.serviceIds);
  const staffIds = await bookableStaffIds(db, business.id, q.staffId);
  const dates = monthDates(q.month);
  const window = { start: dayWindow(dates[0]!, tz).start, end: dayWindow(dates.at(-1)!, tz).end };
  const staff = await loadAvailability(db, business.id, staffIds, window);
  const rules = engineRules(business.settings);
  const allowed = new Set(bookableDates(tz, q.now, rules));
  return dates.map((date) => {
    if (!allowed.has(date)) return { date, level: 0, free: 0, bookable: false };
    const { slots, capacity } = scanDay({ timeZone: tz, date, services, staff, now: q.now, rules });
    return { date, level: heatLevel(slots.length, capacity), free: slots.length, bookable: slots.length > 0 };
  });
}

/** First local date (from today) that has at least one slot — used to preselect the calendar. */
export async function firstAvailableDate(db: Db, q: Omit<SlotsQuery, 'date'>): Promise<string | null> {
  const business = await getBusiness(db, q.businessId);
  const tz = business.timezone;
  const services = await loadServiceSpecs(db, business.id, q.serviceIds);
  const staffIds = await bookableStaffIds(db, business.id, q.staffId);
  const rules = engineRules(business.settings);
  const dates = bookableDates(tz, q.now, rules);
  const window = { start: dayWindow(dates[0]!, tz).start, end: dayWindow(dates.at(-1)!, tz).end };
  const staff = await loadAvailability(db, business.id, staffIds, window);
  for (const date of dates) {
    if (scanDay({ timeZone: tz, date, services, staff, now: q.now, rules }).slots.length > 0) return date;
  }
  return null;
}

export function localDateOf(epochMs: number, timeZone: string): string {
  return utcToZoned(epochMs, timeZone).date;
}
