import { type Kysely, sql } from 'kysely';
import { MIGRATIONS } from './migrations.js';
import type { DB } from './schema.js';

/** Applies pending migrations inside one transaction each. Safe to call on every start. */
export async function migrate(db: Kysely<DB>): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`.execute(
    db,
  );
  const applied = new Set(
    (await sql<{ id: string }>`SELECT id FROM _migrations`.execute(db)).rows.map((r) => r.id),
  );
  const done: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.transaction().execute(async (trx) => {
      // Serialise concurrent migrators (API + bot starting together).
      await sql`SELECT pg_advisory_xact_lock(4242)`.execute(trx);
      const again = await sql<{ id: string }>`SELECT id FROM _migrations WHERE id = ${m.id}`.execute(trx);
      if (again.rows.length > 0) return;
      for (const statement of m.statements) await sql.raw(statement).execute(trx);
      await sql`INSERT INTO _migrations (id) VALUES (${m.id})`.execute(trx);
      done.push(m.id);
    });
  }
  return done;
}
