/**
 * Telegram message templates (HTML parse mode). Used by the bot in production and by the
 * in-browser demo's simulated chat, so both show exactly the same text.
 */
import { formatDateLong, formatDuration, formatMoney, type Lang } from './i18n.js';
import { formatPhone } from './rules.js';
import { formatTimeIn, utcToZoned } from './time.js';

export interface BookingCard {
  code: string;
  services: string[];
  masterName: string;
  branchName: string;
  address?: string | null;
  startAt: number;
  endAt: number;
  timeZone: string;
  price: number;
  deposit?: number;
  customerName?: string;
  customerPhone?: string | null;
}

export interface DigestItem {
  startAt: number;
  endAt: number;
  services: string[];
  customerName: string;
  customerPhone?: string | null;
  note?: string | null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const e = escapeHtml;

function when(card: Pick<BookingCard, 'startAt' | 'endAt' | 'timeZone'>, lang: Lang): string {
  const date = utcToZoned(card.startAt, card.timeZone).date;
  return `${formatDateLong(date, lang)}, ${formatTimeIn(card.startAt, card.timeZone)}–${formatTimeIn(card.endAt, card.timeZone)}`;
}

interface Labels {
  master: string;
  service: string;
  where: string;
  price: string;
  deposit: string;
  code: string;
  client: string;
}

const LABELS: Record<Lang, Labels> = {
  uz: {
    master: 'Usta',
    service: 'Xizmat',
    where: 'Manzil',
    price: 'Narxi',
    deposit: 'Oldindan toʻlov',
    code: 'Navbat raqami',
    client: 'Mijoz',
  },
  ru: {
    master: 'Мастер',
    service: 'Услуга',
    where: 'Адрес',
    price: 'Стоимость',
    deposit: 'Предоплата',
    code: 'Номер записи',
    client: 'Клиент',
  },
  en: {
    master: 'Master',
    service: 'Service',
    where: 'Where',
    price: 'Price',
    deposit: 'Deposit',
    code: 'Booking code',
    client: 'Client',
  },
};

function details(card: BookingCard, lang: Lang, opts: { client?: boolean } = {}): string {
  const l = LABELS[lang];
  const lines = [
    `<b>${e(when(card, lang))}</b>`,
    `${l.master}: ${e(card.masterName)}`,
    `${l.service}: ${e(card.services.join(', '))}`,
    `${l.where}: ${e(card.branchName)}${card.address ? `, ${e(card.address)}` : ''}`,
    `${l.price}: ${formatMoney(card.price, lang)}`,
  ];
  if (card.deposit) lines.push(`${l.deposit}: ${formatMoney(card.deposit, lang)}`);
  if (opts.client && card.customerName) {
    const phone = card.customerPhone ? `, ${formatPhone(card.customerPhone)}` : '';
    lines.splice(1, 0, `${l.client}: ${e(card.customerName)}${phone}`);
  }
  return lines.join('\n');
}

export interface Messages {
  chooseLanguage: string;
  languageSaved: string;
  welcome(name: string, business: string): string;
  noUpcoming: string;
  upcomingHeader: string;
  upcomingLine(card: BookingCard): string;
  bookingConfirmed(card: BookingCard): string;
  bookingAwaitingPayment(card: BookingCard): string;
  reminder24h(card: BookingCard): string;
  reminder2h(card: BookingCard): string;
  rescheduled(card: BookingCard): string;
  cancelled(card: BookingCard): string;
  cancelledByBusiness(card: BookingCard): string;
  cancelPrompt(card: BookingCard): string;
  cancelTooLate: string;
  lateAck(minutes: number): string;
  reviewRequest(card: BookingCard): string;
  reviewThanks: string;
  adminNewBooking(card: BookingCard): string;
  adminCancelled(card: BookingCard): string;
  adminRescheduled(card: BookingCard): string;
  adminRunningLate(card: BookingCard, minutes: number): string;
  masterDigest(date: string, timeZone: string, items: DigestItem[]): string;
  help: string;
  buttons: {
    book: string;
    myBookings: string;
    late(minutes: number): string;
    cancel: string;
    keep: string;
    confirmCancel: string;
    manage: string;
    rate: string;
    pay: string;
  };
}

function digestLines(items: DigestItem[], timeZone: string): string {
  return items
    .map((i) => {
      const phone = i.customerPhone ? ` · ${formatPhone(i.customerPhone)}` : '';
      const note = i.note ? `\n   <i>${e(i.note)}</i>` : '';
      return `<b>${formatTimeIn(i.startAt, timeZone)}–${formatTimeIn(i.endAt, timeZone)}</b>  ${e(i.services.join(', '))}\n   ${e(i.customerName)}${phone}${note}`;
    })
    .join('\n');
}

function totalMinutes(items: DigestItem[]): number {
  return items.reduce((s, i) => s + Math.round((i.endAt - i.startAt) / 60_000), 0);
}

const uz: Messages = {
  chooseLanguage: 'Tilni tanlang · Выберите язык · Choose a language',
  languageSaved: 'Til saqlandi: oʻzbekcha.',
  welcome: (name, business) =>
    `Assalomu alaykum, ${e(name)}!\n\n<b>${e(business)}</b> navbat botiga xush kelibsiz. Usta va qulay vaqtni tanlang — navbat bir daqiqada band boʻladi, eslatmani oʻzimiz yuboramiz.`,
  noUpcoming: 'Hozircha faol navbatingiz yoʻq. Yangi navbat olish uchun pastdagi tugmani bosing.',
  upcomingHeader: '<b>Navbatlaringiz</b>',
  upcomingLine: (c) => `${e(when(c, 'uz'))}\n${e(c.services.join(', '))} — ${e(c.masterName)}`,
  bookingConfirmed: (c) =>
    `✅ <b>Navbat tasdiqlandi</b>\n\n${details(c, 'uz')}\n\nNavbat raqami: <code>${c.code}</code>`,
  bookingAwaitingPayment: (c) =>
    `Navbat vaqtincha band qilindi. Tasdiqlash uchun ${formatMoney(c.deposit ?? 0, 'uz')} oldindan toʻlang.\n\n${details(c, 'uz')}`,
  reminder24h: (c) =>
    `⏰ <b>Ertaga sizni kutamiz</b>\n\n${details(c, 'uz')}\n\nRejangiz oʻzgargan boʻlsa, oldindan xabar bering.`,
  reminder2h: (c) =>
    `⏰ <b>2 soatdan keyin navbatingiz</b>\n\n${details(c, 'uz')}\n\nKechikayotgan boʻlsangiz, tugmani bosing — usta ogohlantiriladi.`,
  rescheduled: (c) => `🔁 <b>Navbat koʻchirildi</b>\n\n${details(c, 'uz')}`,
  cancelled: (c) => `Navbat bekor qilindi: ${e(when(c, 'uz'))}. Boshqa vaqtga yozilish uchun ilovani oching.`,
  cancelledByBusiness: (c) =>
    `Afsuski, ${e(when(c, 'uz'))} dagi navbatingiz salon tomonidan bekor qilindi. Boshqa qulay vaqtni tanlang.`,
  cancelPrompt: (c) => `Rostdan ham bekor qilasizmi?\n\n${details(c, 'uz')}`,
  cancelTooLate: 'Bekor qilish muddati oʻtib ketdi. Iltimos, salonga qoʻngʻiroq qiling.',
  lateAck: (m) => `Rahmat! Ustaga ${m} daqiqa kechikishingizni yetkazdik.`,
  reviewRequest: (c) =>
    `Tashrifingiz uchun rahmat! ${e(c.masterName)} xizmatini baholang — bu boshqalarga tanlashda yordam beradi.`,
  reviewThanks: 'Fikringiz uchun rahmat!',
  adminNewBooking: (c) =>
    `🆕 <b>Yangi navbat</b> <code>${c.code}</code>\n\n${details(c, 'uz', { client: true })}`,
  adminCancelled: (c) =>
    `❌ <b>Navbat bekor qilindi</b> <code>${c.code}</code>\n\n${details(c, 'uz', { client: true })}`,
  adminRescheduled: (c) =>
    `🔁 <b>Navbat koʻchirildi</b> <code>${c.code}</code>\n\n${details(c, 'uz', { client: true })}`,
  adminRunningLate: (c, m) =>
    `🕓 <b>${e(c.customerName ?? 'Mijoz')}</b> ${m} daqiqaga kechikadi\n${e(when(c, 'uz'))} · ${e(c.masterName)}`,
  masterDigest: (date, tz, items) =>
    items.length === 0
      ? `<b>${formatDateLong(date, 'uz')}</b>\nBugun yozilgan mijoz yoʻq. Boʻsh vaqtlar mijozlar uchun ochiq.`
      : `<b>Bugungi jadval — ${formatDateLong(date, 'uz')}</b>\n\n${digestLines(items, tz)}\n\nJami: ${items.length} ta mijoz, ${formatDuration(totalMinutes(items), 'uz')}`,
  help: '/start — bosh menyu\n/bookings — navbatlarim\n/language — tilni oʻzgartirish',
  buttons: {
    book: 'Navbat olish',
    myBookings: 'Navbatlarim',
    late: (m) => `${m} daqiqaga kechikaman`,
    cancel: 'Bekor qilish',
    keep: 'Yoʻq, qoldirish',
    confirmCancel: 'Ha, bekor qilish',
    manage: 'Navbatni boshqarish',
    rate: 'Baholash',
    pay: 'Toʻlash',
  },
};

const ru: Messages = {
  chooseLanguage: 'Tilni tanlang · Выберите язык · Choose a language',
  languageSaved: 'Язык сохранён: русский.',
  welcome: (name, business) =>
    `Здравствуйте, ${e(name)}!\n\nЭто бот записи <b>${e(business)}</b>. Выберите мастера и удобное время — запись займёт минуту, напоминание пришлём сами.`,
  noUpcoming: 'Активных записей пока нет. Нажмите кнопку ниже, чтобы записаться.',
  upcomingHeader: '<b>Ваши записи</b>',
  upcomingLine: (c) => `${e(when(c, 'ru'))}\n${e(c.services.join(', '))} — ${e(c.masterName)}`,
  bookingConfirmed: (c) =>
    `✅ <b>Запись подтверждена</b>\n\n${details(c, 'ru')}\n\nНомер записи: <code>${c.code}</code>`,
  bookingAwaitingPayment: (c) =>
    `Время забронировано. Чтобы подтвердить запись, внесите предоплату ${formatMoney(c.deposit ?? 0, 'ru')}.\n\n${details(c, 'ru')}`,
  reminder24h: (c) =>
    `⏰ <b>Ждём вас завтра</b>\n\n${details(c, 'ru')}\n\nЕсли планы изменились, предупредите заранее.`,
  reminder2h: (c) =>
    `⏰ <b>Через 2 часа ваша запись</b>\n\n${details(c, 'ru')}\n\nОпаздываете? Нажмите кнопку — мастер будет в курсе.`,
  rescheduled: (c) => `🔁 <b>Запись перенесена</b>\n\n${details(c, 'ru')}`,
  cancelled: (c) =>
    `Запись отменена: ${e(when(c, 'ru'))}. Чтобы записаться на другое время, откройте приложение.`,
  cancelledByBusiness: (c) =>
    `К сожалению, салон отменил вашу запись на ${e(when(c, 'ru'))}. Выберите другое удобное время.`,
  cancelPrompt: (c) => `Точно отменить запись?\n\n${details(c, 'ru')}`,
  cancelTooLate: 'Срок отмены уже прошёл. Пожалуйста, позвоните в салон.',
  lateAck: (m) => `Спасибо! Передали мастеру, что вы опоздаете на ${m} мин.`,
  reviewRequest: (c) =>
    `Спасибо за визит! Оцените работу мастера ${e(c.masterName)} — это поможет другим с выбором.`,
  reviewThanks: 'Спасибо за отзыв!',
  adminNewBooking: (c) =>
    `🆕 <b>Новая запись</b> <code>${c.code}</code>\n\n${details(c, 'ru', { client: true })}`,
  adminCancelled: (c) =>
    `❌ <b>Запись отменена</b> <code>${c.code}</code>\n\n${details(c, 'ru', { client: true })}`,
  adminRescheduled: (c) =>
    `🔁 <b>Запись перенесена</b> <code>${c.code}</code>\n\n${details(c, 'ru', { client: true })}`,
  adminRunningLate: (c, m) =>
    `🕓 <b>${e(c.customerName ?? 'Клиент')}</b> опоздает на ${m} мин\n${e(when(c, 'ru'))} · ${e(c.masterName)}`,
  masterDigest: (date, tz, items) =>
    items.length === 0
      ? `<b>${formatDateLong(date, 'ru')}</b>\nНа сегодня записей нет. Свободное время открыто для клиентов.`
      : `<b>Расписание на ${formatDateLong(date, 'ru')}</b>\n\n${digestLines(items, tz)}\n\nВсего: ${items.length} клиент(ов), ${formatDuration(totalMinutes(items), 'ru')}`,
  help: '/start — главное меню\n/bookings — мои записи\n/language — сменить язык',
  buttons: {
    book: 'Записаться',
    myBookings: 'Мои записи',
    late: (m) => `Опоздаю на ${m} мин`,
    cancel: 'Отменить',
    keep: 'Нет, оставить',
    confirmCancel: 'Да, отменить',
    manage: 'Управлять записью',
    rate: 'Оценить',
    pay: 'Оплатить',
  },
};

const en: Messages = {
  chooseLanguage: 'Tilni tanlang · Выберите язык · Choose a language',
  languageSaved: 'Language saved: English.',
  welcome: (name, business) =>
    `Hi, ${e(name)}!\n\nThis is the booking bot of <b>${e(business)}</b>. Pick a master and a time that suits you — booking takes a minute, and we will remind you before the visit.`,
  noUpcoming: 'You have no upcoming bookings. Tap the button below to book.',
  upcomingHeader: '<b>Your bookings</b>',
  upcomingLine: (c) => `${e(when(c, 'en'))}\n${e(c.services.join(', '))} — ${e(c.masterName)}`,
  bookingConfirmed: (c) =>
    `✅ <b>Booking confirmed</b>\n\n${details(c, 'en')}\n\nBooking code: <code>${c.code}</code>`,
  bookingAwaitingPayment: (c) =>
    `Your time is on hold. Pay the ${formatMoney(c.deposit ?? 0, 'en')} deposit to confirm it.\n\n${details(c, 'en')}`,
  reminder24h: (c) =>
    `⏰ <b>See you tomorrow</b>\n\n${details(c, 'en')}\n\nIf your plans change, please let us know in advance.`,
  reminder2h: (c) =>
    `⏰ <b>Your visit is in 2 hours</b>\n\n${details(c, 'en')}\n\nRunning late? Tap a button and your master will know.`,
  rescheduled: (c) => `🔁 <b>Booking moved</b>\n\n${details(c, 'en')}`,
  cancelled: (c) => `Booking cancelled: ${e(when(c, 'en'))}. Open the app to pick another time.`,
  cancelledByBusiness: (c) =>
    `Sorry, the salon had to cancel your booking on ${e(when(c, 'en'))}. Please pick another time.`,
  cancelPrompt: (c) => `Cancel this booking?\n\n${details(c, 'en')}`,
  cancelTooLate: 'It is too late to cancel online. Please call the salon.',
  lateAck: (m) => `Thanks! We told your master you will be ${m} minutes late.`,
  reviewRequest: (c) =>
    `Thanks for visiting! How was your time with ${e(c.masterName)}? Your rating helps others choose.`,
  reviewThanks: 'Thanks for your feedback!',
  adminNewBooking: (c) =>
    `🆕 <b>New booking</b> <code>${c.code}</code>\n\n${details(c, 'en', { client: true })}`,
  adminCancelled: (c) =>
    `❌ <b>Booking cancelled</b> <code>${c.code}</code>\n\n${details(c, 'en', { client: true })}`,
  adminRescheduled: (c) =>
    `🔁 <b>Booking moved</b> <code>${c.code}</code>\n\n${details(c, 'en', { client: true })}`,
  adminRunningLate: (c, m) =>
    `🕓 <b>${e(c.customerName ?? 'Client')}</b> is running ${m} min late\n${e(when(c, 'en'))} · ${e(c.masterName)}`,
  masterDigest: (date, tz, items) =>
    items.length === 0
      ? `<b>${formatDateLong(date, 'en')}</b>\nNo bookings today yet. Your free time is open for clients.`
      : `<b>Your day — ${formatDateLong(date, 'en')}</b>\n\n${digestLines(items, tz)}\n\nTotal: ${items.length} client(s), ${formatDuration(totalMinutes(items), 'en')}`,
  help: '/start — main menu\n/bookings — my bookings\n/language — change language',
  buttons: {
    book: 'Book a visit',
    myBookings: 'My bookings',
    late: (m) => `Running ${m} min late`,
    cancel: 'Cancel',
    keep: 'No, keep it',
    confirmCancel: 'Yes, cancel',
    manage: 'Manage booking',
    rate: 'Rate visit',
    pay: 'Pay',
  },
};

const ALL: Record<Lang, Messages> = { uz, ru, en };

export function messagesFor(lang: Lang): Messages {
  return ALL[lang];
}

/** Notification kinds produced by the booking service and rendered by the bot. */
export const NOTIFICATION_KINDS = [
  'booking_confirmed',
  'booking_awaiting_payment',
  'reminder_24h',
  'reminder_2h',
  'booking_rescheduled',
  'booking_cancelled',
  'booking_cancelled_by_business',
  'review_request',
  'admin_new_booking',
  'admin_cancelled',
  'admin_rescheduled',
  'admin_running_late',
  'master_digest',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationPayload =
  | {
      kind: Exclude<NotificationKind, 'admin_running_late' | 'master_digest'>;
      card: BookingCard;
      bookingId: string;
    }
  | { kind: 'admin_running_late'; card: BookingCard; bookingId: string; minutes: number }
  | { kind: 'master_digest'; date: string; timeZone: string; items: DigestItem[] };

export type ButtonSpec =
  | { text: string; callback: string }
  | { text: string; webApp: string }
  | { text: string; url: string };

export interface RenderedMessage {
  text: string;
  buttons: ButtonSpec[][];
}

/**
 * Turns a queued notification into text + inline keyboard. `appUrl` is the Mini App URL
 * (buttons that open a specific booking use `startapp`-style query params).
 */
export function renderNotification(
  payload: NotificationPayload,
  lang: Lang,
  appUrl: string,
): RenderedMessage {
  const m = messagesFor(lang);
  if (payload.kind === 'master_digest') {
    return { text: m.masterDigest(payload.date, payload.timeZone, payload.items), buttons: [] };
  }
  const { card, bookingId } = payload;
  const manage = { text: m.buttons.manage, webApp: `${appUrl}#/booking/${bookingId}` };
  switch (payload.kind) {
    case 'booking_confirmed':
      return { text: m.bookingConfirmed(card), buttons: [[manage]] };
    case 'booking_awaiting_payment':
      return {
        text: m.bookingAwaitingPayment(card),
        buttons: [[{ text: m.buttons.pay, webApp: manage.webApp }]],
      };
    case 'reminder_24h':
      return {
        text: m.reminder24h(card),
        buttons: [[manage], [{ text: m.buttons.cancel, callback: `cancel:${bookingId}` }]],
      };
    case 'reminder_2h':
      return {
        text: m.reminder2h(card),
        buttons: [
          [
            { text: m.buttons.late(10), callback: `late:${bookingId}:10` },
            { text: m.buttons.late(20), callback: `late:${bookingId}:20` },
          ],
          [{ text: m.buttons.cancel, callback: `cancel:${bookingId}` }],
        ],
      };
    case 'booking_rescheduled':
      return { text: m.rescheduled(card), buttons: [[manage]] };
    case 'booking_cancelled':
      return { text: m.cancelled(card), buttons: [[{ text: m.buttons.book, webApp: appUrl }]] };
    case 'booking_cancelled_by_business':
      return { text: m.cancelledByBusiness(card), buttons: [[{ text: m.buttons.book, webApp: appUrl }]] };
    case 'review_request':
      return {
        text: m.reviewRequest(card),
        buttons: [[1, 2, 3, 4, 5].map((n) => ({ text: `${n} ★`, callback: `rate:${bookingId}:${n}` }))],
      };
    case 'admin_new_booking':
      return { text: m.adminNewBooking(card), buttons: [] };
    case 'admin_cancelled':
      return { text: m.adminCancelled(card), buttons: [] };
    case 'admin_rescheduled':
      return { text: m.adminRescheduled(card), buttons: [] };
    case 'admin_running_late':
      return { text: m.adminRunningLate(card, payload.minutes), buttons: [] };
  }
}
