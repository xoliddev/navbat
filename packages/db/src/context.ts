import type { PaymentProvider, ProviderId } from '@navbat/core';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from './schema.js';

export type Db = Kysely<DB> | Transaction<DB>;

/** Everything a service needs from the outside world — injected, so tests control time. */
export interface AppContext {
  db: Kysely<DB>;
  now: () => number;
  /** Mini App URL used in notification buttons. */
  appUrl: string;
  payments?: (id: ProviderId) => PaymentProvider | undefined;
  random?: () => number;
}

export function ms(value: Date | string | number): number {
  if (typeof value === 'number') return value;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function iso(value: number): string {
  return new Date(value).toISOString();
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/** PostgreSQL error code of a driver error (pg and PGlite both expose `.code`). */
export function pgCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) return String((e as { code: unknown }).code);
  return undefined;
}

export const EXCLUSION_VIOLATION = '23P01';
export const UNIQUE_VIOLATION = '23505';
