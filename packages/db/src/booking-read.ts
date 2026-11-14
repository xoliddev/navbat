import { type BookingCard, type Lang, pickText } from '@navbat/core';
import { type Db, ms } from './context.js';
import type { BookingDTO } from './dto.js';

/** Loads full booking views for the given ids, in the order of `start_at`. */
export async function loadBookings(db: Db, ids: string[]): Promise<BookingDTO[]> {
  if (ids.length === 0) return [];
  const [rows, items, reviews, payments] = await Promise.all([
    db
      .selectFrom('bookings as b')
      .innerJoin('staff as s', 's.id', 'b.staff_id')
      .innerJoin('customers as c', 'c.id', 'b.customer_id')
      .leftJoin('branches as br', 'br.id', 'b.branch_id')
      .selectAll('b')
      .select([
        's.name as staff_name',
        's.color as staff_color',
        'c.name as customer_name',
        'c.phone as customer_phone',
        'c.telegram_user_id as customer_tg',
        'br.name as branch_name',
        'br.address as branch_address',
      ])
      .where('b.id', 'in', ids)
      .orderBy('b.start_at')
      .execute(),
    db.selectFrom('booking_items').selectAll().where('booking_id', 'in', ids).orderBy('position').execute(),
    db
      .selectFrom('reviews')
      .select(['booking_id', 'rating', 'comment'])
      .where('booking_id', 'in', ids)
      .execute(),
    db
      .selectFrom('payments')
      .select(['booking_id', 'pay_url'])
      .where('booking_id', 'in', ids)
      .where('status', '=', 'pending')
      .execute(),
  ]);
  return rows.map((r) => {
    const review = reviews.find((x) => x.booking_id === r.id);
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      startAt: ms(r.start_at),
      endAt: ms(r.end_at),
      occupiedStart: ms(r.occupied_start),
      occupiedEnd: ms(r.occupied_end),
      staffId: r.staff_id,
      staffName: r.staff_name,
      staffColor: r.staff_color,
      branchId: r.branch_id,
      branchName: r.branch_name,
      branchAddress: r.branch_address,
      customer: {
        id: r.customer_id,
        name: r.customer_name,
        phone: r.customer_phone,
        telegramUserId: r.customer_tg,
      },
      items: items
        .filter((i) => i.booking_id === r.id)
        .map((i) => ({
          serviceId: i.service_id,
          name: i.name,
          startAt: ms(i.start_at),
          endAt: ms(i.end_at),
          price: i.price,
        })),
      totalPrice: r.total_price,
      depositAmount: r.deposit_amount,
      paymentStatus: r.payment_status,
      payUrl: payments.find((p) => p.booking_id === r.id)?.pay_url ?? null,
      source: r.source,
      runningLateMin: r.running_late_min,
      notes: r.notes,
      cancelReason: r.cancel_reason,
      createdAt: ms(r.created_at),
      review: review ? { rating: review.rating, comment: review.comment } : null,
    };
  });
}

export async function loadBooking(db: Db, id: string): Promise<BookingDTO | undefined> {
  return (await loadBookings(db, [id]))[0];
}

export function toCard(b: BookingDTO, lang: Lang, timeZone: string): BookingCard {
  return {
    code: b.code,
    services: b.items.map((i) => pickText(i.name, lang)),
    masterName: b.staffName,
    branchName: b.branchName ?? '',
    address: b.branchAddress,
    startAt: b.startAt,
    endAt: b.endAt,
    timeZone,
    price: b.totalPrice,
    deposit: b.depositAmount || undefined,
    customerName: b.customer.name,
    customerPhone: b.customer.phone,
  };
}
