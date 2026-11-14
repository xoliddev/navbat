import { formatDateLong, formatMoney, formatPhone, pickText, utcToZoned } from '@navbat/core';
import { useState } from 'react';
import type { AdminMe, BookingDTO, CatalogDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Sheet, Stars, useAsync, useBackend, useTime, useToast } from '../lib';
import { useAdminI18n } from './strings';

export function statusChip(status: string) {
  return status === 'confirmed' || status === 'completed' ? 'ok' : status === 'pending' ? 'warn' : 'bad';
}

export function BookingDrawer({
  id,
  catalog,
  me,
  onClose,
  onChanged,
}: {
  id: string | null;
  catalog: CatalogDTO;
  me: AdminMe;
  onClose: () => void;
  onChanged: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t } = useI18n();
  const { a, lang } = useAdminI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const cal = useAsync<BookingDTO | null>(async () => (id ? backend.adminBooking(id) : null), [id]);
  const b = cal.data ?? null;
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [askCancel, setAskCancel] = useState(false);
  const now = backend.now();

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onChanged();
      cal.reload();
    } catch (e) {
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!id} onClose={onClose} title={b ? `${b.customer.name}` : ' '}>
      {!b ? (
        <div className="spinner center" />
      ) : (
        <div className="drawer" data-testid="booking-drawer">
          <div className="drawer-when">
            <span className="num drawer-time">
              {time.hm(b.startAt)}–{time.hm(b.endAt)}
            </span>
            <span className="muted">{formatDateLong(utcToZoned(b.startAt, tz).date, lang)}</span>
          </div>
          <div className="detail-status">
            <span className={`chip ${statusChip(b.status)}`}>{t.status[b.status]}</span>
            <span className="chip">{a.sources[b.source]}</span>
            <span className="chip num">{b.code}</span>
            {b.runningLateMin ? <span className="chip warn">{a.late(b.runningLateMin)}</span> : null}
          </div>
          <dl className="drawer-facts">
            <div>
              <dt>{a.client}</dt>
              <dd>
                {b.customer.name}
                {b.customer.phone && (
                  <>
                    {' · '}
                    <a href={`tel:${b.customer.phone}`}>{formatPhone(b.customer.phone)}</a>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>{a.master}</dt>
              <dd>{b.staffName}</dd>
            </div>
            <div>
              <dt>{a.service}</dt>
              <dd>{b.items.map((i) => pickText(i.name, lang)).join(' + ')}</dd>
            </div>
            <div>
              <dt>{a.total}</dt>
              <dd className="num">
                {formatMoney(b.totalPrice, lang)}
                {b.depositAmount > 0 && (
                  <small className="muted">
                    {' '}
                    · {t.deposit} {formatMoney(b.depositAmount, lang)} ({b.paymentStatus})
                  </small>
                )}
              </dd>
            </div>
            {b.notes && (
              <div>
                <dt>{a.notes}</dt>
                <dd>{b.notes}</dd>
              </div>
            )}
            {b.review && (
              <div>
                <dt>{a.rating}</dt>
                <dd>
                  <Stars value={b.review.rating} /> {b.review.comment}
                </dd>
              </div>
            )}
          </dl>
          <div className="drawer-actions">
            {b.status === 'pending' && (
              <button type="button" className="btn small" disabled={busy} onClick={() => act(() => backend.adminStatus(b.id, 'confirm'), a.statusChanged)}>
                {a.confirm}
              </button>
            )}
            {b.status === 'confirmed' && now >= b.startAt && (
              <>
                <button type="button" className="btn small" disabled={busy} onClick={() => act(() => backend.adminStatus(b.id, 'complete'), a.statusChanged)}>
                  {a.complete}
                </button>
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => act(() => backend.adminStatus(b.id, 'no_show'), a.statusChanged)}>
                  {a.noShow}
                </button>
              </>
            )}
            {(b.status === 'confirmed' || b.status === 'pending') && (me.role !== 'master' || b.staffId === me.staffId) && (
              <button type="button" className="btn small danger" data-testid="admin-cancel" onClick={() => setAskCancel(true)}>
                {a.cancelBooking}
              </button>
            )}
          </div>
          {askCancel && (
            <div className="drawer-cancel">
              <label className="field">
                <span>{a.cancelReason}</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn danger small"
                data-testid="admin-cancel-confirm"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await backend.adminCancel(b.id, reason || undefined);
                    setAskCancel(false);
                    onClose();
                  }, a.cancelledOk)
                }
              >
                {a.cancelBooking}
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
