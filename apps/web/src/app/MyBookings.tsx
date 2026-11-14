import { cancelDeadline, formatDateLong, formatMoney, pickText, utcToZoned } from '@navbat/core';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { BookingDTO, CatalogDTO, SlotDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Sheet, Stars, useAsync, useBackend, useTime, useToast } from '../lib';
import { tg, useBackButton, useMainButton } from '../telegram';
import { PaymentSheet } from './PaymentSheet';
import { DateTimePicker } from './pickers';
import { Ticket } from './Ticket';

const ACTIVE = new Set(['pending', 'confirmed']);

export function BookingList({
  catalog,
  onOpen,
  onBook,
  onBack,
}: {
  catalog: CatalogDTO;
  onOpen: (id: string) => void;
  onBook: () => void;
  onBack: () => void;
}) {
  const backend = useBackend();
  const { t, lang } = useI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const list = useAsync(() => backend.myBookings(), []);
  useBackButton(onBack);
  useMainButton({ text: t.bookNow, onClick: onBook });
  const now = backend.now();
  const upcoming = (list.data ?? [])
    .filter((b) => ACTIVE.has(b.status) && b.endAt > now)
    .sort((a, b) => a.startAt - b.startAt);
  const past = (list.data ?? []).filter((b) => !upcoming.includes(b));

  const row = (b: BookingDTO, i: number) => (
    <motion.li
      key={b.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 6) * 0.03 }}
    >
      <button
        type="button"
        className={`bk-row status-${b.status}`}
        data-testid="my-booking"
        onClick={() => onOpen(b.id)}
      >
        <span className="bk-date">
          <span className="num">{Number(utcToZoned(b.startAt, tz).date.slice(8))}</span>
          <small>
            {
              formatDateLong(utcToZoned(b.startAt, tz).date, lang)
                .replace(/^\d+[- ]?/, '')
                .split(',')[0]
            }
          </small>
        </span>
        <span className="bk-body">
          <span className="bk-time num">
            {time.hm(b.startAt)}–{time.hm(b.endAt)}
          </span>
          <span className="bk-what">{b.items.map((x) => pickText(x.name, lang)).join(' + ')}</span>
          <span className="bk-who">{b.staffName}</span>
        </span>
        <span
          className={`chip ${b.status === 'confirmed' || b.status === 'completed' ? 'ok' : b.status === 'pending' ? 'warn' : 'bad'}`}
        >
          {t.status[b.status]}
        </span>
      </button>
    </motion.li>
  );

  return (
    <div className="step">
      <h1 className="step-title">{t.myBookings}</h1>
      {list.loading && !list.data ? (
        <div className="list-skeleton">
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : (
        <>
          <h2 className="group-title">{t.upcoming}</h2>
          {upcoming.length ? (
            <ul className="bk-list">{upcoming.map(row)}</ul>
          ) : (
            <div className="empty">
              <p>
                <b>{t.nothingUpcoming}</b>
              </p>
              <p className="muted">{t.nothingUpcomingHint}</p>
            </div>
          )}
          {past.length > 0 && (
            <>
              <h2 className="group-title">{t.past}</h2>
              <ul className="bk-list past">{past.map(row)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function BookingDetail({
  catalog,
  id,
  onBack,
}: {
  catalog: CatalogDTO;
  id: string;
  onBack: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t, lang } = useI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const res = useAsync(() => backend.booking(id), [id]);
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [pick, setPick] = useState<{ date: string | null; slot: SlotDTO | null }>({ date: null, slot: null });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const b = res.data;
  const now = backend.now();
  const deadline = b ? cancelDeadline(b.startAt, catalog.business.settings.cancelWindowMin) : 0;
  const changeable = !!b && ACTIVE.has(b.status) && now <= deadline;
  const canLate = !!b && b.status === 'confirmed' && now >= b.startAt - 3 * 3_600_000 && now <= b.endAt;
  const canRate = !!b && b.status === 'completed' && !b.review;

  useBackButton(mode === 'reschedule' ? () => setMode('view') : onBack);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      tg.haptic('success');
      toast(done);
      res.reload();
    } catch (e) {
      tg.haptic('error');
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  useMainButton({
    text: mode === 'reschedule' ? t.moveHere : canRate ? t.sendReview : t.reschedule,
    visible: mode === 'reschedule' ? !!pick.slot : canRate ? rating > 0 : changeable,
    progress: busy,
    onClick: () => {
      if (!b) return;
      if (mode === 'reschedule' && pick.slot) {
        const start = pick.slot.start;
        void act(async () => {
          await backend.reschedule(b.id, start);
          setMode('view');
          setPick({ date: null, slot: null });
        }, t.moved);
      } else if (canRate) {
        void act(() => backend.review(b.id, rating, comment.trim() || undefined), t.thanksReview);
      } else setMode('reschedule');
    },
  });

  if (!b)
    return (
      <div className="step">
        {res.error ? (
          <p className="empty-line">{errorText(t, res.error)}</p>
        ) : (
          <div className="spinner center" />
        )}
      </div>
    );

  if (mode === 'reschedule') {
    return (
      <DateTimePicker
        catalog={catalog}
        serviceIds={b.items.map((i) => i.serviceId)}
        staffId={b.staffId}
        value={pick}
        onChange={setPick}
        title={t.newTime}
      />
    );
  }

  return (
    <div className="step">
      <Ticket booking={b} tz={tz} business={catalog.business.name} />
      <div className="detail-status">
        <span
          className={`chip ${b.status === 'confirmed' || b.status === 'completed' ? 'ok' : b.status === 'pending' ? 'warn' : 'bad'}`}
        >
          {t.status[b.status]}
        </span>
        {b.runningLateMin ? <span className="chip warn">{t.lateSent(b.runningLateMin)}</span> : null}
      </div>
      {ACTIVE.has(b.status) && (
        <p className="fine">
          {changeable
            ? t.cancelUntil(`${formatDateLong(utcToZoned(deadline, tz).date, lang)}, ${time.hm(deadline)}`)
            : t.cancelClosed}
        </p>
      )}
      {b.status === 'pending' && b.payUrl && (
        <button type="button" className="btn block" onClick={() => setPayOpen(true)}>
          {t.payNow} {formatMoney(b.depositAmount, lang)}
        </button>
      )}
      {canLate && (
        <div className="late">
          <span>{t.runningLate}</span>
          {[10, 20].map((m) => (
            <button
              key={m}
              type="button"
              className="btn quiet small"
              disabled={busy}
              onClick={() => act(() => backend.late(b.id, m), t.lateSent(m))}
            >
              +{m} {t.minutes}
            </button>
          ))}
        </div>
      )}
      {canRate && (
        <section className="rate">
          <h2 className="group-title">{t.rateVisit}</h2>
          <div className="rate-stars" role="radiogroup" aria-label={t.rateVisit}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n}`}
                data-testid={`rate-${n}`}
                className={n <= rating ? 'on' : ''}
                onClick={() => {
                  tg.haptic('select');
                  setRating(n);
                }}
              >
                ★
              </button>
            ))}
          </div>
          <label className="field">
            <span className="sr-only">{t.ratePlaceholder}</span>
            <textarea
              placeholder={t.ratePlaceholder}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </label>
        </section>
      )}
      {b.review && (
        <section className="rate done">
          <h2 className="group-title">{t.yourReview}</h2>
          <Stars value={b.review.rating} size={20} />
          {b.review.comment && <p>{b.review.comment}</p>}
        </section>
      )}
      {changeable && (
        <button
          type="button"
          className="btn danger block"
          data-testid="cancel-booking"
          onClick={() => setConfirmCancel(true)}
        >
          {t.cancel}
        </button>
      )}
      <Sheet open={confirmCancel} onClose={() => setConfirmCancel(false)} title={t.cancelConfirm}>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={() => setConfirmCancel(false)}>
            {t.keep}
          </button>
          <button
            type="button"
            className="btn danger"
            data-testid="confirm-cancel"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await backend.cancel(b.id);
                setConfirmCancel(false);
              }, t.cancelled)
            }
          >
            {t.cancel}
          </button>
        </div>
      </Sheet>
      {b.payUrl && (
        <PaymentSheet
          open={payOpen}
          onClose={() => setPayOpen(false)}
          payment={{
            provider: 'sandbox',
            reference: b.payUrl.split('/').pop()!,
            payUrl: b.payUrl,
            amount: b.depositAmount,
          }}
          onPaid={() => {
            setPayOpen(false);
            res.reload();
          }}
        />
      )}
    </div>
  );
}
