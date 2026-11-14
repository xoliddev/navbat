/**
 * Kysely dialect for PGlite (PostgreSQL compiled to WASM). The browser demo runs the very
 * same migrations, constraints and services as the production API on top of it.
 */
import { PGlite, type PGliteOptions, types } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from 'kysely';
import type { DB } from './schema.js';

/** Serialises access: PGlite has a single connection, a transaction must own it. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

class PGliteConnection implements DatabaseConnection {
  constructor(private readonly pg: PGlite) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const res = await this.pg.query<R>(compiled.sql, compiled.parameters as unknown[]);
    const affected = res.affectedRows;
    return {
      rows: res.rows,
      numAffectedRows: affected !== undefined ? BigInt(affected) : undefined,
    };
  }

  // biome-ignore lint/correctness/useYield: streaming is not supported by PGlite
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite dialect does not support streaming');
  }
}

class PGliteDriver implements Driver {
  private readonly mutex = new Mutex();
  private readonly releases = new WeakMap<DatabaseConnection, () => void>();
  private readonly connection: PGliteConnection;

  constructor(private readonly pg: PGlite) {
    this.connection = new PGliteConnection(pg);
  }

  async init(): Promise<void> {
    await this.pg.waitReady;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const release = await this.mutex.lock();
    // A fresh wrapper per acquisition so the release callback is tracked per holder.
    const conn = Object.create(this.connection) as PGliteConnection;
    this.releases.set(conn, release);
    return conn;
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await this.pg.query('BEGIN');
    void conn;
  }

  async commitTransaction(): Promise<void> {
    await this.pg.query('COMMIT');
  }

  async rollbackTransaction(): Promise<void> {
    await this.pg.query('ROLLBACK');
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    this.releases.get(conn)?.();
    this.releases.delete(conn);
  }

  async destroy(): Promise<void> {
    await this.pg.close();
  }
}

export class PGliteDialect implements Dialect {
  constructor(private readonly pg: PGlite) {}
  createAdapter() {
    return new PostgresAdapter();
  }
  createDriver(): Driver {
    return new PGliteDriver(this.pg);
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }
}

/** Creates a PGlite instance with the extensions and type parsers our schema expects. */
export async function createPGlite(dataDir?: string, options: Partial<PGliteOptions> = {}): Promise<PGlite> {
  const pg = await PGlite.create({
    ...options,
    ...(dataDir ? { dataDir } : {}),
    extensions: { btree_gist, ...(options.extensions ?? {}) },
    parsers: {
      // int8 → number (telegram ids and counts fit in 2^53)
      [types.INT8]: (v: string) => Number(v),
      // keep DATE as 'YYYY-MM-DD' instead of a local-time Date
      [types.DATE]: (v: string) => v,
    },
  });
  return pg;
}

export function kyselyFromPGlite(pg: PGlite): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PGliteDialect(pg) });
}
