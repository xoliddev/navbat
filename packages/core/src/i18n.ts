import { isoWeekday, type LocalDate, parseLocalDate } from './time.js';

export const LANGS = ['uz', 'ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** Text stored per language (service names, descriptions). Missing languages fall back. */
export type LocalizedText = Partial<Record<Lang, string>>;

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** Maps a Telegram `language_code` to a supported language (Uzbek by default). */
export function langFromTelegram(code: string | undefined | null): Lang {
  const base = (code ?? '').toLowerCase().split('-')[0];
  if (base === 'ru' || base === 'kk' || base === 'ky' || base === 'tg' || base === 'be' || base === 'uk')
    return 'ru';
  if (base === 'en') return 'en';
  return 'uz';
}

export function pickText(text: LocalizedText | null | undefined, lang: Lang): string {
  if (!text) return '';
  return text[lang] ?? text.uz ?? text.ru ?? text.en ?? '';
}

const MONTHS: Record<Lang, string[]> = {
  uz: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

const MONTHS_NOMINATIVE: Record<Lang, string[]> = {
  uz: [
    'Yanvar',
    'Fevral',
    'Mart',
    'Aprel',
    'May',
    'Iyun',
    'Iyul',
    'Avgust',
    'Sentabr',
    'Oktabr',
    'Noyabr',
    'Dekabr',
  ],
  ru: [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ],
  en: MONTHS.en,
};

const WEEKDAYS: Record<Lang, string[]> = {
  uz: ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba'],
  ru: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};

export function weekdayName(date: LocalDate, lang: Lang): string {
  return WEEKDAYS[lang][isoWeekday(date) - 1]!;
}

export function weekdayShort(isoDay: number, lang: Lang): string {
  return WEEKDAYS_SHORT[lang][isoDay - 1]!;
}

export function monthName(month: number, lang: Lang): string {
  return MONTHS_NOMINATIVE[lang][month - 1]!;
}

/** "14-noyabr" / "14 ноября" / "14 November" */
export function formatDayMonth(date: LocalDate, lang: Lang): string {
  const { month, day } = parseLocalDate(date);
  const m = MONTHS[lang][month - 1]!;
  return lang === 'uz' ? `${day}-${m}` : `${day} ${m}`;
}

/** "14-noyabr, juma" / "14 ноября, пятница" / "Friday, 14 November" */
export function formatDateLong(date: LocalDate, lang: Lang): string {
  const wd = weekdayName(date, lang);
  return lang === 'en' ? `${wd}, ${formatDayMonth(date, lang)}` : `${formatDayMonth(date, lang)}, ${wd}`;
}

const CURRENCY: Record<Lang, string> = { uz: 'soʻm', ru: 'сум', en: 'UZS' };

export function formatMoney(amount: number, lang: Lang): string {
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
  return `${grouped} ${CURRENCY[lang]}`;
}

export function formatDuration(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const units = { uz: ['soat', 'daq'], ru: ['ч', 'мин'], en: ['h', 'min'] }[lang];
  if (h && m) return `${h} ${units[0]} ${m} ${units[1]}`;
  if (h) return `${h} ${units[0]}`;
  return `${m} ${units[1]}`;
}
