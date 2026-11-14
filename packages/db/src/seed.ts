/**
 * "Demo Barbershop" — deterministic seed used by the browser demo, `npm run db:seed` and tests.
 * History is generated relative to `now` so the calendar always looks alive.
 */
import {
  addDays,
  availableIntervals,
  bookingCode,
  isoWeekday,
  type LocalizedText,
  type StaffAvailability,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from '@navbat/core';
import type { Insertable, Kysely } from 'kysely';
import { json } from './context.js';
import type { DB } from './schema.js';

export const DEMO_SLUG = 'demo';
export const DEMO_TZ = 'Asia/Tashkent';
/** Telegram ids used by the demo (not real accounts). */
export const DEMO_IDS = {
  visitor: 1001,
  owner: 2000,
  admin: 2001,
  masters: [2101, 2102, 2103, 2104],
} as const;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ServiceSeed {
  key: string;
  cat: 'hair' | 'beard' | 'care';
  name: LocalizedText;
  description: LocalizedText;
  duration: number;
  price: number;
  before?: number;
  after?: number;
}

const SERVICES: ServiceSeed[] = [
  {
    key: 'classic',
    cat: 'hair',
    name: { uz: 'Klassik soch olish', ru: 'Классическая стрижка', en: 'Classic haircut' },
    description: {
      uz: 'Qaychi va mashinka, yuvish va ukladka bilan.',
      ru: 'Ножницы и машинка, мытьё и укладка.',
      en: 'Scissors and clippers, wash and styling included.',
    },
    duration: 45,
    price: 70_000,
  },
  {
    key: 'fade',
    cat: 'hair',
    name: { uz: 'Skin fade', ru: 'Скин фейд', en: 'Skin fade' },
    description: {
      uz: 'Nol darajadan silliq oʻtish, aniq kontur.',
      ru: 'Плавный переход от нуля, чёткий контур.',
      en: 'Smooth blend from zero with a sharp outline.',
    },
    duration: 60,
    price: 90_000,
  },
  {
    key: 'kids',
    cat: 'hair',
    name: { uz: 'Bolalar soch olish', ru: 'Детская стрижка', en: 'Kids haircut' },
    description: { uz: '12 yoshgacha.', ru: 'До 12 лет.', en: 'Up to 12 years old.' },
    duration: 30,
    price: 50_000,
  },
  {
    key: 'long',
    cat: 'hair',
    name: { uz: 'Uzun soch modeli', ru: 'Модельная на длинные волосы', en: 'Long hair styling cut' },
    description: {
      uz: 'Konsultatsiya va shakl tanlash bilan.',
      ru: 'С консультацией и подбором формы.',
      en: 'With a consultation on shape.',
    },
    duration: 75,
    price: 110_000,
  },
  {
    key: 'beard',
    cat: 'beard',
    name: { uz: 'Soqol shakli', ru: 'Оформление бороды', en: 'Beard trim & shape' },
    description: {
      uz: 'Kontur, uzunlik, yogʻ bilan parvarish.',
      ru: 'Контур, длина, уход маслом.',
      en: 'Outline, length, oil care.',
    },
    duration: 30,
    price: 50_000,
  },
  {
    key: 'shave',
    cat: 'beard',
    name: { uz: 'Qirol soqol olish', ru: 'Королевское бритьё', en: 'Royal shave' },
    description: {
      uz: 'Issiq sochiq va ustara bilan. Asboblar har mijozdan keyin sterillanadi.',
      ru: 'Горячее полотенце и опасная бритва. Инструмент стерилизуется после каждого клиента.',
      en: 'Hot towel and straight razor. Tools are sterilised after every client.',
    },
    duration: 45,
    price: 70_000,
    before: 5,
    after: 10,
  },
  {
    key: 'wash',
    cat: 'care',
    name: { uz: 'Bosh yuvish va ukladka', ru: 'Мытьё головы и укладка', en: 'Wash & styling' },
    description: {
      uz: 'Professional vositalar bilan.',
      ru: 'Профессиональная косметика.',
      en: 'Professional products.',
    },
    duration: 15,
    price: 25_000,
  },
  {
    key: 'camo',
    cat: 'care',
    name: { uz: 'Oq sochni boʻyash', ru: 'Камуфляж седины', en: 'Grey camouflage' },
    description: {
      uz: 'Tabiiy tus, 20 daqiqa taʼsir.',
      ru: 'Естественный оттенок, 20 минут.',
      en: 'Natural tone, 20 minutes to set.',
    },
    duration: 30,
    price: 60_000,
    after: 10,
  },
];

interface MasterSeed {
  name: string;
  title: LocalizedText;
  bio: LocalizedText;
  color: string;
  branch: 0 | 1;
  services: Record<string, { price?: number; duration?: number } | true>;
  /** [weekday, start, end][] in minutes */
  work: [number, number, number][];
  breaks: [number, number, number][];
}

const h = (x: number) => x * 60;
const days = (list: number[], start: number, end: number): [number, number, number][] =>
  list.map((d) => [d, start, end]);

const MASTERS: MasterSeed[] = [
  {
    name: 'Jasur Aminov',
    title: { uz: 'Katta usta', ru: 'Старший мастер', en: 'Senior barber' },
    bio: {
      uz: '9 yillik tajriba. Klassika va qaychi bilan ishlash ustasi.',
      ru: '9 лет опыта. Мастер классики и работы ножницами.',
      en: '9 years behind the chair. Classic cuts and scissor work.',
    },
    color: '#2f5bea',
    branch: 0,
    services: {
      classic: { price: 80_000 },
      fade: { price: 100_000 },
      long: true,
      beard: true,
      shave: true,
      wash: true,
      camo: true,
    },
    work: days([1, 2, 3, 4, 5, 6], h(10), h(20)),
    breaks: days([1, 2, 3, 4, 5, 6], h(14), h(15)),
  },
  {
    name: 'Bekzod Rahimov',
    title: { uz: 'Fade ustasi', ru: 'Мастер фейдов', en: 'Fade specialist' },
    bio: {
      uz: 'Zamonaviy fade va teksturali soch turmaklari.',
      ru: 'Современные фейды и текстурные стрижки.',
      en: 'Modern fades and textured crops.',
    },
    color: '#0f9d8a',
    branch: 0,
    services: { classic: true, fade: true, kids: true, beard: true, wash: true },
    work: days([2, 3, 4, 5, 6, 7], h(11), h(21)),
    breaks: days([2, 3, 4, 5, 6, 7], h(15), h(16)),
  },
  {
    name: 'Sardor Yoʻldoshev',
    title: { uz: 'Soqol ustasi', ru: 'Мастер по бороде', en: 'Beard master' },
    bio: {
      uz: 'Ustara bilan soqol olish va soqol dizayni.',
      ru: 'Бритьё опасной бритвой и дизайн бороды.',
      en: 'Straight-razor shaves and beard design.',
    },
    color: '#c2410c',
    branch: 0,
    services: { classic: true, beard: { price: 60_000 }, shave: { price: 85_000 }, camo: true, wash: true },
    work: [...days([1, 2, 3, 4, 5], h(9), h(18)), [6, h(10), h(16)]],
    breaks: days([1, 2, 3, 4, 5], h(13), h(14)),
  },
  {
    name: 'Diyor Karimov',
    title: { uz: 'Usta', ru: 'Мастер', en: 'Barber' },
    bio: {
      uz: 'Yunusoboddagi filialimiz. Kechki vaqtlarda ham ishlaydi.',
      ru: 'Наш филиал на Юнусабаде. Работает и вечером.',
      en: 'Our Yunusobod branch. Takes late appointments.',
    },
    color: '#7c3aed',
    branch: 1,
    services: {
      classic: { price: 60_000 },
      fade: { price: 80_000, duration: 75 },
      kids: { price: 45_000 },
      beard: { price: 40_000 },
      wash: true,
    },
    work: days([1, 2, 3, 4, 5, 6], h(12), h(21) + 30),
    breaks: [],
  },
];

const CLIENTS: [string, string][] = [
  ['Aziz Rahimov', 'uz'],
  ['Sherzod Toshmatov', 'uz'],
  ['Bobur Aliyev', 'uz'],
  ['Javohir Qodirov', 'uz'],
  ['Otabek Yusupov', 'uz'],
  ['Ulugʻbek Saidov', 'uz'],
  ['Doniyor Ergashev', 'uz'],
  ['Akmal Nazarov', 'uz'],
  ['Timur Abdullayev', 'ru'],
  ['Islom Mirzayev', 'uz'],
  ['Farrux Xolmatov', 'uz'],
  ['Shohruh Usmonov', 'uz'],
  ['Asadbek Raximov', 'uz'],
  ['Behruz Karimov', 'uz'],
  ['Elyor Tursunov', 'uz'],
  ['Nodir Ismoilov', 'uz'],
  ['Kamron Joʻrayev', 'uz'],
  ['Rustam Sobirov', 'ru'],
  ['Alisher Nurmatov', 'uz'],
  ['Dmitriy Kim', 'ru'],
  ['Artyom Pak', 'ru'],
  ['Sergey Li', 'ru'],
  ['Mansur Hamidov', 'uz'],
  ['Laziz Qosimov', 'uz'],
  ['Sanjar Boboyev', 'uz'],
  ['Jamshid Olimov', 'uz'],
  ['Daniel Becker', 'en'],
  ['Ravshan Hasanov', 'uz'],
];

const REVIEW_TEXTS: Record<string, string[]> = {
  uz: [
    'Zoʻr, har doimgidek!',
    'Juda toza va tez.',
    'Usta oʻz ishini biladi.',
    'Fade aʼlo chiqdi, rahmat!',
    '',
  ],
  ru: ['Отлично, как всегда!', 'Чисто и без ожидания.', 'Лучший барбершоп в районе.', ''],
  en: ['Great cut, friendly team.', 'Booked in a minute, no waiting.', ''],
};

export interface SeedOptions {
  now: number;
  /** Generate past/future bookings, reviews and blocks (default true). */
  history?: boolean;
  seed?: number;
  /** Prepayment demo: percent of the price paid upfront through the sandbox provider. */
  depositPercent?: number;
}

export interface SeedResult {
  businessId: string;
  serviceIds: Record<string, string>;
  staffIds: { owner: string; admin: string; masters: string[] };
  visitorCustomerId: string;
}

async function insertChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function seedDemo(db: Kysely<DB>, opts: SeedOptions): Promise<SeedResult> {
  const rand = mulberry32(opts.seed ?? 20261113);
  const tz = DEMO_TZ;
  const today = todayIn(tz, opts.now);
  const history = opts.history ?? true;

  const business = await db
    .insertInto('businesses')
    .values({
      slug: DEMO_SLUG,
      name: 'Demo Barbershop',
      kind: 'barbershop',
      timezone: tz,
      phone: '+998712000000',
      settings: json({
        minNoticeMin: 30,
        horizonDays: 30,
        slotStepMin: 15,
        cancelWindowMin: 120,
        depositPercent: opts.depositPercent ?? 0,
        paymentProvider: (opts.depositPercent ?? 0) > 0 ? 'sandbox' : 'none',
        digestHour: 8,
      }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const businessId = business.id;

  const branches = await db
    .insertInto('branches')
    .values([
      {
        business_id: businessId,
        name: 'Chilonzor',
        address: 'Bunyodkor shoh koʻchasi, 24',
        phone: '+998712000000',
        position: 0,
      },
      {
        business_id: businessId,
        name: 'Yunusobod',
        address: 'Amir Temur koʻchasi, 107',
        phone: '+998712000001',
        position: 1,
      },
    ])
    .returning('id')
    .execute();

  const cats = await db
    .insertInto('service_categories')
    .values([
      { business_id: businessId, name: json({ uz: 'Soch', ru: 'Стрижки', en: 'Hair' }), position: 0 },
      { business_id: businessId, name: json({ uz: 'Soqol', ru: 'Борода', en: 'Beard' }), position: 1 },
      { business_id: businessId, name: json({ uz: 'Parvarish', ru: 'Уход', en: 'Care' }), position: 2 },
    ])
    .returning('id')
    .execute();
  const catId = { hair: cats[0]!.id, beard: cats[1]!.id, care: cats[2]!.id };

  const serviceRows = await db
    .insertInto('services')
    .values(
      SERVICES.map((s, i) => ({
        business_id: businessId,
        category_id: catId[s.cat],
        name: json(s.name),
        description: json(s.description),
        duration_min: s.duration,
        price: s.price,
        buffer_before_min: s.before ?? 0,
        buffer_after_min: s.after ?? 0,
        position: i,
      })),
    )
    .returning('id')
    .execute();
  const serviceIds = Object.fromEntries(SERVICES.map((s, i) => [s.key, serviceRows[i]!.id]));

  const people = await db
    .insertInto('staff')
    .values([
      {
        business_id: businessId,
        branch_id: branches[0]!.id,
        name: 'Rustam Karimov',
        title: json({ uz: 'Egasi', ru: 'Владелец', en: 'Owner' }),
        role: 'owner',
        bookable: false,
        telegram_user_id: DEMO_IDS.owner,
        color: '#334155',
        position: 100,
      },
      {
        business_id: businessId,
        branch_id: branches[0]!.id,
        name: 'Malika Sodiqova',
        title: json({ uz: 'Administrator', ru: 'Администратор', en: 'Front desk' }),
        role: 'admin',
        bookable: false,
        telegram_user_id: DEMO_IDS.admin,
        color: '#be185d',
        position: 101,
      },
      ...MASTERS.map((m, i) => ({
        business_id: businessId,
        branch_id: branches[m.branch]!.id,
        name: m.name,
        title: json(m.title),
        bio: json(m.bio),
        color: m.color,
        role: 'master' as const,
        bookable: true,
        telegram_user_id: DEMO_IDS.masters[i]!,
        position: i,
      })),
    ])
    .returning('id')
    .execute();
  const ownerId = people[0]!.id;
  const adminId = people[1]!.id;
  const masterIds = people.slice(2).map((p) => p.id);

  await db
    .insertInto('staff_services')
    .values(
      MASTERS.flatMap((m, i) =>
        Object.entries(m.services).map(([key, o]) => ({
          staff_id: masterIds[i]!,
          service_id: serviceIds[key]!,
          price: o === true ? null : (o.price ?? null),
          duration_min: o === true ? null : (o.duration ?? null),
        })),
      ),
    )
    .execute();

  await db
    .insertInto('schedule_rules')
    .values(
      MASTERS.flatMap((m, i) => [
        ...m.work.map(([weekday, start, end]) => ({
          staff_id: masterIds[i]!,
          kind: 'work' as const,
          weekday,
          start_min: start,
          end_min: end,
        })),
        ...m.breaks.map(([weekday, start, end]) => ({
          staff_id: masterIds[i]!,
          kind: 'break' as const,
          weekday,
          start_min: start,
          end_min: end,
        })),
      ]),
    )
    .execute();

  // Demo visitor (the person trying the Mini App) plus regular clients.
  const visitor = await db
    .insertInto('customers')
    .values({
      business_id: businessId,
      name: 'Akmal Demo',
      phone: '+998900000001',
      telegram_user_id: DEMO_IDS.visitor,
      lang: 'uz',
      created_at: new Date(opts.now - 40 * 86_400_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const clientRows = await db
    .insertInto('customers')
    .values(
      CLIENTS.map(([name, lang], i) => ({
        business_id: businessId,
        name,
        lang: lang as 'uz' | 'ru' | 'en',
        phone: `+99890${String(1_100_000 + i * 37_411).padStart(7, '0')}`,
        telegram_user_id: i % 3 === 2 ? null : 3000 + i,
        created_at: new Date(opts.now - (10 + Math.floor(rand() * 80)) * 86_400_000),
      })),
    )
    .returning(['id', 'lang'])
    .execute();

  if (!history) {
    return {
      businessId,
      serviceIds,
      staffIds: { owner: ownerId, admin: adminId, masters: masterIds },
      visitorCustomerId: visitor.id,
    };
  }

  // Time off: a business-wide sanitary day, a short vacation and a training block.
  const holiday = addDays(today, 9);
  // Jasur's training block: the next day he works (he is off on Sundays).
  const blockDay = isoWeekday(addDays(today, 1)) === 7 ? addDays(today, 2) : addDays(today, 1);
  const timeOff = [
    {
      business_id: businessId,
      staff_id: null,
      kind: 'holiday' as const,
      start_at: new Date(zonedToUtc(holiday, 0, tz)),
      end_at: new Date(zonedToUtc(addDays(holiday, 1), 0, tz)),
      reason: 'Sanitariya kuni',
    },
    {
      business_id: businessId,
      staff_id: masterIds[1]!,
      kind: 'vacation' as const,
      start_at: new Date(zonedToUtc(addDays(today, 4), 0, tz)),
      end_at: new Date(zonedToUtc(addDays(today, 7), 0, tz)),
      reason: 'Taʼtil',
    },
    {
      business_id: businessId,
      staff_id: masterIds[0]!,
      kind: 'block' as const,
      start_at: new Date(zonedToUtc(blockDay, h(16), tz)),
      end_at: new Date(zonedToUtc(blockDay, h(17), tz)),
      reason: 'Oʻquv mashgʻuloti',
    },
  ];
  await db.insertInto('time_off').values(timeOff).execute();

  const bookings: (Insertable<DB['bookings']> & { id: string })[] = [];
  const items: {
    booking_id: string;
    service_id: string;
    position: number;
    start_at: Date;
    end_at: Date;
    price: number;
    name: string;
  }[] = [];
  const usedCodes = new Set<string>();
  const svcBy = Object.fromEntries(SERVICES.map((s) => [s.key, s]));
  const holidayInterval = { start: zonedToUtc(holiday, 0, tz), end: zonedToUtc(addDays(holiday, 1), 0, tz) };
  const pastBookings: { id: string; customer: number; staff: number; end: number }[] = [];

  for (let d = -35; d <= 16; d++) {
    const date = addDays(today, d);
    MASTERS.forEach((m, mi) => {
      const avail: StaffAvailability = {
        staffId: masterIds[mi]!,
        services: {},
        workingHours: m.work.map(([weekday, startMin, endMin]) => ({ weekday, startMin, endMin })),
        breaks: m.breaks.map(([weekday, startMin, endMin]) => ({ weekday, startMin, endMin })),
        timeOff: [
          holidayInterval,
          ...timeOff
            .filter((t) => t.staff_id === masterIds[mi])
            .map((t) => ({ start: t.start_at.getTime(), end: t.end_at.getTime() })),
        ],
        busy: [],
      };
      const fill = d < 0 ? 0.62 : d === 0 ? 0.5 : d <= 3 ? 0.42 : 0.25;
      let lastEnd = 0;
      for (const free of availableIntervals(avail, date, tz)) {
        if (utcToZoned(free.start, tz).date !== date) continue;
        let t = free.start;
        while (t < free.end) {
          const keys = Object.keys(m.services);
          const key = keys[Math.floor(rand() * keys.length)]!;
          const combo = rand() < 0.18 && key !== 'beard' && m.services.beard ? [key, 'beard'] : [key];
          const chain = combo.map((k) => {
            const o = m.services[k]!;
            const s = svcBy[k]!;
            return {
              key: k,
              duration: o === true ? s.duration : (o.duration ?? s.duration),
              price: o === true ? s.price : (o.price ?? s.price),
              before: s.before ?? 0,
              after: s.after ?? 0,
            };
          });
          let offset = 0;
          const plan = chain.map((c, i) => {
            if (i > 0) offset += Math.max(chain[i - 1]!.after, c.before);
            const p = { ...c, offset };
            offset += c.duration;
            return p;
          });
          const total = offset;
          const before = chain[0]!.before;
          const after = chain.at(-1)!.after;
          const end = t + total * 60_000;
          if (end > free.end) break;
          if (t - before * 60_000 >= lastEnd && rand() < fill) {
            const id = crypto.randomUUID();
            const past = end < opts.now;
            const r = rand();
            const status = past
              ? r < 0.86
                ? 'completed'
                : r < 0.93
                  ? 'no_show'
                  : 'cancelled'
              : r < 0.92
                ? 'confirmed'
                : 'cancelled';
            const clientIndex = Math.floor(rand() * clientRows.length);
            let code = bookingCode(rand);
            while (usedCodes.has(code)) code = bookingCode(rand);
            usedCodes.add(code);
            const sourceR = rand();
            bookings.push({
              id,
              business_id: businessId,
              branch_id: branches[m.branch]!.id,
              staff_id: masterIds[mi]!,
              customer_id: clientRows[clientIndex]!.id,
              code,
              status,
              start_at: new Date(t),
              end_at: new Date(end),
              occupied_start: new Date(t - before * 60_000),
              occupied_end: new Date(end + after * 60_000),
              total_price: plan.reduce((s, p) => s + p.price, 0),
              source:
                sourceR < 0.62 ? 'miniapp' : sourceR < 0.8 ? 'phone' : sourceR < 0.93 ? 'walkin' : 'admin',
              created_at: new Date(t - (1 + Math.floor(rand() * 5)) * 86_400_000),
              cancel_reason: status === 'cancelled' ? 'Rejalar oʻzgardi' : null,
            });
            for (const [position, p] of plan.entries()) {
              items.push({
                booking_id: id,
                service_id: serviceIds[p.key]!,
                position,
                start_at: new Date(t + p.offset * 60_000),
                end_at: new Date(t + (p.offset + p.duration) * 60_000),
                price: p.price,
                name: json(svcBy[p.key]!.name),
              });
            }
            if (status !== 'cancelled') lastEnd = end + after * 60_000;
            if (status === 'completed') pastBookings.push({ id, customer: clientIndex, staff: mi, end });
            t = Math.ceil(lastEnd / (15 * 60_000)) * 15 * 60_000;
            if (t <= end) t = end;
          } else {
            t += (rand() < 0.5 ? 15 : 30) * 60_000;
          }
        }
      }
    });
  }

  // The visitor's own history: a completed visit to rate and a cancelled one.
  const visitDate = addDays(today, -6);
  const vStart = zonedToUtc(visitDate, h(10) + 30, tz);
  const vEnd = vStart + 45 * 60_000;
  const visitorPast = crypto.randomUUID();
  const clash = bookings.find(
    (b) =>
      b.staff_id === masterIds[0] &&
      b.status !== 'cancelled' &&
      (b.occupied_start as Date).getTime() < vEnd &&
      (b.occupied_end as Date).getTime() > vStart,
  );
  if (clash) clash.status = 'cancelled';
  bookings.push({
    id: visitorPast,
    business_id: businessId,
    branch_id: branches[0]!.id,
    staff_id: masterIds[0]!,
    customer_id: visitor.id,
    code: 'N-DEMO',
    status: 'completed',
    start_at: new Date(vStart),
    end_at: new Date(vEnd),
    occupied_start: new Date(vStart),
    occupied_end: new Date(vEnd),
    total_price: 80_000,
    source: 'miniapp',
    created_at: new Date(vStart - 2 * 86_400_000),
  });
  items.push({
    booking_id: visitorPast,
    service_id: serviceIds.classic!,
    position: 0,
    start_at: new Date(vStart),
    end_at: new Date(vEnd),
    price: 80_000,
    name: json(svcBy.classic!.name),
  });

  await insertChunks(bookings, 400, (chunk) => db.insertInto('bookings').values(chunk).execute());
  await insertChunks(items, 600, (chunk) => db.insertInto('booking_items').values(chunk).execute());

  const reviewRows = pastBookings
    .filter(() => rand() < 0.45)
    .map((b) => {
      const lang = clientRows[b.customer]!.lang;
      const texts = REVIEW_TEXTS[lang] ?? REVIEW_TEXTS.uz!;
      const r = rand();
      return {
        business_id: businessId,
        booking_id: b.id,
        customer_id: clientRows[b.customer]!.id,
        staff_id: masterIds[b.staff]!,
        rating: r < 0.72 ? 5 : r < 0.93 ? 4 : 3,
        comment: texts[Math.floor(rand() * texts.length)] || null,
        created_at: new Date(b.end + 3_600_000),
      };
    });
  await insertChunks(reviewRows, 400, (chunk) => db.insertInto('reviews').values(chunk).execute());

  return {
    businessId,
    serviceIds,
    staffIds: { owner: ownerId, admin: adminId, masters: masterIds },
    visitorCustomerId: visitor.id,
  };
}
