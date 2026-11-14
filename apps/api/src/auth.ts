import {
  type Actor,
  can,
  DomainError,
  type Permission,
  TelegramAuthError,
  type TelegramUser,
  validateInitData,
  verifySession,
} from '@navbat/core';
import { type Db, type StaffIdentity, staffById, staffFromTelegram } from '@navbat/db';
import type { FastifyRequest } from 'fastify';

export interface AuthConfig {
  botToken: string;
  sessionSecret: string;
  /** Accept `Authorization: dev <telegramUserId>` (never enabled in production). */
  devAuth: boolean;
  now: () => number;
}

function header(req: FastifyRequest): { scheme: string; value: string } | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const space = raw.indexOf(' ');
  if (space < 0) return null;
  return { scheme: raw.slice(0, space).toLowerCase(), value: raw.slice(space + 1).trim() };
}

/** Telegram user from `tma <initData>` (or `dev <id>` in dev mode). */
export async function telegramUser(req: FastifyRequest, cfg: AuthConfig): Promise<TelegramUser> {
  const h = header(req);
  if (h?.scheme === 'tma') {
    try {
      return (await validateInitData(h.value, cfg.botToken, { now: cfg.now() })).user;
    } catch (e) {
      if (e instanceof TelegramAuthError)
        throw new DomainError('UNAUTHORIZED', `Invalid Telegram data: ${e.reason}`);
      throw e;
    }
  }
  if (h?.scheme === 'dev' && cfg.devAuth) {
    const id = Number(h.value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new DomainError('UNAUTHORIZED', 'Bad dev user id');
    return { id, first_name: 'Dev', language_code: 'uz' };
  }
  throw new DomainError('UNAUTHORIZED', 'Open the app from Telegram');
}

export interface StaffPrincipal extends StaffIdentity {
  actor: Extract<Actor, { kind: 'staff' }>;
}

/** Staff member from a Telegram Mini App session, a web session token, or dev auth. */
export async function staffPrincipal(
  req: FastifyRequest,
  db: Db,
  businessId: string,
  cfg: AuthConfig,
): Promise<StaffPrincipal> {
  const h = header(req);
  let identity: StaffIdentity | null = null;
  if (h?.scheme === 'bearer') {
    const session = await verifySession(h.value, cfg.sessionSecret, cfg.now());
    if (!session) throw new DomainError('UNAUTHORIZED', 'Session expired, sign in again');
    identity = await staffById(db, businessId, session.sub);
  } else {
    const user = await telegramUser(req, cfg);
    identity = await staffFromTelegram(db, businessId, user.id);
  }
  if (!identity) throw new DomainError('FORBIDDEN', 'This account is not a member of the team');
  return { ...identity, actor: { kind: 'staff', staffId: identity.staffId, role: identity.role } };
}

export function requirePermission(p: StaffPrincipal, permission: Permission): void {
  if (!can(p.role, permission)) throw new DomainError('FORBIDDEN', `Your role (${p.role}) cannot do this`);
}
