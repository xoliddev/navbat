import {
  addDays,
  formatDuration,
  formatMoney,
  isoWeekday,
  type Lang,
  monthDates,
  monthName,
  parseLocalDate,
  pickText,
  todayIn,
  utcToZoned,
  weekdayShort,
} from '@navbat/core';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { CatalogDTO, DayHeatDTO, ServiceDTO, SlotDTO, StaffDTO } from '../backend/types';
import { useI18n } from '../i18n';
import { Avatar, Stars, useAsync, useBackend } from '../lib';
import { tg } from '../telegram';

/** Price and duration of `services` as done by `staff` (null = catalog price, "from"). */
export function quote(services: ServiceDTO[], staff: StaffDTO | null) {
  let price = 0;
  let minutes = 0;
  services.forEach((s, i) => {
    const o = staff?.services.find((x) => x.serviceId === s.id);
    price += o?.price ?? s.price;
    minutes += o?.durationMin ?? s.durationMin;
    if (i > 0) minutes += Math.max(services[i - 1]!.bufferAfterMin, s.bufferBeforeMin);
  });
  return { price, minutes };
}

export function offersAll(staff: StaffDTO, serviceIds: string[]) {
  return serviceIds.every((id) => staff.services.some((s) => s.serviceId === id));
}

export function ServicePicker({
  catalog,
  selected,
  onToggle,
  onlyStaff,
}: {
  catalog: CatalogDTO;
  selected: string[];
  onToggle: (id: string) => void;
  onlyStaff: StaffDTO | null;
}) {
  const { t, lang } = useI18n();
  const services = catalog.services.filter(
    (s) => !onlyStaff || onlyStaff.services.some((x) => x.serviceId === s.id),
  );
  return (
    <div className="step">
      <h1 className="step-title">{t.chooseServices}</h1>
      <p className="step-hint">{t.chooseServicesHint}</p>
      {catalog.categories.map((cat) => {
        const list = services.filter((s) => s.categoryId === cat.id);
        if (list.length === 0) return null;
        return (
          <section key={cat.id} className="svc-group">
            <h2 className="group-title">{pickText(cat.name, lang)}</h2>
            <ul className="svc-list">
              {list.map((s) => {
                const on = selected.includes(s.id);
                const q = quote([s], onlyStaff);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`svc ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      data-testid={`service-${s.id}`}
                      onClick={() => {
                        tg.haptic('select');
                        onToggle(s.id);
                      }}
                    >
                      <span className="svc-check" aria-hidden>
                        <svg viewBox="0 0 16 16" width="14" height="14">
                          <path
                            d="M3.5 8.5l3 3 6-7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="svc-body">
                        <span className="svc-name">{pickText(s.name, lang)}</span>
                        <span className="svc-desc">{pickText(s.description, lang)}</span>
                      </span>
                      <span className="svc-meta">
                        <span className="svc-price">
                          {!onlyStaff && <small>{t.from} </small>}
                          {formatMoney(q.price, lang)}
                        </span>
                        <span className="svc-dur">{formatDuration(q.minutes, lang)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function MasterPicker({
  catalog,
  serviceIds,
  selected,
  onPick,
}: {
  catalog: CatalogDTO;
  serviceIds: string[];
  selected: string | null | undefined;
  onPick: (id: string | null) => void;
}) {
  const { t, lang } = useI18n();
  const services = serviceIds.map((id) => catalog.services.find((s) => s.id === id)!).filter(Boolean);
  const masters = catalog.staff.filter((s) => s.bookable);
  const branch = (id: string | null) => catalog.branches.find((b) => b.id === id)?.name;
  return (
    <div className="step">
      <h1 className="step-title">{t.chooseMaster}</h1>
      <ul className="master-list">
        <li>
          <button
            type="button"
            className={`master any ${selected === null ? 'on' : ''}`}
            data-testid="master-any"
            onClick={() => onPick(null)}
          >
            <span className="avatar any-avatar" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="8" cy="9" r="3" fill="currentColor" />
                <circle cx="16" cy="9" r="3" fill="currentColor" opacity=".6" />
                <path
                  d="M2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M11 19c.8-3 2.6-4.5 5-4.5s4.7 1.5 5.5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </span>
            <span className="master-body">
              <span className="master-name">{t.anyMaster}</span>
              <span className="master-sub">{t.anyMasterHint}</span>
            </span>
          </button>
        </li>
        {masters.map((m) => {
          const ok = offersAll(m, serviceIds);
          const q = quote(services, m);
          return (
            <li key={m.id}>
              <button
                type="button"
                className={`master ${selected === m.id ? 'on' : ''}`}
                disabled={!ok}
                data-testid={`master-${m.id}`}
                onClick={() => {
                  tg.haptic('select');
                  onPick(m.id);
                }}
              >
                <Avatar name={m.name} color={m.color} />
                <span className="master-body">
                  <span className="master-name">{m.name}</span>
                  <span className="master-sub">
                    {pickText(m.title, lang)}
                    {branch(m.branchId) ? ` · ${branch(m.branchId)}` : ''}
                  </span>
                  <span className="master-rating">
                    {m.rating ? (
                      <>
                        <Stars value={m.rating} /> <b>{m.rating.toFixed(1)}</b>{' '}
                        <span>{t.reviews(m.reviewCount)}</span>
                      </>
                    ) : (
                      <span>{t.noReviews}</span>
                    )}
                  </span>
                </span>
                <span className="master-meta">
                  {ok ? (
                    <>
                      <span className="svc-price">{formatMoney(q.price, lang)}</span>
                      <span className="svc-dur">{formatDuration(q.minutes, lang)}</span>
                    </>
                  ) : (
                    <span className="svc-dur">{t.doesNotOffer}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

/** Month calendar where each day carries a turquoise "free time" gauge. */
export function Heatmap({
  month,
  days,
  selected,
  onSelect,
  onMonth,
  minMonth,
  maxMonth,
  lang,
}: {
  month: string;
  days: DayHeatDTO[] | undefined;
  selected: string | null;
  onSelect: (d: string) => void;
  onMonth: (m: string) => void;
  minMonth: string;
  maxMonth: string;
  lang: Lang;
}) {
  const { t } = useI18n();
  const dates = monthDates(month);
  const lead = isoWeekday(dates[0]!) - 1;
  const { year, month: m } = parseLocalDate(month);
  const byDate = new Map(days?.map((d) => [d.date, d]));
  const prev = addDays(dates[0]!, -1);
  const next = addDays(dates.at(-1)!, 1);
  return (
    <div className="heat">
      <div className="heat-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous month"
          disabled={monthKey(prev) < monthKey(minMonth)}
          onClick={() => onMonth(prev)}
        >
          ‹
        </button>
        <h2 className="heat-month">
          {monthName(m, lang)} <span className="muted">{year}</span>
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next month"
          disabled={monthKey(next) > monthKey(maxMonth)}
          onClick={() => onMonth(next)}
        >
          ›
        </button>
      </div>
      <div className="heat-grid">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <span key={d} className="heat-wd">
            {weekdayShort(d, lang)}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {dates.map((d) => {
          const info = byDate.get(d);
          const level = info?.level ?? 0;
          const enabled = !!info?.bookable;
          return (
            <button
              key={d}
              type="button"
              className={`heat-day lvl-${level} ${selected === d ? 'on' : ''}`}
              disabled={!enabled}
              aria-pressed={selected === d}
              aria-label={`${d}${enabled ? '' : `, ${t.closedDay}`}`}
              data-testid={`day-${d}`}
              onClick={() => {
                tg.haptic('select');
                onSelect(d);
              }}
            >
              <span className="heat-num num">{Number(d.slice(8))}</span>
              <span className="heat-gauge" aria-hidden>
                <span style={{ transform: `scaleX(${level / 4})` }} />
              </span>
            </button>
          );
        })}
      </div>
      {!days && <div className="heat-loading" aria-hidden />}
    </div>
  );
}

function bucket(minute: number): 'morning' | 'afternoon' | 'evening' {
  if (minute < 12 * 60) return 'morning';
  if (minute < 17 * 60) return 'afternoon';
  return 'evening';
}

export function SlotGrid({
  slots,
  tz,
  selected,
  onPick,
}: {
  slots: SlotDTO[];
  tz: string;
  selected: number | null;
  onPick: (s: SlotDTO) => void;
}) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const g: Record<string, SlotDTO[]> = { morning: [], afternoon: [], evening: [] };
    for (const s of slots) g[bucket(utcToZoned(s.start, tz).minute)]!.push(s);
    return g;
  }, [slots, tz]);
  if (slots.length === 0) return <p className="empty-line">{t.noSlots}</p>;
  return (
    <div className="slots">
      {(['morning', 'afternoon', 'evening'] as const).map((k) =>
        groups[k]!.length ? (
          <section key={k} className="slot-group">
            <h3 className="group-title">{t[k]}</h3>
            <div className="slot-row">
              {groups[k]!.map((s) => {
                const z = utcToZoned(s.start, tz).minute;
                const label = `${String(Math.floor(z / 60)).padStart(2, '0')}:${String(z % 60).padStart(2, '0')}`;
                return (
                  <button
                    key={s.start}
                    type="button"
                    className={`slot num ${selected === s.start ? 'on' : ''}`}
                    aria-pressed={selected === s.start}
                    data-testid={`slot-${label}`}
                    onClick={() => {
                      tg.haptic('select');
                      onPick(s);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

/** Calendar + slots for a set of services and a master (or any). */
export function DateTimePicker({
  catalog,
  serviceIds,
  staffId,
  value,
  onChange,
  title,
}: {
  catalog: CatalogDTO;
  serviceIds: string[];
  staffId: string | null;
  value: { date: string | null; slot: SlotDTO | null };
  onChange: (v: { date: string | null; slot: SlotDTO | null }) => void;
  title: string;
}) {
  const backend = useBackend();
  const { lang } = useI18n();
  const tz = catalog.business.timezone;
  const today = todayIn(tz, backend.now());
  const horizonEnd = addDays(today, catalog.business.settings.horizonDays);
  const [month, setMonth] = useState(value.date ?? today);
  const key = `${serviceIds.join(',')}|${staffId}`;

  const first = useAsync(
    async () => (value.date ? value.date : backend.firstAvailable({ serviceIds, staffId })),
    [key],
  );
  const date = value.date ?? first.data ?? null;
  const firstDate = first.data;
  useEffect(() => {
    if (!value.date && firstDate) setMonth(firstDate);
  }, [firstDate, value.date]);

  const heat = useAsync(() => backend.availability({ serviceIds, staffId, month }), [key, month]);
  const slots = useAsync(async () => (date ? backend.slots({ serviceIds, staffId, date }) : []), [key, date]);

  return (
    <div className="step">
      <h1 className="step-title">{title}</h1>
      <Heatmap
        month={month}
        days={heat.data}
        selected={date}
        onSelect={(d) => onChange({ date: d, slot: null })}
        onMonth={setMonth}
        minMonth={today}
        maxMonth={horizonEnd}
        lang={lang}
      />
      <motion.div
        key={date ?? 'none'}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {slots.loading ? (
          <div className="slot-skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="skeleton" />
            ))}
          </div>
        ) : (
          <SlotGrid
            slots={slots.data ?? []}
            tz={tz}
            selected={value.slot?.start ?? null}
            onPick={(s) => onChange({ date, slot: s })}
          />
        )}
      </motion.div>
    </div>
  );
}
