import { signLoginWidget } from '@navbat/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_TG, BOT_TOKEN, MASTER_TG, NOW, OWNER_TG, type TestEnv, at, createTestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv({ history: true });
});
afterAll(async () => {
  await env?.close();
});

const B = '/api/b/demo';
const get = async (url: string, tg: number) =>
  env.app.inject({ method: 'GET', url: `${B}${url}`, headers: { authorization: await env.tma({ id: tg }) } });
const send = async (method: 'POST' | 'PUT' | 'DELETE', url: string, tg: number, payload?: unknown) =>
  env.app.inject({ method, url: `${B}${url}`, headers: { authorization: await env.tma({ id: tg }) }, payload: payload as object });

describe('staff auth', () => {
  it('signs in with the Telegram Login Widget and uses the session token', async () => {
    const widget = await signLoginWidget({ id: OWNER_TG, first_name: 'Rustam', auth_date: Math.floor(NOW / 1000) }, BOT_TOKEN);
    const login = await env.app.inject({ method: 'POST', url: `${B}/auth/telegram-login`, payload: widget });
    expect(login.statusCode).toBe(200);
    const { token, staff } = login.json();
    expect(staff.role).toBe('owner');
    const me = await env.app.inject({ method: 'GET', url: `${B}/admin/me`, headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ role: 'owner', name: 'Rustam Karimov' });
    const forged = await env.app.inject({ method: 'GET', url: `${B}/admin/me`, headers: { authorization: `Bearer ${token}x` } });
    expect(forged.statusCode).toBe(401);
  });

  it('rejects a tampered widget payload and non-members', async () => {
    const widget = await signLoginWidget({ id: OWNER_TG, first_name: 'Rustam', auth_date: Math.floor(NOW / 1000) }, BOT_TOKEN);
    const tampered = await env.app.inject({ method: 'POST', url: `${B}/auth/telegram-login`, payload: { ...widget, id: ADMIN_TG } });
    expect(tampered.statusCode).toBe(401);
    const stranger = await signLoginWidget({ id: 999_999, first_name: 'X', auth_date: Math.floor(NOW / 1000) }, BOT_TOKEN);
    expect((await env.app.inject({ method: 'POST', url: `${B}/auth/telegram-login`, payload: stranger })).statusCode).toBe(403);
    expect((await get('/admin/me', 1001)).statusCode).toBe(403); // a customer is not staff
  });

  it('enforces role permissions', async () => {
    expect((await get('/admin/analytics?from=2026-11-01&to=2026-11-12', OWNER_TG)).statusCode).toBe(200);
    expect((await get('/admin/analytics?from=2026-11-01&to=2026-11-12', ADMIN_TG)).statusCode).toBe(200);
    expect((await get('/admin/analytics?from=2026-11-01&to=2026-11-12', MASTER_TG[0])).statusCode).toBe(403);
    expect((await get('/admin/clients', MASTER_TG[0])).statusCode).toBe(403);
    expect((await send('PUT', '/admin/staff', ADMIN_TG, { name: 'X' })).statusCode).toBe(403); // owner only
    expect((await send('PUT', '/admin/settings', ADMIN_TG, { settings: { slotStepMin: 30 } })).statusCode).toBe(403);
    expect((await get('/admin/notifications', MASTER_TG[0])).statusCode).toBe(403);
  });
});

describe('calendar and master isolation', () => {
  it('owners see every master, masters only their own column', async () => {
    const all = (await get(`/admin/calendar?from=2026-11-12&to=2026-11-18`, OWNER_TG)).json();
    expect(all.staff).toHaveLength(4);
    expect(all.bookings.length).toBeGreaterThan(10);
    expect(all.working.length).toBe(4 * 7);
    const mine = (await get(`/admin/calendar?from=2026-11-12&to=2026-11-18`, MASTER_TG[0])).json();
    expect(mine.staff.map((s: { id: string }) => s.id)).toEqual([env.seed.staffIds.masters[0]]);
    expect(mine.bookings.every((b: { staffId: string }) => b.staffId === env.seed.staffIds.masters[0])).toBe(true);
  });

  it('masters cannot read or move other masters\' bookings', async () => {
    const all = (await get(`/admin/calendar?from=2026-11-13&to=2026-11-20`, OWNER_TG)).json();
    const foreign = all.bookings.find(
      (b: { staffId: string; status: string }) => b.staffId === env.seed.staffIds.masters[1] && b.status === 'confirmed',
    );
    expect((await get(`/admin/bookings/${foreign.id}`, MASTER_TG[0])).statusCode).toBe(403);
    const move = await send('POST', `/admin/bookings/${foreign.id}/cancel`, MASTER_TG[0], {});
    expect(move.statusCode).toBe(403);
    const book = await send('POST', '/admin/bookings', MASTER_TG[0], {
      serviceIds: [env.seed.serviceIds.classic],
      staffId: env.seed.staffIds.masters[1],
      start: at(2, '12:00'),
      customer: { name: 'X' },
    });
    expect(book.statusCode).toBe(403);
  });

  it('creates a walk-in, drags it to another master and marks a no-show', async () => {
    const slots = (await get(`/slots?date=2026-11-17&services=${env.seed.serviceIds.classic}&staff=any`, ADMIN_TG)).json() as {
      start: number;
      options: { staffId: string }[];
    }[];
    const slot = slots.find((s) => s.options.length >= 2)!;
    const created = await send('POST', '/admin/bookings', ADMIN_TG, {
      serviceIds: [env.seed.serviceIds.classic],
      staffId: slot.options[0]!.staffId,
      start: slot.start,
      customer: { name: 'Phone client', phone: '+998 91 234 56 78' },
      source: 'phone',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().booking.id;
    expect(created.json().booking.source).toBe('phone');
    const moved = await send('POST', `/admin/bookings/${id}/reschedule`, ADMIN_TG, { start: slot.start, staffId: slot.options[1]!.staffId });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().staffId).toBe(slot.options[1]!.staffId);
    env.setNow(slot.start + 30 * 60_000);
    const noShow = await send('POST', `/admin/bookings/${id}/status`, ADMIN_TG, { event: 'no_show' });
    expect(noShow.json().status).toBe('no_show');
    env.setNow(NOW);
    const clients = (await get('/admin/clients?search=Phone', ADMIN_TG)).json();
    expect(clients[0]).toMatchObject({ name: 'Phone client', noShows: 1, phone: '+998912345678' });
    const details = (await get(`/admin/clients/${clients[0].id}`, ADMIN_TG)).json();
    expect(details.history).toHaveLength(1);
  });

  it('blocks time (and lets a master block only their own)', async () => {
    const jasur = env.seed.staffIds.masters[0];
    const block = await send('POST', '/admin/time-off', MASTER_TG[0], { staffId: jasur, start: at(20, '10:00'), end: at(20, '12:00'), reason: 'Doctor' });
    expect(block.statusCode).toBe(200);
    const foreign = await send('POST', '/admin/time-off', MASTER_TG[0], { staffId: env.seed.staffIds.masters[1], start: at(20, '10:00'), end: at(20, '12:00') });
    expect(foreign.statusCode).toBe(403);
    const bad = await send('POST', '/admin/time-off', ADMIN_TG, { staffId: jasur, start: at(20, '12:00'), end: at(20, '10:00') });
    expect(bad.statusCode).toBe(400);
    const del = await send('DELETE', `/admin/time-off/${block.json().id}`, ADMIN_TG);
    expect(del.statusCode).toBe(204);
    expect((await send('DELETE', `/admin/time-off/${block.json().id}`, ADMIN_TG)).statusCode).toBe(404);
  });
});

describe('catalog management', () => {
  it('creates a service, a master with it and a schedule; the slot engine picks them up', async () => {
    const svc = await send('PUT', '/admin/services', ADMIN_TG, {
      name: { uz: 'Massaj', ru: 'Массаж', en: 'Massage' },
      durationMin: 30,
      price: 40_000,
      bufferAfterMin: 5,
    });
    expect(svc.statusCode).toBe(200);
    const master = await send('PUT', '/admin/staff', OWNER_TG, {
      name: 'New Master',
      color: '#123456',
      services: [{ serviceId: svc.json().id, price: 45_000 }],
    });
    expect(master.json()).toMatchObject({ name: 'New Master', services: [{ price: 45_000 }] });
    const sched = await send('PUT', `/admin/staff/${master.json().id}/schedule`, ADMIN_TG, {
      rules: [
        { kind: 'work', weekday: 5, startMin: 600, endMin: 720 },
        { kind: 'break', weekday: 5, startMin: 660, endMin: 690 },
      ],
    });
    expect(sched.json()).toHaveLength(2);
    expect((await get(`/admin/staff/${master.json().id}/schedule`, OWNER_TG)).json()).toHaveLength(2);
    const slots = (await get(`/slots?date=2026-11-13&services=${svc.json().id}&staff=${master.json().id}`, OWNER_TG)).json();
    expect(slots).toHaveLength(4);
    const invalid = await send('PUT', `/admin/staff/${master.json().id}/schedule`, ADMIN_TG, {
      rules: [{ kind: 'work', weekday: 9, startMin: 600, endMin: 720 }],
    });
    expect(invalid.statusCode).toBe(400);
    const catalog = (await get('/admin/catalog', ADMIN_TG)).json();
    expect(catalog.services.some((s: { id: string }) => s.id === svc.json().id)).toBe(true);
  });

  it('updates settings (owner only) with validation', async () => {
    const ok = await send('PUT', '/admin/settings', OWNER_TG, { settings: { cancelWindowMin: 180 } });
    expect(ok.json().settings.cancelWindowMin).toBe(180);
    const bad = await send('PUT', '/admin/settings', OWNER_TG, { timezone: 'Mars/Olympus' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('reports', () => {
  it('returns analytics for the last 30 days', async () => {
    const res = await get('/admin/analytics?from=2026-10-13&to=2026-11-11', OWNER_TG);
    const a = res.json();
    expect(a.totals.completed).toBeGreaterThan(50);
    expect(a.totals.revenue).toBeGreaterThan(0);
    expect(a.byDay).toHaveLength(30);
    expect(a.topServices.length).toBeGreaterThan(0);
    expect(a.byStaff.length).toBeGreaterThanOrEqual(4);
  });

  it('exports CSV as an attachment', async () => {
    const res = await get('/admin/export.csv?from=2026-11-01&to=2026-11-12&lang=en', OWNER_TG);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('navbat-demo-2026-11-01_2026-11-12.csv');
    expect(res.body.split('\r\n')[0]).toBe('﻿Code,Date,Start,End,Master,Services,Client,Phone,Status,Price,Source');
  });

  it('rejects absurd ranges', async () => {
    const res = await get('/admin/analytics?from=2026-01-01&to=2026-12-31', OWNER_TG);
    expect(res.statusCode).toBe(400);
  });

  it('lists the notification outbox for admins', async () => {
    const res = await get('/admin/notifications?limit=50', ADMIN_TG);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
