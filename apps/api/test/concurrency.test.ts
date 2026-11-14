/**
 * Proves "no double booking" under real concurrency: many requests race for the same slot
 * through separate PostgreSQL connections. The slot engine lets all of them through (they all
 * read an empty calendar); the exclusion constraint decides.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, at, createTestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env?.close();
});

const B = '/api/b/demo';

async function burst(n: number, staffId: string | null, start: number, firstTg: number) {
  const headers = await Promise.all(Array.from({ length: n }, (_, i) => env.tma({ id: firstTg + i, first_name: `Racer ${i}` })));
  return Promise.all(
    headers.map((authorization, i) =>
      env.app.inject({
        method: 'POST',
        url: `${B}/bookings`,
        headers: { authorization },
        payload: {
          serviceIds: [env.seed.serviceIds.classic],
          staffId,
          start,
          name: `Racer ${i}`,
          phone: `+99893${String(1_000_000 + firstTg + i).slice(-7)}`,
        },
      }),
    ),
  );
}

describe('concurrency', () => {
  it('20 parallel requests for one master and slot → exactly one booking', async () => {
    const jasur = env.seed.staffIds.masters[0]!;
    const start = at(1, '10:00');
    const results = await burst(20, jasur, start, 50_000);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.statusCode === 409)) expect(r.json().error.code).toBe('SLOT_UNAVAILABLE');
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from bookings
      where staff_id = ${jasur} and status <> 'cancelled' and start_at = ${new Date(start)}`.execute(env.db);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('"any master" burst fills every free master once and never overlaps', async () => {
    const start = at(1, '12:00'); // all four masters work and are free on Friday 12:00
    const free = await env.app.inject({ method: 'GET', url: `${B}/slots?date=2026-11-13&services=${env.seed.serviceIds.classic}&staff=any` });
    const options = (free.json() as { start: number; options: unknown[] }[]).find((s) => s.start === start)!.options.length;
    expect(options).toBe(4);

    const results = await burst(12, null, start, 60_000);
    console.log(results.map((r) => `${r.statusCode} ${r.statusCode !== 201 ? r.body : ''}`).join('\n'));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(options);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(12 - options);
    const staffIds = results.filter((r) => r.statusCode === 201).map((r) => r.json().booking.staffId);
    expect(new Set(staffIds).size).toBe(options);

    const overlaps = await sql<{ n: number }>`
      select count(*)::int as n from bookings a join bookings b
        on a.staff_id = b.staff_id and a.id < b.id
       and tstzrange(a.occupied_start, a.occupied_end) && tstzrange(b.occupied_start, b.occupied_end)
      where a.status <> 'cancelled' and b.status <> 'cancelled'`.execute(env.db);
    expect(overlaps.rows[0]!.n).toBe(0);
  });

  it('parallel reschedules into the same free slot → one wins', async () => {
    const jasur = env.seed.staffIds.masters[0]!;
    const made = [];
    for (const [i, hm] of ['15:00', '16:00', '17:00', '18:00', '19:00'].entries()) {
      const [r] = await burst(1, jasur, at(1, hm), 70_000 + i);
      expect(r!.statusCode).toBe(201);
      made.push({ id: r!.json().booking.id as string, tg: 70_000 + i });
    }
    const target = at(2, '11:00');
    const results = await Promise.all(
      made.map(async (m) =>
        env.app.inject({
          method: 'POST',
          url: `${B}/bookings/${m.id}/reschedule`,
          headers: { authorization: await env.tma({ id: m.tg }) },
          payload: { start: target },
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
  });
});
