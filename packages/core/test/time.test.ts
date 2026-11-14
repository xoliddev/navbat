import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatHm,
  isoWeekday,
  monthDates,
  normalize,
  offsetMinutes,
  parseHm,
  subtract,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from '../src/index.js';

describe('time zones', () => {
  it('Tashkent is UTC+5 all year', () => {
    expect(offsetMinutes('Asia/Tashkent', Date.UTC(2026, 0, 15))).toBe(300);
    expect(offsetMinutes('Asia/Tashkent', Date.UTC(2026, 6, 15))).toBe(300);
    expect(zonedToUtc('2026-11-16', 9 * 60, 'Asia/Tashkent')).toBe(Date.UTC(2026, 10, 16, 4, 0));
  });

  it('round-trips local times', () => {
    for (const tz of ['Asia/Tashkent', 'Europe/Berlin', 'America/New_York', 'Asia/Kathmandu']) {
      const t = zonedToUtc('2026-07-04', 13 * 60 + 45, tz);
      expect(utcToZoned(t, tz)).toMatchObject({ date: '2026-07-04', minute: 13 * 60 + 45 });
    }
  });

  it('moves non-existent spring-forward times past the gap', () => {
    const t = zonedToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York');
    expect(utcToZoned(t, 'America/New_York').minute).toBe(3 * 60 + 30);
  });

  it('resolves ambiguous fall-back times to the earlier instant', () => {
    const t = zonedToUtc('2026-10-25', 2 * 60 + 30, 'Europe/Berlin');
    expect(t).toBe(Date.UTC(2026, 9, 25, 0, 30)); // 02:30 CEST (UTC+2)
  });

  it('handles minutes past midnight', () => {
    const t = zonedToUtc('2026-11-20', 25 * 60, 'Asia/Tashkent');
    expect(utcToZoned(t, 'Asia/Tashkent')).toMatchObject({ date: '2026-11-21', minute: 60 });
  });

  it('computes "today" in the business time zone, not the server one', () => {
    // 20:30 UTC on Nov 15 is already Nov 16 in Tashkent
    expect(todayIn('Asia/Tashkent', Date.UTC(2026, 10, 15, 20, 30))).toBe('2026-11-16');
  });
});

describe('calendar helpers', () => {
  it('adds days across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-13', '2026-12-13')).toBe(30);
  });

  it('uses ISO weekdays', () => {
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
  });

  it('lists month dates', () => {
    expect(monthDates('2026-02-10')).toHaveLength(28);
    expect(monthDates('2028-02-10').at(-1)).toBe('2028-02-29');
  });

  it('formats and parses HH:MM', () => {
    expect(formatHm(0)).toBe('00:00');
    expect(formatHm(1500)).toBe('01:00');
    expect(parseHm('9:05')).toBe(545);
    expect(parseHm('24:00')).toBe(1440);
    expect(() => parseHm('25:00')).toThrow();
    expect(() => parseHm('noon')).toThrow();
  });
});

describe('intervals', () => {
  it('merges overlapping intervals', () => {
    expect(
      normalize([
        { start: 5, end: 8 },
        { start: 1, end: 3 },
        { start: 3, end: 6 },
      ]),
    ).toEqual([{ start: 1, end: 8 }]);
  });

  it('subtracts cuts from the middle and the edges', () => {
    expect(
      subtract(
        [{ start: 0, end: 100 }],
        [
          { start: 10, end: 20 },
          { start: 90, end: 120 },
          { start: -5, end: 2 },
        ],
      ),
    ).toEqual([
      { start: 2, end: 10 },
      { start: 20, end: 90 },
    ]);
  });
});
