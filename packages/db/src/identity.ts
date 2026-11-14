import { type Lang, langFromTelegram, type Role, type TelegramUser } from '@navbat/core';
import type { Db } from './context.js';

export interface CustomerIdentity {
  customerId: string;
  name: string;
  phone: string | null;
  lang: Lang;
  isNew: boolean;
}

export function displayName(u: Pick<TelegramUser, 'first_name' | 'last_name'>): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Telegram user';
}

/** Customer record for a Telegram user, created on first contact. */
export async function customerFromTelegram(
  db: Db,
  businessId: string,
  user: TelegramUser,
): Promise<CustomerIdentity> {
  const existing = await db
    .selectFrom('customers')
    .select(['id', 'name', 'phone', 'lang'])
    .where('business_id', '=', businessId)
    .where('telegram_user_id', '=', user.id)
    .executeTakeFirst();
  if (existing)
    return {
      customerId: existing.id,
      name: existing.name,
      phone: existing.phone,
      lang: existing.lang,
      isNew: false,
    };
  const lang = langFromTelegram(user.language_code);
  const row = await db
    .insertInto('customers')
    .values({ business_id: businessId, telegram_user_id: user.id, name: displayName(user), lang })
    .onConflict((oc) =>
      oc.columns(['business_id', 'telegram_user_id']).doUpdateSet({ name: displayName(user) }),
    )
    .returning(['id', 'name', 'phone', 'lang'])
    .executeTakeFirstOrThrow();
  return { customerId: row.id, name: row.name, phone: row.phone, lang: row.lang, isNew: true };
}

export async function setCustomerLang(
  db: Db,
  businessId: string,
  telegramUserId: number,
  lang: Lang,
): Promise<void> {
  await db
    .updateTable('customers')
    .set({ lang })
    .where('business_id', '=', businessId)
    .where('telegram_user_id', '=', telegramUserId)
    .execute();
}

export interface StaffIdentity {
  staffId: string;
  name: string;
  role: Role;
  lang: Lang;
}

export async function staffFromTelegram(
  db: Db,
  businessId: string,
  telegramUserId: number,
): Promise<StaffIdentity | null> {
  const row = await db
    .selectFrom('staff')
    .select(['id', 'name', 'role', 'lang'])
    .where('business_id', '=', businessId)
    .where('telegram_user_id', '=', telegramUserId)
    .where('active', '=', true)
    .executeTakeFirst();
  return row ? { staffId: row.id, name: row.name, role: row.role, lang: row.lang } : null;
}

export async function staffById(db: Db, businessId: string, staffId: string): Promise<StaffIdentity | null> {
  const row = await db
    .selectFrom('staff')
    .select(['id', 'name', 'role', 'lang'])
    .where('business_id', '=', businessId)
    .where('id', '=', staffId)
    .where('active', '=', true)
    .executeTakeFirst();
  return row ? { staffId: row.id, name: row.name, role: row.role, lang: row.lang } : null;
}
