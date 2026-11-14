/**
 * Telegram authentication with WebCrypto (works in Node 20+ and browsers).
 *
 * - Mini App `initData`: secret = HMAC_SHA256(key="WebAppData", msg=botToken),
 *   hash = hex(HMAC_SHA256(key=secret, msg=dataCheckString)).
 * - Login Widget: secret = SHA256(botToken), hash = hex(HMAC_SHA256(key=secret, msg=dataCheckString)).
 * - Session tokens for the web admin: compact HMAC-signed JSON (`payload.signature`, base64url).
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface InitData {
  user: TelegramUser;
  authDate: number;
  startParam?: string;
  queryId?: string;
  raw: Record<string, string>;
}

export type AuthFailure = 'MISSING_HASH' | 'BAD_HASH' | 'EXPIRED' | 'NO_USER' | 'MALFORMED';

export class TelegramAuthError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(`Telegram auth failed: ${reason}`);
    this.name = 'TelegramAuthError';
  }
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** Constant-time comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function dataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

async function webAppSecret(botToken: string): Promise<ArrayBuffer> {
  return hmac(enc.encode('WebAppData'), botToken);
}

export interface ValidateOptions {
  /** Max age of auth_date in seconds (default 24h). */
  maxAgeSec?: number;
  now?: number;
}

/** Validates a Mini App `initData` query string. Throws TelegramAuthError on failure. */
export async function validateInitData(
  initData: string,
  botToken: string,
  opts: ValidateOptions = {},
): Promise<InitData> {
  const params = new URLSearchParams(initData);
  const fields: Record<string, string> = {};
  for (const [k, v] of params) fields[k] = v;
  const hash = fields.hash;
  if (!hash) throw new TelegramAuthError('MISSING_HASH');
  const expected = toHex(await hmac(await webAppSecret(botToken), dataCheckString(fields)));
  if (!safeEqual(expected, hash.toLowerCase())) throw new TelegramAuthError('BAD_HASH');
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate)) throw new TelegramAuthError('MALFORMED');
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeSec ?? 86_400;
  if (now / 1000 - authDate > maxAge) throw new TelegramAuthError('EXPIRED');
  if (!fields.user) throw new TelegramAuthError('NO_USER');
  let user: TelegramUser;
  try {
    user = JSON.parse(fields.user) as TelegramUser;
  } catch {
    throw new TelegramAuthError('MALFORMED');
  }
  if (typeof user.id !== 'number') throw new TelegramAuthError('NO_USER');
  return { user, authDate, startParam: fields.start_param, queryId: fields.query_id, raw: fields };
}

/** Produces a valid initData string. Used by tests and the local dev mock — never by clients. */
export async function signInitData(
  data: { user: TelegramUser; authDate?: number; startParam?: string; queryId?: string },
  botToken: string,
): Promise<string> {
  const fields: Record<string, string> = {
    auth_date: String(data.authDate ?? Math.floor(Date.now() / 1000)),
    user: JSON.stringify(data.user),
  };
  if (data.startParam) fields.start_param = data.startParam;
  if (data.queryId) fields.query_id = data.queryId;
  const hash = toHex(await hmac(await webAppSecret(botToken), dataCheckString(fields)));
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Validates data from the Telegram Login Widget (used by the web admin outside Telegram). */
export async function validateLoginWidget(
  fields: Record<string, string | number>,
  botToken: string,
  opts: ValidateOptions = {},
): Promise<TelegramUser> {
  const strFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) strFields[k] = String(v);
  const hash = strFields.hash;
  if (!hash) throw new TelegramAuthError('MISSING_HASH');
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  const expected = toHex(await hmac(secret, dataCheckString(strFields)));
  if (!safeEqual(expected, hash.toLowerCase())) throw new TelegramAuthError('BAD_HASH');
  const now = opts.now ?? Date.now();
  if (now / 1000 - Number(strFields.auth_date) > (opts.maxAgeSec ?? 86_400))
    throw new TelegramAuthError('EXPIRED');
  return {
    id: Number(strFields.id),
    first_name: strFields.first_name ?? '',
    last_name: strFields.last_name,
    username: strFields.username,
    photo_url: strFields.photo_url,
  };
}

export async function signLoginWidget(user: TelegramUser & { auth_date: number }, botToken: string) {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(user)) if (v !== undefined) fields[k] = String(v);
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  return { ...fields, hash: toHex(await hmac(secret, dataCheckString(fields))) };
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface SessionPayload {
  sub: string;
  role?: string;
  exp: number;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(new Uint8Array(await hmac(enc.encode(secret), body)));
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(new Uint8Array(await hmac(enc.encode(secret), body)));
  if (!safeEqual(expected, sig)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
