import { addDays, signInitData, type TelegramUser, todayIn, zonedToUtc } from '@navbat/core';
import { DEMO_TZ, migrate, seedDemo } from '@navbat/db';
import { createPgDb } from '@navbat/db/node';
import pg from 'pg';
import { type AppDeps, buildApp } from '../src/app.js';

export const BASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/postgres';
export const BOT_TOKEN = '123456:TEST-ONLY-not-a-real-token';
export const SESSION_SECRET = 'test-session-secret-0123456789abcdef';
export const PAYME_KEY = 'test-payme-key';
export const CLICK_SECRET = 'test-click-secret';

/** Thursday 2026-11-12 08:00 in Tashkent. */
export const NOW = zonedToUtc('2026-11-12', 8 * 60, DEMO_TZ);
export const TODAY = todayIn(DEMO_TZ, NOW);
export const at = (dayOffset: number, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return zonedToUtc(addDays(TODAY, dayOffset), h * 60 + m, DEMO_TZ);
};

export interface TestEnv {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: ReturnType<typeof createPgDb>['db'];
  seed: Awaited<ReturnType<typeof seedDemo>>;
  setNow(t: number): void;
  tma(user: Partial<TelegramUser> & { id: number }, startParam?: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * A fresh PostgreSQL database per test file: CREATE DATABASE → migrate → seed. Fails loudly if
 * PostgreSQL is not reachable, so CI can never silently skip the integration suite.
 */
export async function createTestEnv(
  opts: { history?: boolean; depositPercent?: number; deps?: Partial<AppDeps> } = {},
): Promise<TestEnv> {
  const admin = new pg.Client({ connectionString: BASE_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `PostgreSQL is not reachable at TEST_DATABASE_URL (${BASE_URL}): ${(e as Error).message}`,
    );
  }
  const name = `navbat_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  const { db } = createPgDb({ connectionString: url.toString(), max: 30 });
  await migrate(db);
  const seed = await seedDemo(db, {
    now: NOW,
    history: opts.history ?? false,
    depositPercent: opts.depositPercent,
  });
  let now = NOW;
  const app = await buildApp({
    db,
    botToken: BOT_TOKEN,
    sessionSecret: SESSION_SECRET,
    appUrl: 'https://example.test/app',
    now: () => now,
    devAuth: false,
    payments: {
      payme: { merchantId: 'test-merchant', key: PAYME_KEY },
      click: { serviceId: '111', merchantId: '222', secretKey: CLICK_SECRET },
      stars: { botToken: BOT_TOKEN, uzsPerStar: 170 },
    },
    ...opts.deps,
  });
  await app.ready();
  return {
    app,
    db,
    seed,
    setNow: (t) => {
      now = t;
    },
    tma: async (user, startParam) =>
      `tma ${await signInitData(
        { user: { first_name: 'Test', ...user }, authDate: Math.floor(now / 1000), startParam },
        BOT_TOKEN,
      )}`,
    close: async () => {
      await app.close();
      await db.destroy();
      const c = new pg.Client({ connectionString: BASE_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export const VISITOR = { id: 1001, first_name: 'Akmal', language_code: 'uz' };
export const OWNER_TG = 2000;
export const ADMIN_TG = 2001;
export const MASTER_TG = [2101, 2102, 2103, 2104] as const;
