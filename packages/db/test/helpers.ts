import { addDays, SandboxProvider, todayIn, zonedToUtc } from '@navbat/core';
import type { Kysely } from 'kysely';
import { type AppContext, type DB, DEMO_TZ, migrate, seedDemo } from '../src/index.js';
import { createPGlite, kyselyFromPGlite } from '../src/pglite.js';

/** Thursday 2026-11-12 08:00 in Tashkent — a fixed "now" for deterministic tests. */
export const NOW = zonedToUtc('2026-11-12', 8 * 60, DEMO_TZ);
export const TODAY = todayIn(DEMO_TZ, NOW);
export const at = (dayOffset: number, hm: string) => {
  const [hh, mm] = hm.split(':').map(Number) as [number, number];
  return zonedToUtc(addDays(TODAY, dayOffset), hh * 60 + mm, DEMO_TZ);
};

export async function freshDb(opts: { history?: boolean; depositPercent?: number } = {}) {
  const pg = await createPGlite();
  const db: Kysely<DB> = kyselyFromPGlite(pg);
  await migrate(db);
  const seed = await seedDemo(db, {
    now: NOW,
    history: opts.history ?? false,
    depositPercent: opts.depositPercent,
  });
  let now = NOW;
  const sandbox = new SandboxProvider();
  const ctx: AppContext = {
    db,
    now: () => now,
    appUrl: 'https://example.test/app',
    payments: (id) => (id === 'sandbox' ? sandbox : undefined),
    random: Math.random,
  };
  return {
    db,
    ctx,
    seed,
    sandbox,
    setNow: (t: number) => {
      now = t;
    },
    close: () => db.destroy(),
  };
}
