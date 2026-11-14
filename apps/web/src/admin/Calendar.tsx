import {
  addDays,
  formatDateLong,
  formatHm,
  isoWeekday,
  pickText,
  todayIn,
  utcToZoned,
  weekdayShort,
  zonedToUtc,
} from '@navbat/core';
import { motion } from 'motion/react';
import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminMe, BookingDTO, CalendarDTO, CatalogDTO, TimeOffDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Avatar, useAsync, useBackend, useToast } from '../lib';
import { BookingDrawer } from './BookingDrawer';
import { NewEntryDialog, type NewEntryPreset } from './NewEntryDialog';
import { useAdminI18n } from './strings';

const PPM = 1.15; // pixels per minute
const SNAP = 15;

interface Column {
  key: string;
  staffId: string;
  date: string;
}

function mondayOf(date: string) {
  return addDays(date, -(isoWeekday(date) - 1));
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  deltaMin: number;
  colKey: string;
  origColKey: string;
  moved: boolean;
}

export function CalendarView({
  catalog,
  me,
  initialDate,
}: {
  catalog: CatalogDTO;
  me: AdminMe;
  initialDate?: string;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t } = useI18n();
  const { a, lang } = useAdminI18n();
  const tz = catalog.business.timezone;
  const today = todayIn(tz, backend.now());
  const masters = catalog.staff.filter((s) => s.bookable && s.active);
  const isMaster = me.role === 'master';
  const [date, setDate] = useState(initialDate ?? today);
  const [view, setView] = useState<'day' | 'week'>(isMaster ? 'week' : 'day');
  const [weekStaff, setWeekStaff] = useState(isMaster ? me.staffId : (masters[0]?.id ?? ''));
  const [openId, setOpenId] = useState<string | null>(null);
  const [preset, setPreset] = useState<NewEntryPreset | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<Record<string, { start: number; staffId: string }>>({});
  const colRefs = useRef(new Map<string, HTMLDivElement>());

  const from = view === 'day' ? date : mondayOf(date);
  const to = view === 'day' ? date : addDays(from, 6);
  const cal = useAsync<CalendarDTO>(
    () => backend.calendar({ from, to, staffIds: view === 'week' ? [weekStaff] : undefined }),
    [from, to, view, weekStaff],
  );

  const columns: Column[] = useMemo(() => {
    if (view === 'week')
      return Array.from({ length: 7 }, (_, i) => ({
        key: addDays(from, i),
        staffId: weekStaff,
        date: addDays(from, i),
      }));
    const list = cal.data?.staff ?? masters;
    return list.map((s) => ({ key: s.id, staffId: s.id, date }));
  }, [view, from, weekStaff, date, cal.data, masters]);

  const [startHour, endHour] = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    for (const w of cal.data?.working ?? []) {
      for (const i of w.intervals) {
        const s = utcToZoned(i.start, tz);
        const e = utcToZoned(i.end - 1, tz);
        lo = Math.min(lo, s.minute);
        hi = Math.max(hi, e.date === s.date ? e.minute + 1 : 24 * 60);
      }
    }
    for (const b of cal.data?.bookings ?? []) {
      lo = Math.min(lo, utcToZoned(b.startAt, tz).minute);
      hi = Math.max(hi, utcToZoned(b.endAt - 1, tz).minute + 1);
    }
    if (lo >= hi) return [9, 21];
    return [Math.max(0, Math.floor(lo / 60) - 1), Math.min(24, Math.ceil(hi / 60) + 1)];
  }, [cal.data, tz]);
  const gridMin = startHour * 60;
  const height = (endHour - startHour) * 60 * PPM;

  const top = (t0: number) => (utcToZoned(t0, tz).minute - gridMin) * PPM;
  const bookingsIn = (col: Column) =>
    (cal.data?.bookings ?? []).filter((b) => {
      if (b.status === 'cancelled') return false;
      const p = pending[b.id];
      const staffId = p?.staffId ?? b.staffId;
      const start = p?.start ?? b.startAt;
      return staffId === col.staffId && utcToZoned(start, tz).date === col.date;
    });
  const offIn = (col: Column): TimeOffDTO[] =>
    (cal.data?.timeOff ?? []).filter((o) => {
      if (o.staffId && o.staffId !== col.staffId) return false;
      const dayStart = zonedToUtc(col.date, 0, tz);
      const dayEnd = zonedToUtc(addDays(col.date, 1), 0, tz);
      return o.startAt < dayEnd && o.endAt > dayStart;
    });

  const colUnder = (x: number) => {
    for (const [key, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return key;
    }
    return null;
  };

  const onPointerDown = (e: RPointerEvent, b: BookingDTO, col: Column) => {
    if (e.button !== 0 || b.status === 'completed' || b.status === 'no_show') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      id: b.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      deltaMin: 0,
      colKey: col.key,
      origColKey: col.key,
      moved: false,
    });
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;
    const moved = drag.moved || Math.abs(dy) > 5 || Math.abs(dx) > 5;
    const deltaMin = Math.round(dy / PPM / SNAP) * SNAP;
    const colKey = colUnder(e.clientX) ?? drag.colKey;
    if (moved !== drag.moved || deltaMin !== drag.deltaMin || colKey !== drag.colKey)
      setDrag({ ...drag, moved, deltaMin, colKey });
  };
  const onPointerUp = async (e: RPointerEvent, b: BookingDTO) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      setOpenId(b.id);
      return;
    }
    const col = columns.find((c) => c.key === d.colKey)!;
    const local = utcToZoned(b.startAt, tz).minute + d.deltaMin;
    const start = zonedToUtc(col.date, local, tz);
    const staffId = col.staffId;
    if (start === b.startAt && staffId === b.staffId) return;
    setPending((p) => ({ ...p, [b.id]: { start, staffId } }));
    try {
      await backend.adminReschedule(b.id, start, staffId !== b.staffId ? staffId : undefined);
      toast(a.moved);
      cal.reload();
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setPending((p) => {
        const { [b.id]: _, ...rest } = p;
        return rest;
      });
    }
  };

  const onEmptyClick = (e: React.MouseEvent<HTMLDivElement>, col: Column) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('cal-work')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const minute = Math.floor(((e.clientY - r.top) / PPM + gridMin) / SNAP) * SNAP;
    setPreset({ kind: 'booking', staffId: col.staffId, date: col.date, minute });
  };

  const now = backend.now();
  const nowLocal = utcToZoned(now, tz);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const staffById = new Map(catalog.staff.map((s) => [s.id, s]));
  const step = view === 'day' ? 1 : 7;

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous"
            onClick={() => setDate(addDays(date, -step))}
          >
            ‹
          </button>
          <button type="button" className="btn small ghost" onClick={() => setDate(today)}>
            {a.today}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next"
            onClick={() => setDate(addDays(date, step))}
          >
            ›
          </button>
          <h1 className="cal-title" data-testid="cal-title">
            {view === 'day'
              ? formatDateLong(date, lang)
              : `${formatDateLong(from, lang).split(',')[0]} – ${formatDateLong(to, lang).split(',')[0]}`}
          </h1>
        </div>
        <div className="cal-actions">
          <div className="seg" role="tablist">
            {!isMaster && (
              <button
                type="button"
                role="tab"
                aria-selected={view === 'day'}
                className={view === 'day' ? 'on' : ''}
                onClick={() => setView('day')}
              >
                {a.day}
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={view === 'week'}
              className={view === 'week' ? 'on' : ''}
              onClick={() => setView('week')}
            >
              {a.week}
            </button>
          </div>
          {view === 'week' && !isMaster && (
            <select
              className="input small-select"
              value={weekStaff}
              onChange={(e) => setWeekStaff(e.target.value)}
              aria-label={a.master}
            >
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn small ghost"
            onClick={() =>
              setPreset({
                kind: 'block',
                staffId: view === 'week' ? weekStaff : isMaster ? me.staffId : (masters[0]?.id ?? ''),
                date,
                minute: 13 * 60,
              })
            }
          >
            {a.blockTime}
          </button>
          <button
            type="button"
            className="btn small"
            data-testid="new-booking"
            onClick={() =>
              setPreset({
                kind: 'booking',
                staffId: view === 'week' ? weekStaff : isMaster ? me.staffId : (masters[0]?.id ?? ''),
                date,
                minute: null,
              })
            }
          >
            + {a.newBooking}
          </button>
        </div>
      </div>
      <p className="cal-hint">{isMaster ? a.masterNote : a.dragHint}</p>

      <div className={`cal-grid-wrap ${cal.loading ? 'loading' : ''}`}>
        <div
          className="cal-grid"
          style={{
            gridTemplateColumns: `56px repeat(${columns.length}, minmax(${view === 'day' ? 150 : 110}px, 1fr))`,
          }}
        >
          <div className="cal-corner" />
          {columns.map((col) => {
            const s = staffById.get(col.staffId);
            return (
              <div
                key={col.key}
                className={`cal-colhead ${col.date === today && view === 'week' ? 'today' : ''}`}
              >
                {view === 'day' && s ? (
                  <>
                    <Avatar name={s.name} color={s.color} size={28} />
                    <span>
                      <b>{s.name.split(' ')[0]}</b>
                      <small>{pickText(s.title, lang)}</small>
                    </span>
                  </>
                ) : (
                  <span>
                    <b className="num">{Number(col.date.slice(8))}</b>
                    <small>{weekdayShort(isoWeekday(col.date), lang)}</small>
                  </span>
                )}
              </div>
            );
          })}

          <div className="cal-rail" style={{ height }}>
            {hours.map((h) => (
              <span key={h} style={{ top: (h - startHour) * 60 * PPM }} className="num">
                {formatHm(h * 60)}
              </span>
            ))}
          </div>

          {columns.map((col) => {
            const work =
              cal.data?.working.find((w) => w.staffId === col.staffId && w.date === col.date)?.intervals ??
              [];
            return (
              <div
                key={col.key}
                className="cal-col"
                style={{ height }}
                data-testid={`cal-col-${col.key}`}
                ref={(el) => {
                  if (el) colRefs.current.set(col.key, el);
                  else colRefs.current.delete(col.key);
                }}
                onClick={(e) => onEmptyClick(e, col)}
              >
                {hours.map((h) => (
                  <span key={h} className="cal-hline" style={{ top: (h - startHour) * 60 * PPM }} />
                ))}
                {work.map((w) => (
                  <div
                    key={w.start}
                    className="cal-work"
                    style={{ top: top(w.start), height: ((w.end - w.start) / 60_000) * PPM }}
                  />
                ))}
                {offIn(col).map((o) => {
                  const dayStart = zonedToUtc(col.date, 0, tz);
                  const s = Math.max(o.startAt, dayStart);
                  const e = Math.min(o.endAt, zonedToUtc(addDays(col.date, 1), 0, tz));
                  const tTop = Math.max(0, top(s));
                  const tH = Math.min(height - tTop, ((e - s) / 60_000) * PPM);
                  return (
                    <button
                      type="button"
                      key={o.id}
                      className="cal-off"
                      style={{ top: tTop, height: tH }}
                      title={o.reason ?? a.timeOff}
                      onClick={() => setPreset({ kind: 'unblock', timeOff: o })}
                    >
                      <span>{o.reason ?? a.timeOff}</span>
                    </button>
                  );
                })}
                {col.date === today && nowLocal.minute >= gridMin && nowLocal.minute <= endHour * 60 && (
                  <span className="cal-now" style={{ top: (nowLocal.minute - gridMin) * PPM }} />
                )}
                {bookingsIn(col).map((b) => {
                  const p = pending[b.id];
                  const start = p?.start ?? b.startAt;
                  const dur = (b.endAt - b.startAt) / 60_000;
                  const isDrag = drag?.id === b.id;
                  const s = staffById.get(b.staffId);
                  return (
                    <motion.div
                      key={b.id}
                      layout={!isDrag}
                      role="button"
                      tabIndex={0}
                      data-testid="cal-booking"
                      data-code={b.code}
                      className={`cal-bk st-${b.status} ${dur < 40 ? 'short' : ''} ${isDrag && drag.moved ? 'dragging' : ''} ${p ? 'saving' : ''}`}
                      style={{
                        top: top(start),
                        height: Math.max(22, dur * PPM - 2),
                        ['--c' as string]: s?.color ?? '#2346d4',
                        y: isDrag && drag.moved ? drag.deltaMin * PPM : 0,
                        zIndex: isDrag ? 5 : undefined,
                      }}
                      onPointerDown={(e) => onPointerDown(e, b, col)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(e) => void onPointerUp(e, b)}
                      onPointerCancel={() => setDrag(null)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenId(b.id)}
                    >
                      <span className="cal-bk-time num">
                        {formatHm(utcToZoned(start, tz).minute + (isDrag ? drag.deltaMin : 0))}
                      </span>
                      <span className="cal-bk-name">{b.customer.name}</span>
                      {dur >= 40 && (
                        <span className="cal-bk-what">
                          {b.items.map((i) => pickText(i.name, lang)).join(' + ')}
                        </span>
                      )}
                      {b.runningLateMin ? <span className="cal-bk-late">+{b.runningLateMin}′</span> : null}
                    </motion.div>
                  );
                })}
                {drag?.moved && drag.colKey === col.key && drag.origColKey !== col.key && (
                  <div className="cal-drop" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <BookingDrawer
        id={openId}
        catalog={catalog}
        me={me}
        onClose={() => setOpenId(null)}
        onChanged={cal.reload}
      />
      <NewEntryDialog
        preset={preset}
        catalog={catalog}
        me={me}
        onClose={() => setPreset(null)}
        onDone={() => {
          setPreset(null);
          cal.reload();
        }}
      />
    </div>
  );
}

export function useNowTick(ms = 60_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
