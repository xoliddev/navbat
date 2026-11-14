/**
 * Slot engine.
 *
 * Given masters' weekly schedules, breaks, time off and existing bookings, it answers two
 * questions: "which start times are free on this date?" and "does this exact booking fit?".
 *
 * Model:
 * - A booking is a chain of services done back-to-back by one master. Between two services
 *   the gap is max(bufferAfter of the previous, bufferBefore of the next).
 * - Service time must sit inside working hours and must not touch breaks or time off.
 * - The *occupied* window = service time widened by the first service's buffer-before and the
 *   last service's buffer-after. Occupied windows of two bookings of one master never overlap
 *   (the same rule is enforced by a PostgreSQL exclusion constraint). Buffers may spill outside
 *   working hours or into a break: cleaning up after the last client is fine.
 * - Start times are aligned to a local grid (slotStep) so the UI shows 10:00, 10:15, …
 *   Everything is computed in UTC instants, so DST transitions are handled by `zonedToUtc`.
 */
import { anyOverlap, type Interval, normalize, subtract } from './intervals.js';
import {
  addDays,
  diffDays,
  isoWeekday,
  type LocalDate,
  MS,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from './time.js';

export interface WeeklyRule {
  /** ISO weekday, Monday = 1 … Sunday = 7. */
  weekday: number;
  /** Minutes from local midnight. */
  startMin: number;
  /** Minutes from local midnight; may exceed 1440 for shifts that end after midnight. */
  endMin: number;
}

export interface ServiceSpec {
  id: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  price: number;
}

/** Per-master overrides for a service the master performs. */
export interface StaffOffer {
  durationMin?: number | null;
  price?: number | null;
}

export interface StaffAvailability {
  staffId: string;
  /** Services this master performs, keyed by service id. */
  services: Record<string, StaffOffer>;
  workingHours: WeeklyRule[];
  breaks: WeeklyRule[];
  /** Days off, holidays, admin blocks. Service time may not overlap them. */
  timeOff: Interval[];
  /** Occupied windows of existing bookings (already widened by their buffers). */
  busy: Interval[];
}

export interface BookingRules {
  /** Customers cannot book closer than this to "now". */
  minNoticeMin: number;
  /** How many days ahead customers may book (today + horizonDays inclusive). */
  horizonDays: number;
  /** Grid for start times, e.g. 15 → 10:00, 10:15, … */
  slotStepMin: number;
}

export interface PlanItem {
  serviceId: string;
  /** Minutes after the booking start. */
  offsetMin: number;
  durationMin: number;
  price: number;
}

export interface BookingPlan {
  items: PlanItem[];
  /** Service time from the first start to the last end, in minutes. */
  totalMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  price: number;
}

export interface SlotOption {
  staffId: string;
  start: number;
  /** End of service time. */
  end: number;
  /** Window blocked for this master, buffers included. */
  occupied: Interval;
  price: number;
  plan: BookingPlan;
}

export interface Slot {
  start: number;
  options: SlotOption[];
}

export interface DayQuery {
  timeZone: string;
  date: LocalDate;
  services: ServiceSpec[];
  staff: StaffAvailability[];
  now: number;
  rules: BookingRules;
}

export type FitFailure =
  | 'NO_SERVICES'
  | 'SERVICE_NOT_OFFERED'
  | 'IN_PAST'
  | 'TOO_SOON'
  | 'OUTSIDE_HORIZON'
  | 'NOT_WORKING'
  | 'CONFLICT';

export type FitResult = { ok: true; option: SlotOption } | { ok: false; reason: FitFailure };

/** Builds the back-to-back chain of services for one master, or null if they don't offer one. */
export function buildPlan(
  services: readonly ServiceSpec[],
  offers: Record<string, StaffOffer>,
): BookingPlan | null {
  if (services.length === 0) return null;
  const items: PlanItem[] = [];
  let cursor = 0;
  let price = 0;
  for (let i = 0; i < services.length; i++) {
    const s = services[i]!;
    const offer = offers[s.id];
    if (!offer) return null;
    if (i > 0) {
      const prev = services[i - 1]!;
      cursor += Math.max(prev.bufferAfterMin, s.bufferBeforeMin);
    }
    const durationMin = offer.durationMin ?? s.durationMin;
    const itemPrice = offer.price ?? s.price;
    items.push({ serviceId: s.id, offsetMin: cursor, durationMin, price: itemPrice });
    cursor += durationMin;
    price += itemPrice;
  }
  return {
    items,
    totalMin: cursor,
    bufferBeforeMin: services[0]!.bufferBeforeMin,
    bufferAfterMin: services[services.length - 1]!.bufferAfterMin,
    price,
  };
}

function rulesToIntervals(rules: readonly WeeklyRule[], date: LocalDate, timeZone: string): Interval[] {
  const wd = isoWeekday(date);
  return rules
    .filter((r) => r.weekday === wd && r.endMin > r.startMin)
    .map((r) => ({
      start: zonedToUtc(date, r.startMin, timeZone),
      end: zonedToUtc(date, r.endMin, timeZone),
    }));
}

/**
 * Working time that may contain service time on `date`, including the tail of an overnight
 * shift that started the previous day.
 */
export function availableIntervals(staff: StaffAvailability, date: LocalDate, timeZone: string): Interval[] {
  const days = [addDays(date, -1), date];
  const shifts = days.flatMap((d) => rulesToIntervals(staff.workingHours, d, timeZone));
  const breaks = days.flatMap((d) => rulesToIntervals(staff.breaks, d, timeZone));
  return subtract(shifts, [...breaks, ...staff.timeOff]);
}

function optionFor(staff: StaffAvailability, plan: BookingPlan, start: number): SlotOption {
  const end = start + plan.totalMin * MS.MINUTE;
  return {
    staffId: staff.staffId,
    start,
    end,
    occupied: { start: start - plan.bufferBeforeMin * MS.MINUTE, end: end + plan.bufferAfterMin * MS.MINUTE },
    price: plan.price,
    plan,
  };
}

function checkRules(
  start: number,
  q: Pick<DayQuery, 'now' | 'rules' | 'timeZone'>,
  date: LocalDate,
): FitFailure | null {
  if (start <= q.now) return 'IN_PAST';
  if (start < q.now + q.rules.minNoticeMin * MS.MINUTE) return 'TOO_SOON';
  if (diffDays(todayIn(q.timeZone, q.now), date) > q.rules.horizonDays) return 'OUTSIDE_HORIZON';
  return null;
}

export interface ScanResult {
  slots: Slot[];
  /** Grid starts inside working time, ignoring bookings and notice rules (heatmap denominator). */
  capacity: number;
}

/** Scans one local date and returns every bookable start, grouped across masters. */
export function scanDay(q: DayQuery): ScanResult {
  const step = Math.max(5, q.rules.slotStepMin);
  const byStart = new Map<number, SlotOption[]>();
  let capacity = 0;
  for (const staff of q.staff) {
    const plan = buildPlan(q.services, staff.services);
    if (!plan) continue;
    const busy = normalize(staff.busy);
    for (const free of availableIntervals(staff, q.date, q.timeZone)) {
      const localMin = utcToZoned(free.start, q.timeZone).minute;
      let start = free.start + ((step - (localMin % step)) % step) * MS.MINUTE;
      for (; start + plan.totalMin * MS.MINUTE <= free.end; start += step * MS.MINUTE) {
        if (utcToZoned(start, q.timeZone).date !== q.date) continue;
        capacity++;
        if (checkRules(start, q, q.date)) continue;
        const option = optionFor(staff, plan, start);
        if (anyOverlap(option.occupied, busy)) continue;
        const list = byStart.get(start);
        if (list) list.push(option);
        else byStart.set(start, [option]);
      }
    }
  }
  const slots = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, options]) => ({ start, options }));
  return { slots, capacity };
}

export function findSlots(q: DayQuery): Slot[] {
  return scanDay(q).slots;
}

export interface FitQuery extends Omit<DayQuery, 'date' | 'staff'> {
  staff: StaffAvailability;
  start: number;
  /** Admins may book walk-ins right now, off-grid, or far ahead. */
  enforceCustomerRules: boolean;
}

/** Validates one concrete booking: right master, inside working time, no conflicts. */
export function checkFit(q: FitQuery): FitResult {
  if (q.services.length === 0) return { ok: false, reason: 'NO_SERVICES' };
  const plan = buildPlan(q.services, q.staff.services);
  if (!plan) return { ok: false, reason: 'SERVICE_NOT_OFFERED' };
  const date = utcToZoned(q.start, q.timeZone).date;
  if (q.enforceCustomerRules) {
    const failure = checkRules(q.start, q, date);
    if (failure) return { ok: false, reason: failure };
  }
  const option = optionFor(q.staff, plan, q.start);
  const inside = availableIntervals(q.staff, date, q.timeZone).some(
    (i) => i.start <= option.start && option.end <= i.end,
  );
  if (!inside) return { ok: false, reason: 'NOT_WORKING' };
  if (anyOverlap(option.occupied, q.staff.busy)) return { ok: false, reason: 'CONFLICT' };
  return { ok: true, option };
}

/**
 * "Any master": picks the least-loaded master for the day; ties go to the earlier one in
 * `options` (which follows the business's staff order).
 */
export function pickOption(
  options: readonly SlotOption[],
  bookedMinutes: Record<string, number>,
): SlotOption {
  if (options.length === 0) throw new RangeError('No options to pick from');
  let best = options[0]!;
  for (const o of options) {
    if ((bookedMinutes[o.staffId] ?? 0) < (bookedMinutes[best.staffId] ?? 0)) best = o;
  }
  return best;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Maps free/capacity to 0 (closed or full) … 4 (wide open). */
export function heatLevel(free: number, capacity: number): HeatLevel {
  if (capacity <= 0 || free <= 0) return 0;
  const ratio = free / capacity;
  if (ratio > 0.75) return 4;
  if (ratio > 0.45) return 3;
  if (ratio > 0.2) return 2;
  return 1;
}

/** Local dates customers may book, today first. */
export function bookableDates(timeZone: string, now: number, rules: BookingRules): LocalDate[] {
  const today = todayIn(timeZone, now);
  return Array.from({ length: rules.horizonDays + 1 }, (_, i) => addDays(today, i));
}
