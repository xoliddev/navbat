import { LANGS } from '@navbat/core';
import { z } from 'zod';

export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Expected an id');
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const instant = z.number().int().positive();
export const lang = z.enum(LANGS);

/** "id,id,id" → string[] */
export const idList = z
  .string()
  .min(1)
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(uuid).min(1).max(5));

/** "any" | id → string | null */
export const staffParam = z
  .union([z.literal('any'), uuid])
  .optional()
  .transform((v) => (!v || v === 'any' ? null : v));

export const localized = z.object({
  uz: z.string().max(300).optional(),
  ru: z.string().max(300).optional(),
  en: z.string().max(300).optional(),
});

export const slug = z.object({ slug: z.string().min(1).max(64) });
export const slugId = slug.extend({ id: uuid });

export const slotsQuery = z.object({ date: localDate, services: idList, staff: staffParam });
export const monthQuery = z.object({ month: localDate, services: idList, staff: staffParam });
export const firstQuery = z.object({ services: idList, staff: staffParam });

export const patchMe = z.object({
  lang: lang.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().max(32).optional(),
});

export const createBookingBody = z.object({
  serviceIds: z.array(uuid).min(1).max(5),
  staffId: uuid.nullable(),
  start: instant,
  name: z.string().trim().min(1).max(80),
  phone: z.string().max(32),
  notes: z.string().max(500).nullish(),
});

export const rescheduleBody = z.object({ start: instant, staffId: uuid.optional() });
export const cancelBody = z.object({ reason: z.string().max(300).nullish() }).default({});
export const lateBody = z.object({ minutes: z.number().int() });
export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullish(),
});

export const loginBody = z
  .object({
    id: z.union([z.number(), z.string()]),
    auth_date: z.union([z.number(), z.string()]),
    hash: z.string().min(10),
  })
  .catchall(z.union([z.string(), z.number()]));

export const rangeQuery = z.object({ from: localDate, to: localDate });
export const calendarQuery = rangeQuery.extend({
  staff: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(uuid).optional()),
});
export const exportQuery = rangeQuery.extend({ lang: lang.default('uz') });

export const adminBookingBody = z.object({
  serviceIds: z.array(uuid).min(1).max(5),
  staffId: uuid.nullable(),
  start: instant,
  customer: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().max(32).nullish() }),
  source: z.enum(['admin', 'phone', 'walkin']).default('admin'),
  notes: z.string().max(500).nullish(),
});

export const statusBody = z.object({ event: z.enum(['complete', 'no_show', 'confirm']) });

export const timeOffBody = z.object({
  staffId: uuid.nullable(),
  start: instant,
  end: instant,
  kind: z.enum(['day_off', 'holiday', 'block', 'vacation']).optional(),
  reason: z.string().max(200).nullish(),
});

export const serviceBody = z.object({
  id: uuid.optional(),
  categoryId: uuid.nullish(),
  name: localized,
  description: localized.optional(),
  durationMin: z.number().int(),
  price: z.number().int(),
  bufferBeforeMin: z.number().int().min(0).max(240).optional(),
  bufferAfterMin: z.number().int().min(0).max(240).optional(),
  position: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const staffBody = z.object({
  id: uuid.optional(),
  branchId: uuid.nullish(),
  name: z.string().trim().min(1).max(80),
  title: localized.optional(),
  bio: localized.optional(),
  color: z.string().optional(),
  role: z.enum(['owner', 'admin', 'master']).optional(),
  bookable: z.boolean().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
  telegramUserId: z.number().int().positive().nullish(),
  lang: lang.optional(),
  services: z
    .array(
      z.object({
        serviceId: uuid,
        durationMin: z.number().int().positive().nullish(),
        price: z.number().int().min(0).nullish(),
      }),
    )
    .optional(),
});

export const scheduleBody = z.object({
  rules: z
    .array(
      z.object({
        kind: z.enum(['work', 'break']),
        weekday: z.number().int(),
        startMin: z.number().int(),
        endMin: z.number().int(),
      }),
    )
    .max(100),
});

export const settingsBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().max(64).optional(),
  phone: z.string().max(32).nullish(),
  settings: z
    .object({
      minNoticeMin: z.number().int().min(0).max(10_080),
      horizonDays: z.number().int(),
      slotStepMin: z.number().int(),
      cancelWindowMin: z.number().int().min(0).max(10_080),
      depositPercent: z.number().int(),
      paymentProvider: z.enum(['sandbox', 'payme', 'click', 'stars', 'none']),
      digestHour: z.number().int().min(0).max(23),
    })
    .partial()
    .optional(),
});

export const clientsQuery = z.object({ search: z.string().max(80).optional() });
export const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });
