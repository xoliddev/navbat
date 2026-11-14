/**
 * Time-zone helpers built only on `Intl` — no dependencies, works in Node and every
 * modern browser (including Android WebViews that ship full ICU).
 *
 * All instants are epoch milliseconds (UTC). Local wall-clock values are expressed as a
 * `LocalDate` string (`YYYY-MM-DD`) plus minutes since local midnight. Minutes may exceed
 * 1440 to describe shifts that run past midnight (e.g. 20:00–02:00 = 1200..1560).
 */

export type LocalDate = string;

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(epochMs: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC offset of `timeZone` at the given instant, in minutes (Tashkent = +300). */
export function offsetMinutes(timeZone: string, epochMs: number): number {
  const w = wallClock(epochMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const truncated = Math.floor(epochMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / MINUTE);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid local date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Calendar arithmetic on local dates (no time zone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day) + days * DAY);
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b`. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY,
  );
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** All local dates of the month containing `date`. */
export function monthDates(date: LocalDate): LocalDate[] {
  const { year, month } = parseLocalDate(date);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => formatLocalDate(year, month, i + 1));
}

/**
 * Converts a local wall-clock time into an instant.
 *
 * - Ambiguous times (clocks go back) resolve to the earlier instant.
 * - Non-existent times (clocks jump forward) move forward by the length of the gap,
 *   e.g. 02:30 on a spring-forward night in Berlin becomes 03:30 local.
 */
export function zonedToUtc(date: LocalDate, minuteOfDay: number, timeZone: string): number {
  const { year, month, day } = parseLocalDate(date);
  const naive = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE;
  const candidates = new Set([
    offsetMinutes(timeZone, naive - DAY),
    offsetMinutes(timeZone, naive),
    offsetMinutes(timeZone, naive + DAY),
  ]);
  let best: number | undefined;
  for (const off of candidates) {
    const t = naive - off * MINUTE;
    if (offsetMinutes(timeZone, t) === off && (best === undefined || t < best)) best = t;
  }
  if (best !== undefined) return best;
  // Gap: the wall-clock time does not exist. Use the offset in force *before* the jump.
  return naive - Math.min(...candidates) * MINUTE;
}

export interface ZonedParts {
  date: LocalDate;
  /** Minutes since local midnight, 0..1439. */
  minute: number;
  weekday: number;
}

export function utcToZoned(epochMs: number, timeZone: string): ZonedParts {
  const w = wallClock(epochMs, timeZone);
  const date = formatLocalDate(w.year, w.month, w.day);
  return { date, minute: w.hour * 60 + w.minute, weekday: isoWeekday(date) };
}

export function todayIn(timeZone: string, now: number): LocalDate {
  return utcToZoned(now, timeZone).date;
}

/** Instant of local midnight that starts `date`. */
export function startOfLocalDay(date: LocalDate, timeZone: string): number {
  return zonedToUtc(date, 0, timeZone);
}

export function formatHm(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseHm(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new RangeError(`Invalid time: ${value}`);
  return h * 60 + min;
}

export function formatTimeIn(epochMs: number, timeZone: string): string {
  return formatHm(utcToZoned(epochMs, timeZone).minute);
}

export const MS = { MINUTE, HOUR: 60 * MINUTE, DAY } as const;
