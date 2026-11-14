import type { BookingStatus, Role } from './booking-state.js';
import { DomainError } from './errors.js';

export interface BusinessSettings {
  minNoticeMin: number;
  horizonDays: number;
  slotStepMin: number;
  /** Customers may cancel or reschedule until this many minutes before the visit. */
  cancelWindowMin: number;
  /** 0 = no prepayment. */
  depositPercent: number;
  paymentProvider: 'sandbox' | 'payme' | 'click' | 'stars' | 'none';
  /** Local hour when each master receives the day's schedule. */
  digestHour: number;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  minNoticeMin: 60,
  horizonDays: 30,
  slotStepMin: 15,
  cancelWindowMin: 120,
  depositPercent: 0,
  paymentProvider: 'none',
  digestHour: 8,
};

export function withDefaults(partial: Partial<BusinessSettings> | null | undefined): BusinessSettings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}

/** Deposit rounded up to 1 000 so'm; never above the total. */
export function depositAmount(total: number, percent: number): number {
  if (percent <= 0 || total <= 0) return 0;
  return Math.min(total, Math.ceil((total * percent) / 100 / 1000) * 1000);
}

/** Normalises Uzbek phone numbers to +998XXXXXXXXX. Accepts spaces, dashes, brackets, 8/998 prefixes. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');
  let national: string;
  if (/^998\d{9}$/.test(bare)) national = bare.slice(3);
  else if (/^\d{9}$/.test(bare)) national = bare;
  else if (/^8\d{9}$/.test(bare)) national = bare.slice(1);
  else return null;
  return `+998${national}`;
}

export function formatPhone(e164: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/** Short human-friendly code shown on the ticket, e.g. "N-4K7P". No 0/O/1/I to avoid confusion. */
export function bookingCode(random: () => number = Math.random): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `N-${s}`;
}

export interface ReviewCheck {
  status: BookingStatus;
  endAt: number;
  hasReview: boolean;
}

export function canReview(b: ReviewCheck, now: number): boolean {
  return b.status === 'completed' && b.endAt <= now && !b.hasReview;
}

export function assertRating(rating: number): void {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new DomainError('VALIDATION', 'Rating must be an integer from 1 to 5');
  }
}

export type Permission =
  | 'calendar.all'
  | 'calendar.own'
  | 'booking.manage'
  | 'catalog.manage'
  | 'staff.manage'
  | 'clients.view'
  | 'analytics.view'
  | 'export'
  | 'settings.manage';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'calendar.all',
    'calendar.own',
    'booking.manage',
    'catalog.manage',
    'staff.manage',
    'clients.view',
    'analytics.view',
    'export',
    'settings.manage',
  ],
  admin: [
    'calendar.all',
    'calendar.own',
    'booking.manage',
    'catalog.manage',
    'clients.view',
    'analytics.view',
    'export',
  ],
  master: ['calendar.own'],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new DomainError('FORBIDDEN', `Role ${role} lacks ${permission}`);
}
