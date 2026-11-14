import { describe, expect, it } from 'vitest';
import {
  availableEvents,
  type BookingSnapshot,
  bookingCode,
  can,
  canReview,
  canTransition,
  DomainError,
  depositAmount,
  formatPhone,
  normalizePhone,
  type TransitionContext,
  transition,
} from '../src/index.js';

const HOUR = 3_600_000;
const start = Date.UTC(2026, 10, 16, 10);
const booking: BookingSnapshot = {
  status: 'confirmed',
  customerId: 'c1',
  staffId: 's1',
  startAt: start,
  endAt: start + HOUR,
};
const customer = (now: number): TransitionContext => ({
  actor: { kind: 'customer', customerId: 'c1' },
  now,
  cancelWindowMin: 120,
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return undefined;
}

describe('booking state machine', () => {
  it('follows the transition table', () => {
    expect(canTransition('pending', 'confirm')).toBe(true);
    expect(canTransition('confirmed', 'confirm')).toBe(false);
    expect(canTransition('cancelled', 'cancel')).toBe(false);
    expect(canTransition('completed', 'reschedule')).toBe(false);
  });

  it('lets customers cancel inside the policy window only', () => {
    expect(transition(booking, 'cancel', customer(start - 3 * HOUR))).toBe('cancelled');
    expect(transition(booking, 'cancel', customer(start - 2 * HOUR))).toBe('cancelled'); // exactly on the deadline
    expect(code(() => transition(booking, 'cancel', customer(start - HOUR)))).toBe('CANCEL_WINDOW_PASSED');
  });

  it('keeps the status on reschedule and forbids it for other customers', () => {
    expect(transition(booking, 'reschedule', customer(start - 5 * HOUR))).toBe('confirmed');
    const other: TransitionContext = { ...customer(0), actor: { kind: 'customer', customerId: 'c2' } };
    expect(code(() => transition(booking, 'reschedule', other))).toBe('FORBIDDEN');
  });

  it('does not let customers complete or mark no-show', () => {
    expect(code(() => transition(booking, 'complete', customer(start + 2 * HOUR)))).toBe('FORBIDDEN');
  });

  it('masters manage only their own bookings, admins ignore the cancel window', () => {
    const master = (staffId: string): TransitionContext => ({
      actor: { kind: 'staff', staffId, role: 'master' },
      now: start + 2 * HOUR,
      cancelWindowMin: 120,
    });
    expect(transition(booking, 'complete', master('s1'))).toBe('completed');
    expect(code(() => transition(booking, 'complete', master('s2')))).toBe('FORBIDDEN');
    const admin: TransitionContext = {
      actor: { kind: 'staff', staffId: 'x', role: 'admin' },
      now: start - 10 * 60_000,
      cancelWindowMin: 120,
    };
    expect(transition(booking, 'cancel', admin)).toBe('cancelled');
  });

  it('refuses completing a visit that has not started', () => {
    const admin: TransitionContext = {
      actor: { kind: 'staff', staffId: 'x', role: 'owner' },
      now: start - HOUR,
      cancelWindowMin: 0,
    };
    expect(code(() => transition(booking, 'no_show', admin))).toBe('INVALID_TRANSITION');
  });

  it('lists the actions available to an actor', () => {
    expect(availableEvents(booking, customer(start - 5 * HOUR)).sort()).toEqual(['cancel', 'reschedule']);
    expect(availableEvents(booking, customer(start - HOUR))).toEqual([]);
    expect(availableEvents({ ...booking, status: 'cancelled' }, customer(0))).toEqual([]);
  });

  it('throws DomainError with an HTTP status', () => {
    try {
      transition({ ...booking, status: 'completed' }, 'cancel', customer(0));
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).status).toBe(409);
    }
  });
});

describe('business rules', () => {
  it("rounds deposits up to 1 000 so'm and caps them at the total", () => {
    expect(depositAmount(85_000, 30)).toBe(26_000);
    expect(depositAmount(85_000, 0)).toBe(0);
    expect(depositAmount(500, 100)).toBe(500);
  });

  it('normalises Uzbek phone numbers', () => {
    expect(normalizePhone('+998 90 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(normalizePhone('(90) 123 45 67')).toBe('+998901234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
  });

  it('generates readable booking codes', () => {
    let i = 0;
    const seq = [0, 0.5, 0.99, 0.25];
    expect(bookingCode(() => seq[i++ % 4]!)).toMatch(/^N-[2-9A-Z]{4}$/);
    for (let k = 0; k < 50; k++) expect(bookingCode()).toMatch(/^N-[2-9A-HJ-NP-Z]{4}$/);
  });

  it('allows a review only after a completed visit, once', () => {
    expect(canReview({ status: 'completed', endAt: 10, hasReview: false }, 20)).toBe(true);
    expect(canReview({ status: 'completed', endAt: 10, hasReview: true }, 20)).toBe(false);
    expect(canReview({ status: 'confirmed', endAt: 10, hasReview: false }, 20)).toBe(false);
    expect(canReview({ status: 'no_show', endAt: 10, hasReview: false }, 20)).toBe(false);
  });

  it('grants permissions by role', () => {
    expect(can('owner', 'staff.manage')).toBe(true);
    expect(can('admin', 'staff.manage')).toBe(false);
    expect(can('admin', 'analytics.view')).toBe(true);
    expect(can('master', 'calendar.all')).toBe(false);
    expect(can('master', 'calendar.own')).toBe(true);
  });
});
