import { describe, expect, it } from 'vitest';
import {
  addDays,
  type BookingRules,
  buildPlan,
  checkFit,
  type DayQuery,
  findSlots,
  formatTimeIn,
  heatLevel,
  pickOption,
  type ServiceSpec,
  type StaffAvailability,
  scanDay,
  utcToZoned,
  type WeeklyRule,
  zonedToUtc,
} from '../src/index.js';

const TZ = 'Asia/Tashkent';
const MONDAY = '2026-11-16';
const SUNDAY = '2026-11-15';
const MIN = 60_000;

const rules: BookingRules = { minNoticeMin: 0, horizonDays: 30, slotStepMin: 30 };

function weekly(days: number[], start: string, end: string): WeeklyRule[] {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return days.map((weekday) => ({ weekday, startMin: sh * 60 + sm, endMin: eh * 60 + em }));
}

const MON_SAT = [1, 2, 3, 4, 5, 6];

function service(id: string, durationMin: number, extra: Partial<ServiceSpec> = {}): ServiceSpec {
  return { id, durationMin, bufferBeforeMin: 0, bufferAfterMin: 0, price: 50_000, ...extra };
}

function staff(id: string, overrides: Partial<StaffAvailability> = {}): StaffAvailability {
  return {
    staffId: id,
    services: { cut: {}, beard: {}, combo: {} },
    workingHours: weekly(MON_SAT, '10:00', '20:00'),
    breaks: weekly(MON_SAT, '13:00', '14:00'),
    timeOff: [],
    busy: [],
    ...overrides,
  };
}

function at(date: string, hm: string, tz = TZ): number {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, tz);
}

function times(q: DayQuery): string[] {
  return findSlots(q).map((s) => formatTimeIn(s.start, q.timeZone));
}

function query(overrides: Partial<DayQuery> = {}): DayQuery {
  const date = overrides.date ?? MONDAY;
  const timeZone = overrides.timeZone ?? TZ;
  return {
    timeZone,
    date,
    services: [service('cut', 60)],
    staff: [staff('a')],
    // default "now": midnight two days before the queried date
    now: zonedToUtc(addDays(date, -2), 0, timeZone),
    rules,
    ...overrides,
  };
}

describe('slot engine: working hours and breaks', () => {
  it('generates grid-aligned slots inside working hours, skipping the lunch break', () => {
    const t = times(query());
    expect(t[0]).toBe('10:00');
    expect(t).toContain('12:00');
    expect(t).not.toContain('12:30'); // would end 13:30, inside the break
    expect(t).not.toContain('13:00');
    expect(t).not.toContain('13:30');
    expect(t).toContain('14:00');
    expect(t.at(-1)).toBe('19:00'); // last 60-minute slot ends at 20:00
    expect(t).toHaveLength(5 + 11); // 10:00–12:00 (5) and 14:00–19:00 (11)
  });

  it('returns nothing on a day off', () => {
    expect(findSlots(query({ date: SUNDAY }))).toEqual([]);
  });

  it('returns nothing when the whole day is a holiday', () => {
    const holiday = { start: at(MONDAY, '00:00'), end: at('2026-11-17', '00:00') };
    expect(findSlots(query({ staff: [staff('a', { timeOff: [holiday] })] }))).toEqual([]);
  });

  it('respects a partial time block', () => {
    const block = { start: at(MONDAY, '15:00'), end: at(MONDAY, '17:00') };
    const t = times(query({ staff: [staff('a', { timeOff: [block] })] }));
    expect(t).toContain('14:00');
    expect(t).not.toContain('14:30');
    expect(t).not.toContain('16:30');
    expect(t).toContain('17:00');
  });

  it('supports several intervals per day (split shift)', () => {
    const s = staff('a', {
      workingHours: [...weekly([1], '09:00', '12:00'), ...weekly([1], '16:00', '18:00')],
      breaks: [],
    });
    expect(times(query({ staff: [s] }))).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '16:00',
      '16:30',
      '17:00',
    ]);
  });

  it('aligns starts to the local grid even when a shift starts off-grid', () => {
    const s = staff('a', { workingHours: weekly([1], '10:10', '12:00'), breaks: [] });
    expect(times(query({ staff: [s], rules: { ...rules, slotStepMin: 15 } }))).toEqual([
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
  });
});

describe('slot engine: bookings and buffers', () => {
  it('blocks slots that overlap an existing booking', () => {
    const busy = [{ start: at(MONDAY, '15:00'), end: at(MONDAY, '16:00') }];
    const t = times(query({ staff: [staff('a', { busy })] }));
    expect(t).toContain('14:00');
    expect(t).not.toContain('14:30');
    expect(t).not.toContain('15:00');
    expect(t).not.toContain('15:30');
    expect(t).toContain('16:00');
  });

  it('widens the new booking by its buffers when checking conflicts', () => {
    const busy = [{ start: at(MONDAY, '15:30'), end: at(MONDAY, '16:30') }];
    const cut = service('cut', 60, { bufferBeforeMin: 10, bufferAfterMin: 15 });
    const t = times(
      query({ services: [cut], staff: [staff('a', { busy })], rules: { ...rules, slotStepMin: 5 } }),
    );
    // 14:15 ends 15:15, plus 15 min clean-up = 15:30 → touches the booking, allowed
    expect(t).toContain('14:15');
    expect(t).not.toContain('14:20');
    // after the booking: 16:30 + 10 min preparation → 16:40 is the first start
    expect(t).not.toContain('16:35');
    expect(t).toContain('16:40');
  });

  it('lets buffers spill outside working hours but keeps service time inside', () => {
    const cut = service('cut', 60, { bufferBeforeMin: 15, bufferAfterMin: 15 });
    const t = times(query({ services: [cut] }));
    expect(t[0]).toBe('10:00');
    expect(t.at(-1)).toBe('19:00');
  });

  it('treats intervals as half-open: back-to-back bookings are allowed', () => {
    const busy = [{ start: at(MONDAY, '11:00'), end: at(MONDAY, '12:00') }];
    const t = times(query({ staff: [staff('a', { busy })] }));
    expect(t).toContain('10:00');
    expect(t).toContain('12:00');
  });
});

describe('slot engine: multi-service and per-master overrides', () => {
  const cut = service('cut', 45, { bufferAfterMin: 5, price: 60_000 });
  const beard = service('beard', 30, { bufferBeforeMin: 10, price: 40_000 });

  it('chains services with max(bufferAfter, bufferBefore) between them', () => {
    const plan = buildPlan([cut, beard], { cut: {}, beard: {} })!;
    expect(plan.items.map((i) => i.offsetMin)).toEqual([0, 55]);
    expect(plan.totalMin).toBe(85);
    expect(plan.price).toBe(100_000);
    expect(plan.bufferBeforeMin).toBe(0);
    expect(plan.bufferAfterMin).toBe(0);
  });

  it('uses the master-specific duration and price', () => {
    const plan = buildPlan([cut], { cut: { durationMin: 30, price: 90_000 } })!;
    expect(plan.totalMin).toBe(30);
    expect(plan.price).toBe(90_000);
  });

  it('fits the whole chain before the break', () => {
    const t = times(query({ services: [cut, beard], rules: { ...rules, slotStepMin: 15 } }));
    expect(t).toContain('11:30'); // 11:30 + 85 min = 12:55
    expect(t).not.toContain('11:45'); // would end 13:10
  });

  it('excludes masters who do not offer every requested service', () => {
    const onlyCuts = staff('b', { services: { cut: {} } });
    const slots = findSlots(query({ services: [cut, beard], staff: [staff('a'), onlyCuts] }));
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.options.map((o) => o.staffId)).toEqual(['a']);
  });

  it('"any master" merges availability and picks the least loaded master', () => {
    const busyA = [{ start: at(MONDAY, '10:00'), end: at(MONDAY, '12:00') }];
    const slots = findSlots(query({ staff: [staff('a', { busy: busyA }), staff('b')] }));
    const ten = slots.find((s) => formatTimeIn(s.start, TZ) === '10:00')!;
    expect(ten.options.map((o) => o.staffId)).toEqual(['b']);
    const three = slots.find((s) => formatTimeIn(s.start, TZ) === '15:00')!;
    expect(three.options.map((o) => o.staffId)).toEqual(['a', 'b']);
    expect(pickOption(three.options, { a: 120, b: 0 }).staffId).toBe('b');
    expect(pickOption(three.options, { a: 0, b: 0 }).staffId).toBe('a');
  });
});

describe('slot engine: notice and horizon', () => {
  it('hides slots closer than the minimum notice', () => {
    const now = at(MONDAY, '09:10');
    const t = times(query({ now, rules: { ...rules, minNoticeMin: 60, slotStepMin: 15 } }));
    expect(t[0]).toBe('10:15');
  });

  it('never offers past slots even with zero notice', () => {
    const now = at(MONDAY, '19:01');
    expect(times(query({ now }))).toEqual([]);
  });

  it('allows the last day of the horizon and nothing after', () => {
    const now = at('2026-11-02', '09:00');
    const r = { ...rules, horizonDays: 14 };
    expect(findSlots(query({ now, rules: r, date: MONDAY })).length).toBeGreaterThan(0); // 14 days ahead
    expect(findSlots(query({ now, rules: r, date: '2026-11-17' }))).toEqual([]);
  });
});

describe('slot engine: midnight edges', () => {
  const night = staff('n', { workingHours: weekly([5], '20:00', '26:00'), breaks: [] });
  const FRIDAY = '2026-11-20';
  const SATURDAY = '2026-11-21';

  it('a shift ending at 24:00 offers a slot that ends exactly at midnight', () => {
    const s = staff('a', { workingHours: weekly([1], '18:00', '24:00'), breaks: [] });
    expect(times(query({ staff: [s] })).at(-1)).toBe('23:00');
  });

  it('overnight shift: evening slots belong to the starting day', () => {
    const t = times(query({ date: FRIDAY, staff: [night] }));
    expect(t[0]).toBe('20:00');
    expect(t.at(-1)).toBe('23:30');
  });

  it('overnight shift: after-midnight slots appear on the next date', () => {
    const t = times(query({ date: SATURDAY, staff: [night] }));
    expect(t).toEqual(['00:00', '00:30', '01:00']);
    for (const s of findSlots(query({ date: SATURDAY, staff: [night] }))) {
      expect(utcToZoned(s.start, TZ).date).toBe(SATURDAY);
    }
  });

  it('a booking crossing midnight blocks both sides', () => {
    const busy = [{ start: at(FRIDAY, '23:30'), end: at(SATURDAY, '00:30') }];
    const s = { ...night, busy };
    expect(times(query({ date: FRIDAY, staff: [s] })).at(-1)).toBe('22:30');
    expect(times(query({ date: SATURDAY, staff: [s] }))).toEqual(['00:30', '01:00']);
  });
});

describe('slot engine: daylight saving time', () => {
  const BERLIN = 'Europe/Berlin';
  const nightShift = (weekday: number) =>
    staff('d', { workingHours: weekly([weekday], '00:00', '06:00'), breaks: [] });

  it('spring forward: the missing hour produces no slot and each slot lasts 60 real minutes', () => {
    const q = query({
      timeZone: BERLIN,
      date: '2026-03-29',
      staff: [nightShift(7)],
      rules: { ...rules, slotStepMin: 60 },
    });
    const slots = findSlots(q);
    expect(slots.map((s) => formatTimeIn(s.start, BERLIN))).toEqual([
      '00:00',
      '01:00',
      '03:00',
      '04:00',
      '05:00',
    ]);
    for (const s of slots) expect(s.options[0]!.end - s.start).toBe(60 * MIN);
  });

  it('fall back: the repeated hour is offered twice as distinct instants', () => {
    const q = query({
      timeZone: BERLIN,
      date: '2026-10-25',
      staff: [nightShift(7)],
      rules: { ...rules, slotStepMin: 60 },
    });
    const slots = findSlots(q);
    expect(slots.map((s) => formatTimeIn(s.start, BERLIN))).toEqual([
      '00:00',
      '01:00',
      '02:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
    ]);
    expect(new Set(slots.map((s) => s.start)).size).toBe(7);
  });

  it('a normal working day is unaffected by DST elsewhere in the year', () => {
    const q = query({
      timeZone: 'America/New_York',
      date: '2026-03-09',
      staff: [staff('a', { breaks: [] })],
    });
    const t = times(q);
    expect(t[0]).toBe('10:00');
    expect(t.at(-1)).toBe('19:00');
    expect(findSlots(q)[0]!.start).toBe(Date.UTC(2026, 2, 9, 14, 0)); // EDT = UTC−4
  });
});

describe('checkFit', () => {
  const base = {
    timeZone: TZ,
    services: [service('cut', 60)],
    now: at(MONDAY, '09:00'),
    rules: { ...rules, minNoticeMin: 60 },
  };

  it('accepts a free slot and returns the occupied window', () => {
    const res = checkFit({
      ...base,
      staff: staff('a'),
      start: at(MONDAY, '11:00'),
      enforceCustomerRules: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.option.occupied).toEqual({ start: at(MONDAY, '11:00'), end: at(MONDAY, '12:00') });
  });

  it('rejects the break, conflicts and too-soon starts with precise reasons', () => {
    const busy = [{ start: at(MONDAY, '15:00'), end: at(MONDAY, '16:00') }];
    const s = staff('a', { busy });
    const fit = (hm: string, enforce = true) =>
      checkFit({ ...base, staff: s, start: at(MONDAY, hm), enforceCustomerRules: enforce });
    expect(fit('12:30')).toEqual({ ok: false, reason: 'NOT_WORKING' });
    expect(fit('15:30')).toEqual({ ok: false, reason: 'CONFLICT' });
    expect(fit('09:30')).toEqual({ ok: false, reason: 'TOO_SOON' });
    expect(fit('08:00')).toEqual({ ok: false, reason: 'IN_PAST' });
    // Admins can place a walk-in off the grid, but never into a conflict
    expect(fit('10:05', false).ok).toBe(true);
    expect(fit('15:30', false)).toEqual({ ok: false, reason: 'CONFLICT' });
  });

  it('rejects masters who do not offer the service', () => {
    const res = checkFit({
      ...base,
      staff: staff('a', { services: {} }),
      start: at(MONDAY, '11:00'),
      enforceCustomerRules: true,
    });
    expect(res).toEqual({ ok: false, reason: 'SERVICE_NOT_OFFERED' });
  });

  it('agrees with findSlots for every grid start of the day', () => {
    const busy = [{ start: at(MONDAY, '15:00'), end: at(MONDAY, '16:20') }];
    const s = staff('a', { busy });
    const q = query({ staff: [s], rules: { ...rules, slotStepMin: 15 } });
    const free = new Set(findSlots(q).map((x) => x.start));
    for (let m = 0; m < 24 * 60; m += 15) {
      const start = zonedToUtc(MONDAY, m, TZ);
      const fit = checkFit({ ...q, staff: s, start, enforceCustomerRules: true });
      expect(fit.ok, `minute ${m}`).toBe(free.has(start));
    }
  });
});

describe('heatmap', () => {
  it('reports capacity independent of bookings', () => {
    const empty = scanDay(query());
    const busy = scanDay(
      query({ staff: [staff('a', { busy: [{ start: at(MONDAY, '10:00'), end: at(MONDAY, '20:00') }] })] }),
    );
    expect(empty.capacity).toBe(busy.capacity);
    expect(busy.slots).toHaveLength(0);
  });

  it('maps ratios to levels', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
  });
});
