/**
 * Booking lifecycle as an explicit state machine.
 *
 *   pending ──pay/confirm──▶ confirmed ──complete──▶ completed
 *      │                        │  └──no_show──▶ no_show
 *      └──cancel/expire──▶ cancelled ◀──cancel──┘
 *
 * `pending` only exists while a deposit is awaited. `reschedule` keeps the state.
 */
import { DomainError } from './errors.js';
import { MS } from './time.js';

export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ACTIVE_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed'];

export type Role = 'owner' | 'admin' | 'master';
export type Actor =
  | { kind: 'customer'; customerId: string }
  | { kind: 'staff'; staffId: string; role: Role }
  | { kind: 'system' };

export type BookingEvent = 'confirm' | 'cancel' | 'expire' | 'complete' | 'no_show' | 'reschedule';

export interface BookingSnapshot {
  status: BookingStatus;
  customerId: string;
  staffId: string;
  startAt: number;
  endAt: number;
}

export interface TransitionContext {
  actor: Actor;
  now: number;
  /** Customers may cancel/reschedule only until this many minutes before the start. */
  cancelWindowMin: number;
}

const TABLE: Record<BookingEvent, { from: readonly BookingStatus[]; to: BookingStatus | 'same' }> = {
  confirm: { from: ['pending'], to: 'confirmed' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled' },
  expire: { from: ['pending'], to: 'cancelled' },
  complete: { from: ['confirmed'], to: 'completed' },
  no_show: { from: ['confirmed'], to: 'no_show' },
  reschedule: { from: ['pending', 'confirmed'], to: 'same' },
};

/** Events a customer may trigger themselves. */
const CUSTOMER_EVENTS: readonly BookingEvent[] = ['cancel', 'reschedule'];
/** Events a master may trigger on their own bookings. */
const MASTER_EVENTS: readonly BookingEvent[] = ['confirm', 'complete', 'no_show', 'cancel', 'reschedule'];

export function canTransition(status: BookingStatus, event: BookingEvent): boolean {
  return TABLE[event].from.includes(status);
}

export function cancelDeadline(startAt: number, cancelWindowMin: number): number {
  return startAt - cancelWindowMin * MS.MINUTE;
}

/** Applies an event and returns the next status, or throws a DomainError explaining why not. */
export function transition(
  booking: BookingSnapshot,
  event: BookingEvent,
  ctx: TransitionContext,
): BookingStatus {
  const rule = TABLE[event];
  if (!rule.from.includes(booking.status)) {
    throw new DomainError('INVALID_TRANSITION', `Cannot ${event} a ${booking.status} booking`, {
      from: booking.status,
      event,
    });
  }
  const { actor } = ctx;
  if (actor.kind === 'customer') {
    if (actor.customerId !== booking.customerId) throw new DomainError('FORBIDDEN', 'Not your booking');
    if (!CUSTOMER_EVENTS.includes(event)) throw new DomainError('FORBIDDEN', `Customers cannot ${event}`);
    if (ctx.now > cancelDeadline(booking.startAt, ctx.cancelWindowMin)) {
      throw new DomainError('CANCEL_WINDOW_PASSED', 'Too late to change this booking', {
        deadline: cancelDeadline(booking.startAt, ctx.cancelWindowMin),
      });
    }
  } else if (actor.kind === 'staff' && actor.role === 'master') {
    if (actor.staffId !== booking.staffId) throw new DomainError('FORBIDDEN', 'Not your client');
    if (!MASTER_EVENTS.includes(event)) throw new DomainError('FORBIDDEN', `Masters cannot ${event}`);
  }
  if ((event === 'complete' || event === 'no_show') && ctx.now < booking.startAt) {
    throw new DomainError('INVALID_TRANSITION', 'The visit has not started yet');
  }
  return rule.to === 'same' ? booking.status : rule.to;
}

/** Actions to show for a booking in the UI. */
export function availableEvents(booking: BookingSnapshot, ctx: TransitionContext): BookingEvent[] {
  return (Object.keys(TABLE) as BookingEvent[]).filter((e) => {
    if (e === 'expire') return false;
    try {
      transition(booking, e, ctx);
      return true;
    } catch {
      return false;
    }
  });
}
