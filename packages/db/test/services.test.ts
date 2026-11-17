import { DomainError, formatTimeIn } from '@navbat/core';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cancelBooking,
  claimDueJobs,
  confirmPayment,
  createBooking,
  createTimeOff,
  customerFromTelegram,
  DEMO_IDS,
  DEMO_TZ,
  enqueueDailyDigests,
  exportBookingsCsv,
  getAnalytics,
  getCalendar,
  getCatalog,
  getClient,
  getMonthAvailability,
  getSchedule,
  getSlots,
  leaveReview,
  listClients,
  listCustomerBookings,
  listNotifications,
  markFailed,
  markSent,
  migrate,
  reportRunningLate,
  rescheduleBooking,
  saveSchedule,
  saveService,
  saveStaff,
  setBookingStatus,
} from '../src/index.js';
import { at, freshDb, NOW, TODAY } from './helpers.js';

type Env = Awaited<ReturnType<typeof freshDb>>;
let env: Env | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

async function setup(opts?: Parameters<typeof freshDb>[0]) {
  env = await freshDb(opts);
  return env;
}

const visitor = (e: Env) => ({ kind: 'customer' as const, customerId: e.seed.visitorCustomerId });
const owner = (e: Env) => ({
  kind: 'staff' as const,
  staffId: e.seed.staffIds.owner,
  role: 'owner' as const,
});

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('schema and seed', () => {
  it('migrations are idempotent', async () => {
    const e = await setup();
    expect(await migrate(e.db)).toEqual([]);
  });

  it('seeds a realistic history without violating the exclusion constraint', async () => {
    const e = await setup({ history: true });
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from bookings`.execute(e.db);
    expect(rows[0]!.n).toBeGreaterThan(300);
    const catalog = await getCatalog(e.db, 'demo');
    expect(catalog.business.name).toBe('Demo Barbershop');
    expect(catalog.business.timezone).toBe(DEMO_TZ);
    expect(catalog.staff.filter((s) => s.bookable)).toHaveLength(4);
    expect(catalog.staff.find((s) => s.name.startsWith('Jasur'))!.rating).toBeGreaterThan(3);
  });
});

describe('availability', () => {
  it('returns slots from the real schedule (Jasur: 10–20, lunch 14–15)', async () => {
    const e = await setup();
    const slots = await getSlots(e.db, {
      businessId: e.seed.businessId,
      date: '2026-11-13',
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      now: NOW,
    });
    const times = slots.map((s) => formatTimeIn(s.start, DEMO_TZ));
    expect(times[0]).toBe('10:00');
    expect(times).toContain('13:15');
    expect(times).not.toContain('13:30');
    expect(times).toContain('15:00');
    expect(times.at(-1)).toBe('19:15');
    expect(slots[0]!.options[0]!.price).toBe(80_000); // Jasur's own price
  });

  it('builds a month heatmap with closed days', async () => {
    const e = await setup();
    const days = await getMonthAvailability(e.db, {
      businessId: e.seed.businessId,
      month: TODAY,
      serviceIds: [e.seed.serviceIds.shave!],
      staffId: e.seed.staffIds.masters[2]!, // Sardor: no Sundays
      now: NOW,
    });
    expect(days).toHaveLength(30);
    expect(days.find((d) => d.date === '2026-11-15')).toMatchObject({ level: 0, bookable: false });
    expect(days.find((d) => d.date === '2026-11-16')!.level).toBe(4);
    expect(days.find((d) => d.date === '2026-11-01')!.bookable).toBe(false); // past
  });
});

describe('booking lifecycle', () => {
  it('creates a confirmed booking and queues confirmation, reminders and staff alerts', async () => {
    const e = await setup();
    const { booking, payment } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!, e.seed.serviceIds.beard!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(2, '11:00'),
      actor: visitor(e),
      customer: { name: 'Akmal', phone: '90 000 00 01' },
    });
    expect(payment).toBeNull();
    expect(booking.status).toBe('confirmed');
    expect(booking.code).toMatch(/^N-/);
    expect(booking.items).toHaveLength(2);
    expect(booking.endAt - booking.startAt).toBe(75 * 60_000);
    expect(booking.totalPrice).toBe(130_000);
    const jobs = await listNotifications(e.db, e.seed.businessId);
    const kinds = jobs.map((j) => `${j.kind}:${j.chatId}`).sort();
    expect(kinds).toEqual(
      [
        `admin_new_booking:${DEMO_IDS.admin}`,
        `admin_new_booking:${DEMO_IDS.masters[0]}`,
        `admin_new_booking:${DEMO_IDS.owner}`,
        `booking_confirmed:${DEMO_IDS.visitor}`,
        `reminder_24h:${DEMO_IDS.visitor}`,
        `reminder_2h:${DEMO_IDS.visitor}`,
      ].sort(),
    );
    expect(jobs.find((j) => j.kind === 'reminder_2h')!.sendAt).toBe(booking.startAt - 2 * 3_600_000);
  });

  it('refuses a second booking on the same master and time', async () => {
    const e = await setup();
    const input = {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(1, '10:00'),
      actor: owner(e),
      customer: { name: 'Walk-in' },
      source: 'walkin' as const,
    };
    await createBooking(e.ctx, input);
    expect(await errorCode(createBooking(e.ctx, { ...input, start: at(1, '10:30') }))).toBe(
      'SLOT_UNAVAILABLE',
    );
  });

  it('PostgreSQL rejects overlapping rows even when the app check is bypassed', async () => {
    const e = await setup();
    const { booking } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(1, '10:00'),
      actor: owner(e),
      customer: { name: 'A' },
    });
    const raw = e.db
      .insertInto('bookings')
      .values({
        business_id: e.seed.businessId,
        staff_id: booking.staffId,
        customer_id: booking.customer.id,
        code: 'N-RACE',
        status: 'confirmed',
        start_at: new Date(at(1, '10:30')),
        end_at: new Date(at(1, '11:00')),
        occupied_start: new Date(at(1, '10:30')),
        occupied_end: new Date(at(1, '11:00')),
      })
      .execute();
    await expect(raw).rejects.toMatchObject({ code: '23P01' });
  });

  it('"any master" spreads simultaneous bookings across masters', async () => {
    const e = await setup();
    const make = () =>
      createBooking(e.ctx, {
        businessId: e.seed.businessId,
        serviceIds: [e.seed.serviceIds.classic!],
        staffId: null,
        start: at(1, '12:00'),
        actor: owner(e),
        customer: { name: 'Guest' },
      });
    const staffIds = new Set<string>();
    for (let i = 0; i < 4; i++) staffIds.add((await make()).booking.staffId);
    expect(staffIds.size).toBe(4); // Jasur, Bekzod, Sardor, Diyor all free at 12:00 on Friday
    expect(await errorCode(make())).toBe('SLOT_UNAVAILABLE');
  });

  it('enforces notice for customers but lets staff book walk-ins right now', async () => {
    const e = await setup();
    const base = {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[2]!, // Sardor starts at 09:00
      start: at(0, '08:15'),
    };
    e.setNow(at(0, '09:00'));
    const soon = { ...base, start: at(0, '09:15') };
    expect(
      await errorCode(createBooking(e.ctx, { ...soon, actor: visitor(e), customer: { name: 'A' } })),
    ).toBe('TOO_SOON');
    const walkin = await createBooking(e.ctx, {
      ...soon,
      actor: owner(e),
      customer: { name: 'Walk-in' },
      source: 'walkin',
    });
    expect(walkin.booking.source).toBe('walkin');
  });

  it('reschedules, replaces reminders and respects the cancellation window', async () => {
    const e = await setup();
    const { booking } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(2, '11:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    });
    const moved = await rescheduleBooking(e.ctx, {
      businessId: e.seed.businessId,
      bookingId: booking.id,
      start: at(4, '16:00'),
      actor: visitor(e),
    });
    expect(moved.startAt).toBe(at(4, '16:00'));
    const jobs = await listNotifications(e.db, e.seed.businessId, { chatId: DEMO_IDS.visitor });
    const reminders = jobs.filter((j) => j.kind.startsWith('reminder'));
    expect(reminders.filter((j) => j.status === 'cancelled')).toHaveLength(2);
    expect(
      reminders
        .filter((j) => j.status === 'pending')
        .map((j) => j.sendAt)
        .sort(),
    ).toEqual([at(3, '16:00'), at(4, '14:00')].sort());
    expect(jobs.some((j) => j.kind === 'booking_rescheduled')).toBe(true);

    e.setNow(at(4, '15:00'));
    expect(
      await errorCode(
        rescheduleBooking(e.ctx, {
          businessId: e.seed.businessId,
          bookingId: booking.id,
          start: at(5, '11:00'),
          actor: visitor(e),
        }),
      ),
    ).toBe('CANCEL_WINDOW_PASSED');
    expect(
      await errorCode(
        cancelBooking(e.ctx, { businessId: e.seed.businessId, bookingId: booking.id, actor: visitor(e) }),
      ),
    ).toBe('CANCEL_WINDOW_PASSED');
    // the salon can still cancel
    const c = await cancelBooking(e.ctx, {
      businessId: e.seed.businessId,
      bookingId: booking.id,
      actor: owner(e),
      reason: 'ill',
    });
    expect(c.status).toBe('cancelled');
  });

  it('a cancelled booking frees the slot', async () => {
    const e = await setup();
    const input = {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(2, '11:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    };
    const { booking } = await createBooking(e.ctx, input);
    await cancelBooking(e.ctx, { businessId: e.seed.businessId, bookingId: booking.id, actor: visitor(e) });
    const again = await createBooking(e.ctx, input);
    expect(again.booking.status).toBe('confirmed');
    const kinds = (await listNotifications(e.db, e.seed.businessId)).map((j) => j.kind);
    expect(kinds).toContain('booking_cancelled');
    expect(kinds).toContain('admin_cancelled');
  });

  it('completes a visit, requests a review and accepts it once', async () => {
    const e = await setup();
    const { booking } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(1, '10:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    });
    const review = {
      businessId: e.seed.businessId,
      bookingId: booking.id,
      customerId: e.seed.visitorCustomerId,
      rating: 5,
    };
    expect(await errorCode(leaveReview(e.ctx, review))).toBe('REVIEW_NOT_ALLOWED');
    e.setNow(at(1, '11:00'));
    const master = { kind: 'staff' as const, staffId: booking.staffId, role: 'master' as const };
    const done = await setBookingStatus(e.ctx, {
      businessId: e.seed.businessId,
      bookingId: booking.id,
      event: 'complete',
      actor: master,
    });
    expect(done.status).toBe('completed');
    const reviewed = await leaveReview(e.ctx, { ...review, comment: 'Zoʻr!' });
    expect(reviewed.review).toEqual({ rating: 5, comment: 'Zoʻr!' });
    expect(await errorCode(leaveReview(e.ctx, review))).toBe('REVIEW_NOT_ALLOWED');
    const jobs = await listNotifications(e.db, e.seed.businessId, { chatId: DEMO_IDS.visitor });
    expect(jobs.some((j) => j.kind === 'review_request')).toBe(true);
  });

  it('records "running late" and alerts staff', async () => {
    const e = await setup();
    const { booking } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(1, '12:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    });
    const late = { businessId: e.seed.businessId, bookingId: booking.id, minutes: 10, actor: visitor(e) };
    expect(await errorCode(reportRunningLate(e.ctx, late))).toBe('VALIDATION'); // a day early
    e.setNow(at(1, '10:30'));
    expect((await reportRunningLate(e.ctx, late)).runningLateMin).toBe(10);
    const staffJobs = (await listNotifications(e.db, e.seed.businessId)).filter(
      (j) => j.kind === 'admin_running_late',
    );
    expect(staffJobs.map((j) => j.chatId).sort()).toEqual(
      [DEMO_IDS.owner, DEMO_IDS.admin, DEMO_IDS.masters[0]].sort(),
    );
  });

  it("lists a customer's bookings newest first", async () => {
    const e = await setup();
    for (const day of [1, 2]) {
      await createBooking(e.ctx, {
        businessId: e.seed.businessId,
        serviceIds: [e.seed.serviceIds.classic!],
        staffId: e.seed.staffIds.masters[0]!,
        start: at(day, '10:00'),
        actor: visitor(e),
        customer: { name: 'Akmal' },
      });
    }
    const list = await listCustomerBookings(e.db, e.seed.businessId, e.seed.visitorCustomerId);
    expect(list.map((b) => b.startAt)).toEqual([at(2, '10:00'), at(1, '10:00')]);
  });
});

describe('prepayment', () => {
  it('holds the slot as pending until the sandbox payment succeeds', async () => {
    const e = await setup({ depositPercent: 20 });
    const { booking, payment } = await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.fade!],
      staffId: e.seed.staffIds.masters[1]!,
      start: at(1, '12:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    });
    expect(booking.status).toBe('pending');
    expect(payment).toMatchObject({ provider: 'sandbox', amount: 18_000 });
    const event = e.sandbox.complete(payment!.reference);
    expect(event.type).toBe('paid');
    const paid = await confirmPayment(e.ctx, { reference: payment!.reference });
    expect(paid).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    // idempotent webhook
    expect((await confirmPayment(e.ctx, { reference: payment!.reference }))!.status).toBe('confirmed');
    const kinds = (await listNotifications(e.db, e.seed.businessId)).map((j) => j.kind);
    expect(kinds.filter((k) => k === 'booking_confirmed')).toHaveLength(1);
    expect(kinds).toContain('booking_awaiting_payment');
  });
});

describe('admin', () => {
  it('blocks time and shows it on the calendar', async () => {
    const e = await setup();
    const jasur = e.seed.staffIds.masters[0]!;
    await createTimeOff(e.db, {
      businessId: e.seed.businessId,
      staffId: jasur,
      start: at(1, '10:00'),
      end: at(1, '12:00'),
      reason: 'Dentist',
    });
    const slots = await getSlots(e.db, {
      businessId: e.seed.businessId,
      date: '2026-11-13',
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: jasur,
      now: NOW,
    });
    expect(formatTimeIn(slots[0]!.start, DEMO_TZ)).toBe('12:00');
    const cal = await getCalendar(e.db, {
      businessId: e.seed.businessId,
      from: '2026-11-13',
      to: '2026-11-13',
    });
    expect(cal.timeOff).toHaveLength(1);
    const day = cal.working.find((w) => w.staffId === jasur)!;
    expect(day.intervals.map((i) => [formatTimeIn(i.start, DEMO_TZ), formatTimeIn(i.end, DEMO_TZ)])).toEqual([
      ['10:00', '14:00'],
      ['15:00', '20:00'],
    ]);
  });

  it('manages services, staff and schedules', async () => {
    const e = await setup();
    const svc = await saveService(e.db, e.seed.businessId, {
      name: { uz: 'Massaj', ru: 'Массаж', en: 'Massage' },
      durationMin: 30,
      price: 40_000,
      bufferAfterMin: 5,
    });
    const staff = await saveStaff(e.db, e.seed.businessId, {
      name: 'New Master',
      services: [{ serviceId: svc.id, price: 45_000 }],
    });
    await saveSchedule(e.db, e.seed.businessId, staff.id, [
      { kind: 'work', weekday: 5, startMin: 600, endMin: 720 },
      { kind: 'break', weekday: 5, startMin: 660, endMin: 690 },
    ]);
    const slots = await getSlots(e.db, {
      businessId: e.seed.businessId,
      date: '2026-11-13',
      serviceIds: [svc.id],
      staffId: staff.id,
      now: NOW,
    });
    expect(slots.map((s) => formatTimeIn(s.start, DEMO_TZ))).toEqual(['10:00', '10:15', '10:30', '11:30']);
    expect(slots[0]!.options[0]!.price).toBe(45_000);
    await expect(
      saveService(e.db, e.seed.businessId, { name: {}, durationMin: 30, price: 1 }),
    ).rejects.toThrow(DomainError);
    await expect(
      saveSchedule(e.db, e.seed.businessId, staff.id, [
        { kind: 'work', weekday: 8, startMin: 0, endMin: 60 },
      ]),
    ).rejects.toThrow(DomainError);
  });

  it('reports clients with visits and no-shows, analytics and CSV', async () => {
    const e = await setup({ history: true });
    const clients = await listClients(e.db, { businessId: e.seed.businessId, now: NOW });
    expect(clients.length).toBeGreaterThan(20);
    expect(clients.some((c) => c.noShows > 0)).toBe(true);
    const top = clients.find((c) => c.visits > 0)!;
    const details = await getClient(e.db, { businessId: e.seed.businessId, customerId: top.id, now: NOW });
    expect(details.history.length).toBeGreaterThanOrEqual(top.visits);
    expect(
      await listClients(e.db, { businessId: e.seed.businessId, now: NOW, search: 'akmal' }),
    ).not.toHaveLength(0);

    const a = await getAnalytics(e.db, {
      businessId: e.seed.businessId,
      from: '2026-10-13',
      to: '2026-11-11',
      now: NOW,
    });
    expect(a.totals.completed).toBeGreaterThan(50);
    expect(a.totals.revenue).toBeGreaterThan(1_000_000);
    expect(a.totals.utilisation).toBeGreaterThan(0.2);
    expect(a.totals.utilisation).toBeLessThan(1);
    expect(a.byDay).toHaveLength(30);
    expect(a.topServices[0]!.count).toBeGreaterThan(0);
    expect(a.byStaff).toHaveLength(4);

    const csv = await exportBookingsCsv(e.db, {
      businessId: e.seed.businessId,
      from: TODAY,
      to: TODAY,
      lang: 'ru',
    });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Код,Дата,Начало,Конец,Мастер,Услуги,Клиент,Телефон,Статус,Цена,Источник');
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('notifications outbox', () => {
  it('claims due jobs once, retries failures with backoff', async () => {
    const e = await setup();
    await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(2, '11:00'),
      actor: visitor(e),
      customer: { name: 'Akmal' },
    });
    const due = await claimDueJobs(e.db, NOW);
    expect(due.map((j) => j.kind).sort()).toEqual([
      'admin_new_booking',
      'admin_new_booking',
      'admin_new_booking',
      'booking_confirmed',
    ]);
    expect(await claimDueJobs(e.db, NOW)).toEqual([]);
    await markSent(e.db, due[0]!.id, NOW);
    await markFailed(e.db, due[1]!.id, NOW, 'Too Many Requests');
    expect(await claimDueJobs(e.db, NOW)).toEqual([]);
    expect((await claimDueJobs(e.db, NOW + 60_000)).map((j) => j.id)).toEqual([due[1]!.id]);
    // reminders become due later
    expect((await claimDueJobs(e.db, at(1, '11:00'))).map((j) => j.kind)).toEqual(['reminder_24h']);
  });

  it("queues each master's daily digest once", async () => {
    const e = await setup({ history: true });
    e.setNow(at(0, '07:00'));
    expect(await enqueueDailyDigests(e.ctx, e.seed.businessId)).toBe(0); // before 08:00
    e.setNow(at(0, '08:05'));
    expect(await enqueueDailyDigests(e.ctx, e.seed.businessId)).toBe(4);
    expect(await enqueueDailyDigests(e.ctx, e.seed.businessId)).toBe(0);
    const digest = (await listNotifications(e.db, e.seed.businessId)).find(
      (j) => j.kind === 'master_digest',
    )!;
    expect((digest.payload as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it('creates customers from Telegram with their language', async () => {
    const e = await setup();
    const c = await customerFromTelegram(e.db, e.seed.businessId, {
      id: 777,
      first_name: 'Ivan',
      language_code: 'ru',
    });
    expect(c).toMatchObject({ isNew: true, lang: 'ru', name: 'Ivan' });
    expect((await customerFromTelegram(e.db, e.seed.businessId, { id: 777, first_name: 'Ivan' })).isNew).toBe(
      false,
    );
  });
});

describe('tenant isolation and abuse limits', () => {
  async function foreignMaster(e: Env) {
    const other = await e.db
      .insertInto('businesses')
      .values({ slug: 'other-shop', name: 'Other shop' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const staff = await e.db
      .insertInto('staff')
      .values({ business_id: other.id, name: 'Foreign master' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await saveSchedule(e.db, other.id, staff.id, [{ kind: 'work', weekday: 1, startMin: 600, endMin: 1200 }]);
    return staff.id;
  }

  it("does not read or block another business's master", async () => {
    const e = await setup();
    const foreign = await foreignMaster(e);
    expect(await errorCode(getSchedule(e.db, e.seed.businessId, foreign))).toBe('NOT_FOUND');
    expect(
      await errorCode(
        createTimeOff(e.db, {
          businessId: e.seed.businessId,
          staffId: foreign,
          start: at(1, '10:00'),
          end: at(1, '12:00'),
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(await getSchedule(e.db, e.seed.businessId, e.seed.staffIds.masters[0]!)).not.toHaveLength(0);
  });
});
