import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickProvider, PaymeProvider, StarsProvider } from '../src/payments/providers.js';
import { CLICK_SECRET, OWNER_TG, PAYME_KEY, type TestEnv, VISITOR, at, createTestEnv } from './helpers.js';

let env: TestEnv;
const invoiceCalls: { url: string; body: Record<string, unknown> }[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  invoiceCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$fake-invoice' }), { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  env = await createTestEnv({ depositPercent: 20, deps: { fetch: fakeFetch } });
});
afterAll(async () => {
  await env?.close();
});

const B = '/api/b/demo';
const DAYS = [1, 2, 3, 5, 6, 7]; // Bekzod is off on Mondays
let slotIndex = 0;

async function useProvider(provider: string) {
  const res = await env.app.inject({
    method: 'PUT',
    url: `${B}/admin/settings`,
    headers: { authorization: await env.tma({ id: OWNER_TG }) },
    payload: { settings: { paymentProvider: provider, depositPercent: 20 } },
  });
  expect(res.statusCode).toBe(200);
}

async function book(tgId: number) {
  // Bekzod, Fade 90 000 → 18 000 deposit; a different day each time to avoid conflicts
  const day = DAYS[slotIndex++]!;
  const res = await env.app.inject({
    method: 'POST',
    url: `${B}/bookings`,
    headers: { authorization: await env.tma({ ...VISITOR, id: tgId }) },
    payload: {
      serviceIds: [env.seed.serviceIds.fade],
      staffId: env.seed.staffIds.masters[1],
      start: at(day, '12:00'),
      name: 'Payer',
      phone: `90${String(1_000_000 + tgId).slice(-7)}`,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const rpc = (method: string, params: Record<string, unknown>, key = PAYME_KEY) =>
  env.app.inject({
    method: 'POST',
    url: '/api/payments/payme',
    headers: { authorization: `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}` },
    payload: { jsonrpc: '2.0', id: 7, method, params },
  });

describe('sandbox deposit', () => {
  it('keeps the booking pending until the sandbox checkout completes', async () => {
    const { booking, payment } = await book(8001);
    expect(booking.status).toBe('pending');
    expect(payment).toMatchObject({ provider: 'sandbox', amount: 18_000 });
    expect(booking.payUrl).toBe(payment.payUrl);
    const res = await env.app.inject({ method: 'POST', url: `${B}/payments/sandbox/${payment.reference}/complete` });
    expect(res.json()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    const unknown = await env.app.inject({ method: 'POST', url: `${B}/payments/sandbox/nope/complete` });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('Payme merchant API', () => {
  it('builds the checkout URL with the amount in tiyin', async () => {
    const p = new PaymeProvider({ merchantId: 'm1', key: 'k' });
    const s = await p.createPayment({ bookingId: 'b-1', amount: 18_000, currency: 'UZS', description: 'd' });
    const decoded = Buffer.from(s.payUrl.split('/').pop()!, 'base64').toString();
    expect(decoded).toBe('m=m1;ac.booking_id=b-1;a=1800000');
  });

  it('runs the full Check → Create → Perform → CheckTransaction cycle', async () => {
    await useProvider('payme');
    const { booking, payment } = await book(8002);
    expect(payment.payUrl).toMatch(/^https:\/\/checkout\.paycom\.uz\//);
    const account = { booking_id: booking.id };

    expect((await rpc('CheckPerformTransaction', { amount: 1_800_000, account })).json().result).toEqual({ allow: true });
    expect((await rpc('CheckPerformTransaction', { amount: 100, account })).json().error.code).toBe(-31001);
    expect((await rpc('CheckPerformTransaction', { amount: 1_800_000, account: { booking_id: 'x' } })).json().error.code).toBe(-31050);

    const created = (await rpc('CreateTransaction', { id: 'payme-tx-1', time: 1_700_000_000_000, amount: 1_800_000, account })).json();
    expect(created.result).toMatchObject({ state: 1, create_time: 1_700_000_000_000 });
    // idempotent retry
    expect((await rpc('CreateTransaction', { id: 'payme-tx-1', time: 1, amount: 1_800_000, account })).json().result.state).toBe(1);
    // a second transaction for the same order is refused
    expect((await rpc('CreateTransaction', { id: 'payme-tx-2', time: 1, amount: 1_800_000, account })).json().error.code).toBe(-31099);

    const performed = (await rpc('PerformTransaction', { id: 'payme-tx-1' })).json();
    expect(performed.result.state).toBe(2);
    expect((await rpc('CheckTransaction', { id: 'payme-tx-1' })).json().result).toMatchObject({ state: 2, transaction: created.result.transaction });

    const b = await env.app.inject({ method: 'GET', url: `${B}/bookings/${booking.id}`, headers: { authorization: await env.tma({ ...VISITOR, id: 8002 }) } });
    expect(b.json()).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });

    const cancelled = (await rpc('CancelTransaction', { id: 'payme-tx-1', reason: 5 })).json();
    expect(cancelled.result.state).toBe(-2);
  });

  it('rejects requests with a wrong key and unknown methods', async () => {
    expect((await rpc('CheckTransaction', { id: 'x' }, 'wrong')).json().error.code).toBe(-32504);
    expect((await rpc('Nope', {})).json().error.code).toBe(-32601);
    expect((await rpc('PerformTransaction', { id: 'missing' })).json().error.code).toBe(-31003);
  });
});

describe('Click SHOP API', () => {
  const sign = (f: Record<string, string>) =>
    createHash('md5')
      .update(
        [f.click_trans_id, f.service_id, CLICK_SECRET, f.merchant_trans_id, ...(f.action === '1' ? [f.merchant_prepare_id] : []), f.amount, f.action, f.sign_time].join(''),
      )
      .digest('hex');

  it('builds the pay URL', async () => {
    const p = new ClickProvider({ serviceId: '1', merchantId: '2', secretKey: 's', returnUrl: 'https://x.test' });
    const s = await p.createPayment({ bookingId: 'b', amount: 18_000, currency: 'UZS', description: 'd' });
    const url = new URL(s.payUrl);
    expect(url.host).toBe('my.click.uz');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ service_id: '1', merchant_id: '2', amount: '18000.00', transaction_param: s.reference });
  });

  it('prepares and completes with md5-signed form posts', async () => {
    await useProvider('click');
    const { booking, payment } = await book(8003);
    const base = {
      click_trans_id: '555',
      service_id: '111',
      click_paydoc_id: '999',
      merchant_trans_id: payment.reference,
      amount: '18000.00',
      error: '0',
      error_note: 'Success',
      sign_time: '2026-11-12 08:00:00',
    };
    const prepare = { ...base, action: '0' };
    const form = (f: Record<string, string>) => new URLSearchParams({ ...f, sign_string: sign(f) }).toString();
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };

    const bad = await env.app.inject({ method: 'POST', url: '/api/payments/click/prepare', headers, payload: new URLSearchParams({ ...prepare, sign_string: 'x' }).toString() });
    expect(bad.json().error).toBe(-1);

    const p = (await env.app.inject({ method: 'POST', url: '/api/payments/click/prepare', headers, payload: form(prepare) })).json();
    expect(p).toMatchObject({ error: 0, merchant_prepare_id: expect.any(String) });

    const complete = { ...base, action: '1', merchant_prepare_id: p.merchant_prepare_id };
    const c = (await env.app.inject({ method: 'POST', url: '/api/payments/click/complete', headers, payload: form(complete) })).json();
    expect(c).toMatchObject({ error: 0, merchant_confirm_id: p.merchant_prepare_id });
    const again = (await env.app.inject({ method: 'POST', url: '/api/payments/click/complete', headers, payload: form(complete) })).json();
    expect(again.error).toBe(-4);

    const b = await env.app.inject({ method: 'GET', url: `${B}/bookings/${booking.id}`, headers: { authorization: await env.tma({ ...VISITOR, id: 8003 }) } });
    expect(b.json().status).toBe('confirmed');
  });
});

describe('Telegram Stars', () => {
  it('creates an XTR invoice link through the Bot API', async () => {
    const p = new StarsProvider({ botToken: 'T', uzsPerStar: 170 }, fakeFetch);
    expect(p.stars(18_000)).toBe(106);
    const s = await p.createPayment({ bookingId: 'b', amount: 18_000, currency: 'XTR', description: 'Deposit' });
    expect(s.payUrl).toBe('https://t.me/$fake-invoice');
    const call = invoiceCalls.at(-1)!;
    expect(call.url).toBe('https://api.telegram.org/botT/createInvoiceLink');
    expect(call.body).toMatchObject({ currency: 'XTR', payload: s.reference, prices: [{ amount: 106 }] });
  });

  it('is used for Mini App bookings when selected', async () => {
    await useProvider('stars');
    const { booking, payment } = await book(8004);
    expect(booking.status).toBe('pending');
    expect(payment).toMatchObject({ provider: 'stars', payUrl: 'https://t.me/$fake-invoice' });
  });
});
