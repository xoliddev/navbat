import { formatHm, formatMoney, parseHm, pickText, zonedToUtc } from '@navbat/core';
import { useEffect, useState } from 'react';
import { quote } from '../app/pickers';
import type { AdminMe, CatalogDTO, TimeOffDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Sheet, useBackend, useTime, useToast } from '../lib';
import { useAdminI18n } from './strings';

export type NewEntryPreset =
  | { kind: 'booking'; staffId: string; date: string; minute: number | null }
  | { kind: 'block'; staffId: string; date: string; minute: number }
  | { kind: 'unblock'; timeOff: TimeOffDTO };

export function NewEntryDialog({
  preset,
  catalog,
  me,
  onClose,
  onDone,
}: {
  preset: NewEntryPreset | null;
  catalog: CatalogDTO;
  me: AdminMe;
  onClose: () => void;
  onDone: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t } = useI18n();
  const { a, lang } = useAdminI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const masters = catalog.staff.filter(
    (s) => s.bookable && s.active && (me.role !== 'master' || s.id === me.staffId),
  );
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<'walkin' | 'phone' | 'admin'>('walkin');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preset || preset.kind === 'unblock') return;
    setStaffId(preset.staffId);
    setDate(preset.date);
    const m = preset.minute ?? 10 * 60;
    setStart(formatHm(m));
    setEnd(formatHm(m + 60));
    setServiceIds([]);
    setName('');
    setPhone('');
    setReason('');
  }, [preset]);

  const staff = masters.find((s) => s.id === staffId) ?? null;
  const offered = catalog.services.filter((s) => staff?.services.some((x) => x.serviceId === s.id));
  const services = serviceIds.map((id) => catalog.services.find((s) => s.id === id)!).filter(Boolean);
  const q = quote(services, staff);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onDone();
    } catch (e) {
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const at = (hm: string) => {
    try {
      return zonedToUtc(date, parseHm(hm), tz);
    } catch {
      return Number.NaN;
    }
  };

  if (preset?.kind === 'unblock') {
    const o = preset.timeOff;
    return (
      <Sheet open onClose={onClose} title={o.reason ?? a.timeOff}>
        <p className="muted">
          {time.hm(o.startAt)}–{time.hm(o.endAt)}
        </p>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => run(() => backend.deleteTimeOff(o.id), a.saved)}
        >
          {a.unblock}
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet open={!!preset} onClose={onClose} title={preset?.kind === 'block' ? a.blockTime : a.newBooking}>
      {preset && (
        <form
          className="form two"
          data-testid="new-entry"
          onSubmit={(e) => {
            e.preventDefault();
            if (preset.kind === 'block') {
              void run(
                () =>
                  backend.createTimeOff({ staffId, start: at(start), end: at(end), reason: reason || null }),
                a.blocked,
              );
            } else {
              void run(
                () =>
                  backend.adminCreateBooking({
                    serviceIds,
                    staffId,
                    start: at(start),
                    customer: { name, phone: phone || null },
                    source,
                  }),
                a.created,
              );
            }
          }}
        >
          <label className="field">
            <span>{a.master}</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{a.date}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>{a.start}</span>
            <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          {preset.kind === 'block' ? (
            <>
              <label className="field">
                <span>{a.end}</span>
                <input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required />
              </label>
              <label className="field span2">
                <span>{a.reason}</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Training, doctor…"
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>{a.source}</span>
                <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                  <option value="walkin">{a.sources.walkin}</option>
                  <option value="phone">{a.sources.phone}</option>
                  <option value="admin">{a.sources.admin}</option>
                </select>
              </label>
              <fieldset className="field span2 svc-pick">
                <span>{a.service}</span>
                <div>
                  {offered.map((s) => (
                    <label key={s.id} className={`pill ${serviceIds.includes(s.id) ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={serviceIds.includes(s.id)}
                        onChange={() =>
                          setServiceIds((x) =>
                            x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id],
                          )
                        }
                      />
                      {pickText(s.name, lang)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>{a.client}</span>
                <input name="client" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>{a.phone}</span>
                <input
                  name="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 90 123 45 67"
                />
              </label>
              {services.length > 0 && (
                <p className="fine span2">
                  {formatHm(parseHmSafe(start))}–{formatHm(parseHmSafe(start) + q.minutes)} ·{' '}
                  {formatMoney(q.price, lang)}
                </p>
              )}
            </>
          )}
          <div className="span2 form-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t.close}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy || (preset.kind === 'booking' && (!serviceIds.length || !name.trim()))}
              data-testid="new-entry-submit"
            >
              {a.create}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

function parseHmSafe(v: string) {
  try {
    return parseHm(v);
  } catch {
    return 0;
  }
}
