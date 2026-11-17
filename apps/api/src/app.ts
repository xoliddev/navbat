import cors from '@fastify/cors';
import { DomainError, isDomainError, signSession, validateLoginWidget } from '@navbat/core';
import {
  type AppContext,
  cancelBooking,
  confirmPayment,
  createBooking,
  createTimeOff,
  customerFromTelegram,
  type DB,
  deleteTimeOff,
  exportBookingsCsv,
  firstAvailableDate,
  getAnalytics,
  getBookingFor,
  getBusiness,
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
  reportRunningLate,
  rescheduleBooking,
  type StaffInput,
  saveSchedule,
  saveService,
  saveSettings,
  saveStaff,
  setBookingStatus,
  setCustomerLang,
  staffFromTelegram,
  updateCustomerContact,
} from '@navbat/db';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { ZodError, type z } from 'zod';
import {
  type AuthConfig,
  requirePermission,
  type StaffPrincipal,
  staffPrincipal,
  telegramUser,
} from './auth.js';
import { createPaymentRegistry, type PaymentConfig } from './payments/providers.js';
import { handleClick, handlePayme, type RpcRequest } from './payments/webhooks.js';
import * as S from './schemas.js';

export interface AppDeps {
  db: Kysely<DB>;
  botToken: string;
  sessionSecret: string;
  appUrl: string;
  now?: () => number;
  devAuth?: boolean;
  payments?: PaymentConfig;
  fetch?: typeof fetch;
  corsOrigin?: string | string[] | boolean;
  logger?: boolean;
}

const SESSION_TTL_SEC = 12 * 3600;

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  return schema.parse(data);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => Date.now());
  const registry = createPaymentRegistry(deps.payments, deps.fetch);
  const ctx: AppContext = { db: deps.db, now, appUrl: deps.appUrl, payments: (id) => registry.get(id) };
  const auth: AuthConfig = {
    botToken: deps.botToken,
    sessionSecret: deps.sessionSecret,
    devAuth: !!deps.devAuth,
    now,
  };
  const { db } = deps;

  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 256 * 1024 });
  await app.register(cors, { origin: deps.corsOrigin ?? true });

  // Click posts application/x-www-form-urlencoded.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Invalid request',
          details: { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        },
      });
    }
    if (isDomainError(error)) {
      const e = error as DomainError;
      return reply
        .status(e.status)
        .send({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'VALIDATION', message: (error as Error).message } });
    }
    req.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );

  app.get('/health', async () => {
    await sql`select 1`.execute(db);
    return { ok: true, db: true };
  });

  // ---------- payment webhooks (provider-level, not per business) ----------
  app.post('/api/payments/payme', async (req) => {
    if (!registry.payme) throw new DomainError('NOT_FOUND', 'Payme is not configured');
    return handlePayme(ctx, registry.payme, req.headers.authorization, req.body as RpcRequest);
  });
  for (const stage of ['prepare', 'complete'] as const) {
    app.post(`/api/payments/click/${stage}`, async (req) => {
      if (!registry.click) throw new DomainError('NOT_FOUND', 'Click is not configured');
      const fields = Object.fromEntries(
        Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
      return handleClick(ctx, registry.click, stage, fields);
    });
  }

  // ---------- per-business API ----------
  await app.register(
    async (r) => {
      const business = async (req: FastifyRequest) => getBusiness(db, parse(S.slug, req.params).slug);
      const customer = async (req: FastifyRequest) => {
        const b = await business(req);
        const user = await telegramUser(req, auth);
        const c = await customerFromTelegram(db, b.id, user);
        return {
          business: b,
          user,
          customer: c,
          actor: { kind: 'customer' as const, customerId: c.customerId },
        };
      };
      const staff = async (
        req: FastifyRequest,
      ): Promise<{ business: Awaited<ReturnType<typeof business>>; me: StaffPrincipal }> => {
        const b = await business(req);
        return { business: b, me: await staffPrincipal(req, db, b.id, auth) };
      };
      const meView = async (businessId: string, userId: number) => {
        const c = await db
          .selectFrom('customers')
          .select(['id', 'name', 'phone', 'lang'])
          .where('business_id', '=', businessId)
          .where('telegram_user_id', '=', userId)
          .executeTakeFirstOrThrow();
        const s = await staffFromTelegram(db, businessId, userId);
        return { customer: c, staff: s };
      };

      // public
      r.get('/catalog', async (req) => getCatalog(db, (await business(req)).id));
      r.get('/slots', async (req) => {
        const b = await business(req);
        const q = parse(S.slotsQuery, req.query);
        return getSlots(db, {
          businessId: b.id,
          date: q.date,
          serviceIds: q.services,
          staffId: q.staff,
          now: now(),
        });
      });
      r.get('/availability', async (req) => {
        const b = await business(req);
        const q = parse(S.monthQuery, req.query);
        return getMonthAvailability(db, {
          businessId: b.id,
          month: q.month,
          serviceIds: q.services,
          staffId: q.staff,
          now: now(),
        });
      });
      r.get('/first-available', async (req) => {
        const b = await business(req);
        const q = parse(S.firstQuery, req.query);
        return {
          date: await firstAvailableDate(db, {
            businessId: b.id,
            serviceIds: q.services,
            staffId: q.staff,
            now: now(),
          }),
        };
      });

      // customer (Telegram Mini App)
      r.get('/me', async (req) => {
        const c = await customer(req);
        return meView(c.business.id, c.user.id);
      });
      r.patch('/me', async (req) => {
        const c = await customer(req);
        const body = parse(S.patchMe, req.body);
        if (body.lang) await setCustomerLang(db, c.business.id, c.user.id, body.lang);
        if (body.name || body.phone) {
          await updateCustomerContact(db, c.business.id, c.customer.customerId, {
            name: body.name ?? c.customer.name,
            phone: body.phone ?? null,
          });
        }
        return meView(c.business.id, c.user.id);
      });
      r.get('/me/bookings', async (req) => {
        const c = await customer(req);
        return listCustomerBookings(db, c.business.id, c.customer.customerId);
      });
      r.post('/bookings', async (req, reply) => {
        const c = await customer(req);
        const body = parse(S.createBookingBody, req.body);
        const created = await createBooking(ctx, {
          businessId: c.business.id,
          serviceIds: body.serviceIds,
          staffId: body.staffId,
          start: body.start,
          actor: c.actor,
          customer: { name: body.name, phone: body.phone },
          source: 'miniapp',
          notes: body.notes ?? null,
        });
        return reply.status(201).send(created);
      });
      r.get('/bookings/:id', async (req) => {
        const c = await customer(req);
        return getBookingFor(db, c.business.id, parse(S.slugId, req.params).id, c.actor);
      });
      r.post('/bookings/:id/reschedule', async (req) => {
        const c = await customer(req);
        const body = parse(S.rescheduleBody, req.body);
        return rescheduleBooking(ctx, {
          businessId: c.business.id,
          bookingId: parse(S.slugId, req.params).id,
          start: body.start,
          staffId: body.staffId,
          actor: c.actor,
        });
      });
      r.post('/bookings/:id/cancel', async (req) => {
        const c = await customer(req);
        const body = parse(S.cancelBody, req.body ?? {});
        return cancelBooking(ctx, {
          businessId: c.business.id,
          bookingId: parse(S.slugId, req.params).id,
          actor: c.actor,
          reason: body.reason,
        });
      });
      r.post('/bookings/:id/late', async (req) => {
        const c = await customer(req);
        const body = parse(S.lateBody, req.body);
        return reportRunningLate(ctx, {
          businessId: c.business.id,
          bookingId: parse(S.slugId, req.params).id,
          minutes: body.minutes,
          actor: c.actor,
        });
      });
      r.post('/bookings/:id/review', async (req) => {
        const c = await customer(req);
        const body = parse(S.reviewBody, req.body);
        return leaveReview(ctx, {
          businessId: c.business.id,
          bookingId: parse(S.slugId, req.params).id,
          customerId: c.customer.customerId,
          rating: body.rating,
          comment: body.comment,
        });
      });
      r.post('/payments/sandbox/:reference/complete', async (req) => {
        const b = await business(req);
        if (b.settings.paymentProvider !== 'sandbox')
          throw new DomainError('NOT_FOUND', 'Sandbox payments are off');
        const { reference } = req.params as { reference: string };
        const payment = await db
          .selectFrom('payments as p')
          .innerJoin('bookings as b', 'b.id', 'p.booking_id')
          .select(['p.provider', 'p.status'])
          .where('p.reference', '=', reference)
          .where('b.business_id', '=', b.id)
          .executeTakeFirst();
        if (!payment || payment.provider !== 'sandbox')
          throw new DomainError('NOT_FOUND', 'Payment not found');
        registry.sandbox.complete(reference);
        return confirmPayment(ctx, { reference });
      });

      // staff sign-in outside Telegram (Login Widget)
      r.post('/auth/telegram-login', async (req) => {
        const b = await business(req);
        const fields = parse(S.loginBody, req.body) as Record<string, string | number>;
        let user: Awaited<ReturnType<typeof validateLoginWidget>>;
        try {
          user = await validateLoginWidget(fields, deps.botToken, { now: now() });
        } catch {
          throw new DomainError('UNAUTHORIZED', 'Telegram login could not be verified');
        }
        const member = await staffFromTelegram(db, b.id, user.id);
        if (!member) throw new DomainError('FORBIDDEN', 'This account is not a member of the team');
        const token = await signSession(
          { sub: member.staffId, role: member.role, exp: Math.floor(now() / 1000) + SESSION_TTL_SEC },
          deps.sessionSecret,
        );
        return { token, staff: member };
      });

      // ---------- admin ----------
      r.get('/admin/me', async (req) => {
        const { me } = await staff(req);
        return { staffId: me.staffId, name: me.name, role: me.role, lang: me.lang };
      });
      r.get('/admin/catalog', async (req) => {
        const { business: b } = await staff(req);
        return getCatalog(db, b.id, { includeInactive: true });
      });
      r.get('/admin/calendar', async (req) => {
        const { business: b, me } = await staff(req);
        const q = parse(S.calendarQuery, req.query);
        const staffIds = me.role === 'master' ? [me.staffId] : q.staff;
        return getCalendar(db, { businessId: b.id, from: q.from, to: q.to, staffIds });
      });
      r.post('/admin/bookings', async (req, reply) => {
        const { business: b, me } = await staff(req);
        const body = parse(S.adminBookingBody, req.body);
        if (me.role === 'master' && body.staffId !== me.staffId) {
          throw new DomainError('FORBIDDEN', 'Masters can only book into their own calendar');
        }
        const created = await createBooking(ctx, {
          businessId: b.id,
          serviceIds: body.serviceIds,
          staffId: body.staffId,
          start: body.start,
          actor: me.actor,
          customer: { name: body.customer.name, phone: body.customer.phone ?? null },
          source: body.source,
          notes: body.notes ?? null,
        });
        return reply.status(201).send(created);
      });
      r.get('/admin/bookings/:id', async (req) => {
        const { business: b, me } = await staff(req);
        return getBookingFor(db, b.id, parse(S.slugId, req.params).id, me.actor);
      });
      r.post('/admin/bookings/:id/reschedule', async (req) => {
        const { business: b, me } = await staff(req);
        const body = parse(S.rescheduleBody, req.body);
        return rescheduleBooking(ctx, {
          businessId: b.id,
          bookingId: parse(S.slugId, req.params).id,
          start: body.start,
          staffId: body.staffId,
          actor: me.actor,
        });
      });
      r.post('/admin/bookings/:id/cancel', async (req) => {
        const { business: b, me } = await staff(req);
        const body = parse(S.cancelBody, req.body ?? {});
        return cancelBooking(ctx, {
          businessId: b.id,
          bookingId: parse(S.slugId, req.params).id,
          actor: me.actor,
          reason: body.reason,
        });
      });
      r.post('/admin/bookings/:id/status', async (req) => {
        const { business: b, me } = await staff(req);
        const body = parse(S.statusBody, req.body);
        return setBookingStatus(ctx, {
          businessId: b.id,
          bookingId: parse(S.slugId, req.params).id,
          event: body.event,
          actor: me.actor,
        });
      });
      r.post('/admin/time-off', async (req) => {
        const { business: b, me } = await staff(req);
        const body = parse(S.timeOffBody, req.body);
        if (me.role === 'master' && body.staffId !== me.staffId)
          throw new DomainError('FORBIDDEN', 'Masters can only block their own time');
        return createTimeOff(db, { businessId: b.id, ...body });
      });
      r.delete('/admin/time-off/:id', async (req, reply: FastifyReply) => {
        const { business: b, me } = await staff(req);
        const id = parse(S.slugId, req.params).id;
        if (me.role === 'master') {
          const row = await db
            .selectFrom('time_off')
            .select('staff_id')
            .where('id', '=', id)
            .executeTakeFirst();
          if (row && row.staff_id !== me.staffId) throw new DomainError('FORBIDDEN', 'Not your block');
        }
        await deleteTimeOff(db, b.id, id);
        return reply.status(204).send();
      });
      r.put('/admin/services', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'catalog.manage');
        return saveService(db, b.id, parse(S.serviceBody, req.body));
      });
      r.put('/admin/staff', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'staff.manage');
        return saveStaff(db, b.id, parse(S.staffBody, req.body) as StaffInput);
      });
      r.get('/admin/staff/:id/schedule', async (req) => {
        const { business: b, me } = await staff(req);
        const id = parse(S.slugId, req.params).id;
        if (me.role === 'master' && id !== me.staffId)
          throw new DomainError('FORBIDDEN', 'Not your schedule');
        return getSchedule(db, b.id, id);
      });
      r.put('/admin/staff/:id/schedule', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'catalog.manage');
        const id = parse(S.slugId, req.params).id;
        await saveSchedule(db, b.id, id, parse(S.scheduleBody, req.body).rules);
        return getSchedule(db, b.id, id);
      });
      r.put('/admin/settings', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'settings.manage');
        return saveSettings(db, b.id, parse(S.settingsBody, req.body));
      });
      r.get('/admin/clients', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'clients.view');
        return listClients(db, {
          businessId: b.id,
          search: parse(S.clientsQuery, req.query).search,
          now: now(),
        });
      });
      r.get('/admin/clients/:id', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'clients.view');
        return getClient(db, { businessId: b.id, customerId: parse(S.slugId, req.params).id, now: now() });
      });
      r.get('/admin/analytics', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'analytics.view');
        const q = parse(S.rangeQuery, req.query);
        return getAnalytics(db, { businessId: b.id, from: q.from, to: q.to, now: now() });
      });
      r.get('/admin/export.csv', async (req, reply) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'export');
        const q = parse(S.exportQuery, req.query);
        const csv = await exportBookingsCsv(db, { businessId: b.id, from: q.from, to: q.to, lang: q.lang });
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="navbat-${b.slug}-${q.from}_${q.to}.csv"`)
          .send(csv);
      });
      r.get('/admin/notifications', async (req) => {
        const { business: b, me } = await staff(req);
        requirePermission(me, 'calendar.all');
        return listNotifications(db, b.id, { limit: parse(S.limitQuery, req.query).limit });
      });
    },
    { prefix: '/api/b/:slug' },
  );

  return app;
}
