import { formatDateLong, formatMoney, pickText, utcToZoned } from '@navbat/core';
import { motion, useReducedMotion } from 'motion/react';
import type { BookingDTO } from '../backend/types';
import { useI18n } from '../i18n';
import { useTime } from '../lib';

/**
 * The queue ticket — Navbat's signature object. On first show it is "printed": it slides out
 * of a slot like a ticket from a queue machine, then the stub settles.
 */
export function Ticket({ booking, tz, business, print }: { booking: BookingDTO; tz: string; business: string; print?: boolean }) {
  const { t, lang } = useI18n();
  const time = useTime(tz);
  const reduce = useReducedMotion();
  const date = utcToZoned(booking.startAt, tz).date;
  const animate = print && !reduce;
  return (
    <div className={`ticket-wrap ${print ? 'printing' : ''}`}>
      {print && <div className="ticket-slot" aria-hidden />}
      <div className="ticket-clip">
        <motion.article
          className={`ticket status-${booking.status}`}
          data-testid="ticket"
          initial={animate ? { y: '-104%' } : false}
          animate={{ y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 18, mass: 1.1, delay: 0.15 }}
        >
          <header className="ticket-top">
            <span className="ticket-biz">{business}</span>
            <span className="ticket-label">{booking.status === 'pending' ? t.ticketPending : t.ticketTitle}</span>
            <span className="ticket-code num" data-testid="ticket-code">
              {booking.code}
            </span>
          </header>
          <div className="ticket-perf" aria-hidden />
          <div className="ticket-body">
            <div className="ticket-when">
              <span className="ticket-time num">
                {time.hm(booking.startAt)}
                <small>–{time.hm(booking.endAt)}</small>
              </span>
              <span className="ticket-date">{formatDateLong(date, lang)}</span>
            </div>
            <dl className="ticket-facts">
              <div>
                <dt>{t.stepMaster}</dt>
                <dd>{booking.staffName}</dd>
              </div>
              <div>
                <dt>{t.stepService}</dt>
                <dd>{booking.items.map((i) => pickText(i.name, lang)).join(' + ')}</dd>
              </div>
              {booking.branchName && (
                <div>
                  <dt>{t.where}</dt>
                  <dd>
                    {booking.branchName}
                    {booking.branchAddress ? `, ${booking.branchAddress}` : ''}
                  </dd>
                </div>
              )}
              <div>
                <dt>{t.total}</dt>
                <dd className="num">{formatMoney(booking.totalPrice, lang)}</dd>
              </div>
            </dl>
          </div>
        </motion.article>
      </div>
    </div>
  );
}
