/**
 * Demo backend: the real @navbat/core rules and @navbat/db services running on PGlite
 * (PostgreSQL in WebAssembly) with the same SQL migrations as production — exclusion
 * constraint included. Data is kept in IndexedDB so a reload keeps your bookings.
 */
import {
  type Actor,
  assertCan,
  DomainError,
  isDomainError,
  type Role,
  SandboxProvider,
  todayIn,
} from '@navbat/core';
import {
  type AppContext,
  cancelBooking,
  claimDueJobs,
  confirmPayment,
  createBooking,
  createTimeOff,
  customerFromTelegram,
  DEMO_IDS,
  DEMO_SLUG,
  deleteTimeOff,
  enqueueDailyDigests,
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
  markSent,
  migrate,
  reportRunningLate,
  rescheduleBooking,
  saveSchedule,
  saveService,
  saveSettings,
  saveStaff,
  seedDemo,
  setBookingStatus,
  setCustomerLang,
  staffFromTelegram,
  updateCustomerContact,
} from '@navbat/db';
import { createPGlite, kyselyFromPGlite } from '@navbat/db/pglite';
import { ApiError, type Backend, type NotificationDTO } from './types';

const DB_KEY = 'navbat-demo-db';
const SEEDED_KEY = 'navbat-demo-seeded-on';

export type DemoRole = Extract<Role, 'owner' | 'admin'> | 'master';

export interface DemoBackend extends Backend {
  readonly mode: 'demo';
  role: DemoRole;
  setRole(role: DemoRole): void;
  /** Delivers queued messages whose time has come (what the bot worker does). */
  tick(): Promise<number>;
  notifications(chatId?: number): Promise<NotificationDTO[]>;
  /** "Send now" for scheduled reminders, so visitors can see them without waiting a day. */
  deliverNow(jobId: string): Promise<void>;
  reset(): Promise<void>;
  staffChats(): Promise<{ chatId: number; name: string; role: Role }[]>;
}

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked (private mode) — the demo still works in memory */
  }
  return value ?? null;
}

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (isDomainError(e)) throw new ApiError(e.code, e.message, e.status, e.details);
    throw e;
  });
}

async function openDatabase() {
  const name = store(DB_KEY) ?? `navbat-demo-${Date.now().toString(36)}`;
  store(DB_KEY, name);
  let pg: Awaited<ReturnType<typeof createPGlite>>;
  try {
    pg = await createPGlite(`idb://${name}`, { relaxedDurability: true });
  } catch {
    pg = await createPGlite();
  }
  const db = kyselyFromPGlite(pg);
  await migrate(db);
  return { db, name };
}

export async function createDemoBackend(onChange: () => void): Promise<DemoBackend> {
  let { db, name } = await openDatabase();
  const today = todayIn('Asia/Tashkent', Date.now());
  const existing = await db
    .selectFrom('businesses')
    .select('id')
    .where('slug', '=', DEMO_SLUG)
    .executeTakeFirst();
  // Re-seed when the stored demo is from another day, so "today" always has a lively calendar.
  if (!existing || store(SEEDED_KEY) !== today) {
    if (existing) {
      await db.destroy();
      try {
        indexedDB.deleteDatabase(`/pglite/${name}`);
      } catch {
        /* ignore */
      }
      store(DB_KEY, `navbat-demo-${Date.now().toString(36)}`);
      ({ db, name } = await openDatabase());
    }
    await seedDemo(db, { now: Date.now(), depositPercent: 20 });
    store(SEEDED_KEY, today);
  }

  const sandbox = new SandboxProvider();
  const ctx: AppContext = {
    db,
    now: () => Date.now(),
    appUrl: 'https://t.me/navbat_demo_bot/app',
    payments: (id) => (id === 'sandbox' ? sandbox : undefined),
  };
  const business = await getBusiness(db, DEMO_SLUG);
  const businessId = business.id;
  const visitor = await customerFromTelegram(db, businessId, {
    id: DEMO_IDS.visitor,
    first_name: 'Akmal',
    last_name: 'Demo',
  });
  const customerActor: Actor = { kind: 'customer', customerId: visitor.customerId };

  const roleTg: Record<DemoRole, number> = {
    owner: DEMO_IDS.owner,
    admin: DEMO_IDS.admin,
    master: DEMO_IDS.masters[0],
  };
  let role: DemoRole = (store('navbat-demo-role') as DemoRole) || 'owner';
  const staffMe = async () => {
    const s = await staffFromTelegram(db, businessId, roleTg[role]);
    if (!s) throw new ApiError('FORBIDDEN', 'Not a team member', 403);
    return { ...s, actor: { kind: 'staff' as const, staffId: s.staffId, role: s.role } };
  };
  const need = async (permission: Parameters<typeof assertCan>[1]) => {
    const me = await staffMe();
    try {
      assertCan(me.role, permission);
    } catch (e) {
      if (e instanceof DomainError) throw new ApiError('FORBIDDEN', e.message, 403);
      throw e;
    }
    return me;
  };
  const mutate = async <T>(p: Promise<T>): Promise<T> => {
    const r = await wrap(p);
    onChange();
    return r;
  };
  const meView = async () => {
    const c = await db
      .selectFrom('customers')
      .select(['id', 'name', 'phone', 'lang'])
      .where('id', '=', visitor.customerId)
      .executeTakeFirstOrThrow();
    return { customer: c, staff: null };
  };

  const backend: DemoBackend = {
    mode: 'demo',
    now: () => Date.now(),
    get role() {
      return role;
    },
    setRole(r) {
      role = r;
      store('navbat-demo-role', r);
      onChange();
    },
    catalog: () => wrap(getCatalog(db, businessId)),
    slots: (q) =>
      wrap(
        getSlots(db, {
          businessId,
          date: q.date,
          serviceIds: q.serviceIds,
          staffId: q.staffId,
          now: Date.now(),
        }),
      ),
    availability: (q) =>
      wrap(
        getMonthAvailability(db, {
          businessId,
          month: q.month,
          serviceIds: q.serviceIds,
          staffId: q.staffId,
          now: Date.now(),
        }),
      ),
    firstAvailable: (q) =>
      wrap(
        firstAvailableDate(db, { businessId, serviceIds: q.serviceIds, staffId: q.staffId, now: Date.now() }),
      ),
    me: () => wrap(meView()),
    patchMe: async (body) => {
      if (body.lang) await setCustomerLang(db, businessId, DEMO_IDS.visitor, body.lang);
      if (body.name)
        await wrap(
          updateCustomerContact(db, businessId, visitor.customerId, {
            name: body.name,
            phone: body.phone ?? null,
          }),
        );
      return meView();
    },
    myBookings: () => wrap(listCustomerBookings(db, businessId, visitor.customerId)),
    createBooking: (b) =>
      mutate(
        createBooking(ctx, {
          businessId,
          serviceIds: b.serviceIds,
          staffId: b.staffId,
          start: b.start,
          actor: customerActor,
          customer: { name: b.name, phone: b.phone },
          source: 'miniapp',
          notes: b.notes ?? null,
        }),
      ),
    booking: (id) => wrap(getBookingFor(db, businessId, id, customerActor)),
    reschedule: (id, start) =>
      mutate(rescheduleBooking(ctx, { businessId, bookingId: id, start, actor: customerActor })),
    cancel: (id, reason) =>
      mutate(cancelBooking(ctx, { businessId, bookingId: id, actor: customerActor, reason })),
    late: (id, minutes) =>
      mutate(reportRunningLate(ctx, { businessId, bookingId: id, minutes, actor: customerActor })),
    review: (id, rating, comment) =>
      mutate(
        leaveReview(ctx, { businessId, bookingId: id, customerId: visitor.customerId, rating, comment }),
      ),
    completeSandboxPayment: async (reference) => {
      sandbox.complete(reference);
      return mutate(confirmPayment(ctx, { reference }));
    },
    adminMe: async () => {
      const me = await staffMe();
      return { staffId: me.staffId, name: me.name, role: me.role, lang: me.lang };
    },
    adminCatalog: () => wrap(getCatalog(db, businessId, { includeInactive: true })),
    calendar: async (q) => {
      const me = await staffMe();
      return wrap(
        getCalendar(db, {
          businessId,
          from: q.from,
          to: q.to,
          staffIds: me.role === 'master' ? [me.staffId] : q.staffIds,
        }),
      );
    },
    adminCreateBooking: async (b) => {
      const me = await staffMe();
      if (me.role === 'master' && b.staffId !== me.staffId)
        throw new ApiError('FORBIDDEN', 'Masters book only into their own calendar', 403);
      return mutate(
        createBooking(ctx, {
          businessId,
          serviceIds: b.serviceIds,
          staffId: b.staffId,
          start: b.start,
          actor: me.actor,
          customer: { name: b.customer.name, phone: b.customer.phone ?? null },
          source: b.source,
          notes: b.notes ?? null,
        }),
      );
    },
    adminBooking: async (id) => wrap(getBookingFor(db, businessId, id, (await staffMe()).actor)),
    adminReschedule: async (id, start, staffId) =>
      mutate(
        rescheduleBooking(ctx, { businessId, bookingId: id, start, staffId, actor: (await staffMe()).actor }),
      ),
    adminCancel: async (id, reason) =>
      mutate(cancelBooking(ctx, { businessId, bookingId: id, actor: (await staffMe()).actor, reason })),
    adminStatus: async (id, event) =>
      mutate(setBookingStatus(ctx, { businessId, bookingId: id, event, actor: (await staffMe()).actor })),
    createTimeOff: async (b) => {
      const me = await staffMe();
      if (me.role === 'master' && b.staffId !== me.staffId)
        throw new ApiError('FORBIDDEN', 'Masters block only their own time', 403);
      return mutate(createTimeOff(db, { businessId, ...b }));
    },
    deleteTimeOff: async (id) => {
      await staffMe();
      await mutate(deleteTimeOff(db, businessId, id));
    },
    saveService: async (b) => {
      await need('catalog.manage');
      return mutate(saveService(db, businessId, b));
    },
    saveStaff: async (b) => {
      await need('staff.manage');
      return mutate(saveStaff(db, businessId, b));
    },
    schedule: (id) => wrap(getSchedule(db, businessId, id)),
    saveSchedule: async (id, rules) => {
      await need('catalog.manage');
      await mutate(saveSchedule(db, businessId, id, rules));
      return getSchedule(db, businessId, id);
    },
    saveSettings: async (b) => {
      await need('settings.manage');
      return mutate(saveSettings(db, businessId, b));
    },
    clients: async (search) => {
      await need('clients.view');
      return wrap(listClients(db, { businessId, search, now: Date.now() }));
    },
    client: async (id) => {
      await need('clients.view');
      return wrap(getClient(db, { businessId, customerId: id, now: Date.now() }));
    },
    analytics: async (q) => {
      await need('analytics.view');
      return wrap(getAnalytics(db, { businessId, ...q, now: Date.now() }));
    },
    exportCsv: async (q) => {
      await need('export');
      return wrap(exportBookingsCsv(db, { businessId, ...q }));
    },
    async tick() {
      await enqueueDailyDigests(ctx, businessId);
      const due = await claimDueJobs(db, Date.now(), 50);
      for (const job of due) await markSent(db, job.id, Date.now());
      if (due.length) onChange();
      return due.length;
    },
    notifications: (chatId) => listNotifications(db, businessId, { chatId, limit: 300 }),
    async deliverNow(jobId) {
      await db
        .updateTable('notification_jobs')
        .set({ send_at: new Date() })
        .where('id', '=', jobId)
        .where('status', '=', 'pending')
        .execute();
      await backend.tick();
    },
    async reset() {
      store(SEEDED_KEY, '');
      await db.destroy().catch(() => undefined);
      try {
        indexedDB.deleteDatabase(`/pglite/${name}`);
      } catch {
        /* ignore */
      }
      store(DB_KEY, `navbat-demo-${Date.now().toString(36)}`);
    },
    async staffChats() {
      const rows = await db
        .selectFrom('staff')
        .select(['telegram_user_id', 'name', 'role'])
        .where('business_id', '=', businessId)
        .where('telegram_user_id', 'is not', null)
        .orderBy('position')
        .execute();
      return rows.map((r) => ({ chatId: r.telegram_user_id!, name: r.name, role: r.role }));
    },
  };
  return backend;
}
