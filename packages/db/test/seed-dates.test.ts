import { addDays, zonedToUtc } from '@navbat/core';
import { describe, expect, it } from 'vitest';
import { DEMO_TZ, migrate, seedDemo } from '../src/index.js';
import { createPGlite, kyselyFromPGlite } from '../src/pglite.js';

// The demo is seeded relative to "today", so every calendar day lays bookings out differently.
// 2026-11-16 00:10 broke the live demo: two generated bookings overlapped the visitor's past visit.
const FIRST = '2026-11-16';

describe('demo seed works on any day', () => {
  it(
    'seeds 14 consecutive days without breaking the no-overlap constraint',
    { timeout: 300_000 },
    async () => {
      for (let d = 0; d < 14; d++) {
        const now = zonedToUtc(addDays(FIRST, d), 10, DEMO_TZ);
        const pg = await createPGlite();
        const db = kyselyFromPGlite(pg);
        await migrate(db);
        await expect(
          seedDemo(db, { now, history: true }),
          `seed for ${addDays(FIRST, d)}`,
        ).resolves.toBeTruthy();
        await db.destroy();
      }
    },
  );
});
