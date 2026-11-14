import { formatTimeIn, signInitData } from '@navbat/core';
import { DEMO_TZ } from '@navbat/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, BOT_TOKEN, createTestEnv, NOW, type TestEnv, VISITOR } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env?.close();
});

const B = '/api/b/demo';

describe('health and public catalog', () => {
  it('reports health with a live database', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  it('serves the catalog without auth', async () => {
    const res = await env.app.inject({ method: 'GET', url: `${B}/catalog` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.business).toMatchObject({ name: 'Demo Barbershop', timezone: 'Asia/Tashkent' });
    expect(body.services).toHaveLength(8);
    expect(body.staff.filter((s: { bookable: boolean }) => s.bookable)).toHaveLength(4);
  });

  it('returns 404 for an unknown business and unknown routes', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/b/nope/catalog' })).json().error.code).toBe(
      'NOT_FOUND',
    );
    expect((await env.app.inject({ method: 'GET', url: '/nothing' })).statusCode).toBe(404);
  });

  it('computes slots and the month heatmap', async () => {
    const jasur = env.seed.staffIds.masters[0];
    const classic = env.seed.serviceIds.classic;
    const res = await env.app.inject({
      method: 'GET',
      url: `${B}/slots?date=2026-11-13&services=${classic}&staff=${jasur}`,
    });
    expect(res.statusCode).toBe(200);
    const slots = res.json() as { start: number }[];
    expect(formatTimeIn(slots[0]!.start, DEMO_TZ)).toBe('10:00');

    const any = await env.app.inject({
      method: 'GET',
      url: `${B}/slots?date=2026-11-13&services=${classic}&staff=any`,
    });
    expect((any.json() as { options: unknown[] }[]).some((s) => s.options.length > 1)).toBe(true);

    const month = await env.app.inject({
      method: 'GET',
      url: `${B}/availability?month=2026-11-01&services=${classic}&staff=any`,
    });
    expect(month.json()).toHaveLength(30);

    const first = await env.app.inject({
      method: 'GET',
      url: `${B}/first-available?services=${classic}&staff=${jasur}`,
    });
    expect(first.json()).toEqual({ date: '2026-11-12' });
  });

  it('rejects malformed queries with VALIDATION', async () => {
    const res = await env.app.inject({ method: 'GET', url: `${B}/slots?date=tomorrow&services=x` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.issues.length).toBeGreaterThan(0);
  });
});

describe('Telegram initData auth', () => {
  it('accepts valid initData and creates the customer on first contact', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `${B}/me`,
      headers: { authorization: await env.tma({ id: 5555, first_name: 'Ivan', language_code: 'ru' }) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ customer: { name: 'Ivan', lang: 'ru' }, staff: null });
  });

  it('recognises staff members', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `${B}/me`,
      headers: { authorization: await env.tma({ id: 2000 }) },
    });
    expect(res.json().staff).toMatchObject({ role: 'owner' });
  });

  it('rejects missing, forged and expired initData', async () => {
    const none = await env.app.inject({ method: 'GET', url: `${B}/me` });
    expect(none.statusCode).toBe(401);
    const forged = await signInitData(
      { user: { id: 1, first_name: 'X' }, authDate: Math.floor(NOW / 1000) },
      '999:other',
    );
    const bad = await env.app.inject({
      method: 'GET',
      url: `${B}/me`,
      headers: { authorization: `tma ${forged}` },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toContain('BAD_HASH');
    const old = await signInitData(
      { user: { id: 1, first_name: 'X' }, authDate: Math.floor(NOW / 1000) - 3 * 86_400 },
      BOT_TOKEN,
    );
    const expired = await env.app.inject({
      method: 'GET',
      url: `${B}/me`,
      headers: { authorization: `tma ${old}` },
    });
    expect(expired.json().error.message).toContain('EXPIRED');
  });

  it('ignores dev auth when dev mode is off', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `${B}/me`,
      headers: { authorization: 'dev 1001' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('updates language and contact details', async () => {
    const auth = await env.tma(VISITOR);
    const res = await env.app.inject({
      method: 'PATCH',
      url: `${B}/me`,
      headers: { authorization: auth },
      payload: { lang: 'en', phone: '+998 90 555 44 33' },
    });
    expect(res.json().customer).toMatchObject({ lang: 'en', phone: '+998905554433' });
    const bad = await env.app.inject({
      method: 'PATCH',
      url: `${B}/me`,
      headers: { authorization: auth },
      payload: { phone: '123' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('customer booking flow over HTTP', () => {
  let bookingId: string;

  it('books, lists and reads a booking', async () => {
    const auth = await env.tma(VISITOR);
    const res = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings`,
      headers: { authorization: auth },
      payload: {
        serviceIds: [env.seed.serviceIds.classic, env.seed.serviceIds.beard],
        staffId: env.seed.staffIds.masters[0],
        start: at(1, '11:00'),
        name: 'Akmal',
        phone: '90 000 00 01',
        notes: 'Window seat please',
      },
    });
    expect(res.statusCode).toBe(201);
    const { booking, payment } = res.json();
    expect(payment).toBeNull();
    expect(booking).toMatchObject({
      status: 'confirmed',
      totalPrice: 130_000,
      staffName: 'Jasur Aminov',
      notes: 'Window seat please',
    });
    bookingId = booking.id;

    const list = await env.app.inject({
      method: 'GET',
      url: `${B}/me/bookings`,
      headers: { authorization: auth },
    });
    expect(list.json().map((b: { id: string }) => b.id)).toContain(bookingId);
    const one = await env.app.inject({
      method: 'GET',
      url: `${B}/bookings/${bookingId}`,
      headers: { authorization: auth },
    });
    expect(one.json().code).toBe(booking.code);
  });

  it("hides other people's bookings", async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `${B}/bookings/${bookingId}`,
      headers: { authorization: await env.tma({ id: 4242 }) },
    });
    expect(res.statusCode).toBe(404);
    const cancel = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/cancel`,
      headers: { authorization: await env.tma({ id: 4242 }) },
      payload: {},
    });
    expect(cancel.statusCode).toBe(403);
    expect(cancel.json().error.code).toBe('FORBIDDEN');
  });

  it('refuses a taken slot with 409 SLOT_UNAVAILABLE', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings`,
      headers: { authorization: await env.tma({ id: 7001 }) },
      payload: {
        serviceIds: [env.seed.serviceIds.classic],
        staffId: env.seed.staffIds.masters[0],
        start: at(1, '11:30'),
        name: 'Late',
        phone: '901112233',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('refuses closed hours with 422 NOT_WORKING', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings`,
      headers: { authorization: await env.tma({ id: 7002 }) },
      payload: {
        serviceIds: [env.seed.serviceIds.classic],
        staffId: env.seed.staffIds.masters[0],
        start: at(1, '14:15'),
        name: 'Lunch',
        phone: '901112234',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NOT_WORKING');
  });

  it('reschedules and then cancels inside the policy window', async () => {
    const auth = await env.tma(VISITOR);
    const moved = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/reschedule`,
      headers: { authorization: auth },
      payload: { start: at(1, '16:00') },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().startAt).toBe(at(1, '16:00'));

    env.setNow(at(1, '14:30'));
    const late = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/late`,
      headers: { authorization: await env.tma(VISITOR) },
      payload: { minutes: 15 },
    });
    expect(late.json().runningLateMin).toBe(15);
    const tooLate = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/cancel`,
      headers: { authorization: await env.tma(VISITOR) },
      payload: {},
    });
    expect(tooLate.statusCode).toBe(422);
    expect(tooLate.json().error.code).toBe('CANCEL_WINDOW_PASSED');
    env.setNow(NOW);

    const cancelled = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/cancel`,
      headers: { authorization: auth },
      payload: { reason: 'Plans changed' },
    });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Plans changed' });
    const again = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${bookingId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('accepts a review only for a completed visit', async () => {
    const auth = await env.tma(VISITOR);
    const created = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings`,
      headers: { authorization: auth },
      payload: {
        serviceIds: [env.seed.serviceIds.kids],
        staffId: env.seed.staffIds.masters[1],
        start: at(1, '11:00'),
        name: 'Akmal',
        phone: '900000001',
      },
    });
    const id = created.json().booking.id as string;
    const early = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${id}/review`,
      headers: { authorization: auth },
      payload: { rating: 5 },
    });
    expect(early.json().error.code).toBe('REVIEW_NOT_ALLOWED');

    env.setNow(at(1, '12:00'));
    const done = await env.app.inject({
      method: 'POST',
      url: `${B}/admin/bookings/${id}/status`,
      headers: { authorization: await env.tma({ id: 2102 }) }, // Bekzod, the booking's master
      payload: { event: 'complete' },
    });
    expect(done.json().status).toBe('completed');
    const auth2 = await env.tma(VISITOR);
    const ok = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${id}/review`,
      headers: { authorization: auth2 },
      payload: { rating: 5, comment: 'Zoʻr' },
    });
    expect(ok.json().review).toEqual({ rating: 5, comment: 'Zoʻr' });
    const twice = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${id}/review`,
      headers: { authorization: auth2 },
      payload: { rating: 4 },
    });
    expect(twice.json().error.code).toBe('REVIEW_NOT_ALLOWED');
    const bad = await env.app.inject({
      method: 'POST',
      url: `${B}/bookings/${id}/review`,
      headers: { authorization: auth2 },
      payload: { rating: 9 },
    });
    expect(bad.statusCode).toBe(400);
    env.setNow(NOW);
  });
});
