/** PostgreSQL (node-postgres) connection for the API and the bot. */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.js';

// int8 → number (telegram ids and count(*) fit in 2^53), DATE stays a 'YYYY-MM-DD' string.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export interface PgOptions {
  connectionString: string;
  max?: number;
}

export function createPgDb(opts: PgOptions): { db: Kysely<DB>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: opts.connectionString, max: opts.max ?? 10 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}
