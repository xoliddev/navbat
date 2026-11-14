import { DomainError, type Lang, withDefaults } from '@navbat/core';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { type Db, ms } from './context.js';
import type {
  BranchDTO,
  BusinessDTO,
  CatalogDTO,
  CategoryDTO,
  ScheduleRuleDTO,
  ServiceDTO,
  StaffDTO,
  TimeOffDTO,
} from './dto.js';
import type { DB } from './schema.js';

export function toBusiness(row: Selectable<DB['businesses']>): BusinessDTO {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    timezone: row.timezone,
    currency: row.currency,
    phone: row.phone,
    settings: withDefaults(row.settings),
  };
}

export function toService(row: Selectable<DB['services']>): ServiceDTO {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description ?? {},
    durationMin: row.duration_min,
    price: row.price,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    position: row.position,
    active: row.active,
  };
}

export function toTimeOff(row: Selectable<DB['time_off']>): TimeOffDTO {
  return {
    id: row.id,
    staffId: row.staff_id,
    kind: row.kind,
    startAt: ms(row.start_at),
    endAt: ms(row.end_at),
    reason: row.reason,
  };
}

export async function getBusiness(db: Db, idOrSlug: string): Promise<BusinessDTO> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const row = await db
    .selectFrom('businesses')
    .selectAll()
    .where(isUuid ? 'id' : 'slug', '=', idOrSlug)
    .executeTakeFirst();
  if (!row) throw new DomainError('NOT_FOUND', 'Business not found');
  return toBusiness(row);
}

export async function listStaff(
  db: Db,
  businessId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<StaffDTO[]> {
  let q = db.selectFrom('staff').selectAll().where('business_id', '=', businessId);
  if (!opts.includeInactive) q = q.where('active', '=', true);
  const rows = await q.orderBy('position').orderBy('name').execute();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [offers, ratings] = await Promise.all([
    db.selectFrom('staff_services').selectAll().where('staff_id', 'in', ids).execute(),
    db
      .selectFrom('reviews')
      .select([
        'staff_id',
        sql<number>`avg(rating)::float8`.as('avg'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('staff_id', 'in', ids)
      .groupBy('staff_id')
      .execute(),
  ]);
  return rows.map((r) => {
    const rating = ratings.find((x) => x.staff_id === r.id);
    return {
      id: r.id,
      branchId: r.branch_id,
      name: r.name,
      title: r.title ?? {},
      bio: r.bio ?? {},
      color: r.color,
      photoUrl: r.photo_url,
      role: r.role,
      bookable: r.bookable,
      active: r.active,
      position: r.position,
      telegramUserId: r.telegram_user_id,
      lang: r.lang as Lang,
      services: offers
        .filter((o) => o.staff_id === r.id)
        .map((o) => ({ serviceId: o.service_id, durationMin: o.duration_min, price: o.price })),
      rating: rating ? Math.round(Number(rating.avg) * 10) / 10 : null,
      reviewCount: rating ? Number(rating.count) : 0,
    };
  });
}

export async function getCatalog(
  db: Db,
  businessIdOrSlug: string,
  opts: { includeInactive?: boolean } = {},
): Promise<CatalogDTO> {
  const business = await getBusiness(db, businessIdOrSlug);
  const [branches, categories, services, staff] = await Promise.all([
    db
      .selectFrom('branches')
      .selectAll()
      .where('business_id', '=', business.id)
      .where('active', '=', true)
      .orderBy('position')
      .execute(),
    db
      .selectFrom('service_categories')
      .selectAll()
      .where('business_id', '=', business.id)
      .orderBy('position')
      .execute(),
    (() => {
      let q = db.selectFrom('services').selectAll().where('business_id', '=', business.id);
      if (!opts.includeInactive) q = q.where('active', '=', true);
      return q.orderBy('position').execute();
    })(),
    listStaff(db, business.id, opts),
  ]);
  return {
    business,
    branches: branches.map(
      (b): BranchDTO => ({ id: b.id, name: b.name, address: b.address, phone: b.phone }),
    ),
    categories: categories.map((c): CategoryDTO => ({ id: c.id, name: c.name, position: c.position })),
    services: services.map(toService),
    staff,
  };
}

export async function getSchedule(db: Db, staffId: string): Promise<ScheduleRuleDTO[]> {
  const rows = await db
    .selectFrom('schedule_rules')
    .select(['kind', 'weekday', 'start_min', 'end_min'])
    .where('staff_id', '=', staffId)
    .orderBy('weekday')
    .orderBy('start_min')
    .execute();
  return rows.map((r) => ({ kind: r.kind, weekday: r.weekday, startMin: r.start_min, endMin: r.end_min }));
}
