import {
  addDays,
  formatMoney,
  isoWeekday,
  parseLocalDate,
  pickText,
  todayIn,
  weekdayShort,
} from '@navbat/core';
import { useState } from 'react';
import type { CatalogDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { downloadText, useAsync, useBackend, useToast } from '../lib';
import { useAdminI18n } from './strings';

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export function AnalyticsView({ catalog }: { catalog: CatalogDTO }) {
  const backend = useBackend();
  const toast = useToast();
  const { t } = useI18n();
  const { a, lang } = useAdminI18n();
  const today = todayIn(catalog.business.timezone, backend.now());
  const [days, setDays] = useState(30);
  const from = addDays(today, -(days - 1));
  const res = useAsync(() => backend.analytics({ from, to: today }), [from, today]);
  const d = res.data;

  const exportCsv = async () => {
    try {
      const csv = await backend.exportCsv({ from, to: addDays(today, 14), lang });
      downloadText(`navbat-${from}_${addDays(today, 14)}.csv`, csv);
    } catch (e) {
      toast(errorText(t, e), 'error');
    }
  };

  const maxDay = Math.max(1, ...(d?.byDay.map((x) => x.bookings) ?? [1]));
  const maxSvc = Math.max(1, ...(d?.topServices.map((x) => x.count) ?? [1]));

  return (
    <section className="panel">
      <header className="panel-head">
        <h1>{a.analytics}</h1>
        <div className="panel-tools">
          <div className="seg">
            {[7, 30].map((n) => (
              <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>
                {n === 7 ? a.range7 : a.range30}
              </button>
            ))}
          </div>
          <button type="button" className="btn small ghost" data-testid="export-csv" onClick={exportCsv}>
            {a.exportCsv}
          </button>
        </div>
      </header>
      {!d ? (
        <div className="spinner center" />
      ) : (
        <>
          <div className="kpis" data-testid="kpis">
            <div className="kpi">
              <span>{a.bookings}</span>
              <b className="num">{d.totals.bookings}</b>
              <small>
                {d.totals.completed} ✓ · {d.totals.cancelled} ✕
              </small>
            </div>
            <div className="kpi accent">
              <span>{a.revenue}</span>
              <b className="num">{formatMoney(d.totals.revenue, lang)}</b>
              <small>
                {a.upcoming}: {formatMoney(d.totals.expectedRevenue, lang)}
              </small>
            </div>
            <div className="kpi">
              <span>{a.utilisation}</span>
              <b className="num">{pct(d.totals.utilisation)}</b>
              <span className="meter">
                <span style={{ width: pct(d.totals.utilisation) }} />
              </span>
            </div>
            <div className="kpi">
              <span>{a.noShows}</span>
              <b className="num">{d.totals.noShows}</b>
              <small>
                {d.totals.completed ? pct(d.totals.noShows / (d.totals.completed + d.totals.noShows)) : '0%'}
              </small>
            </div>
            <div className="kpi">
              <span>{a.avgTicket}</span>
              <b className="num">{formatMoney(d.totals.averageTicket, lang)}</b>
            </div>
            <div className="kpi">
              <span>{a.rating}</span>
              <b className="num">{d.totals.rating?.toFixed(1) ?? '—'} ★</b>
            </div>
          </div>

          <div className="charts">
            <figure className="chart-card wide">
              <figcaption>{a.byDay}</figcaption>
              <svg
                className="bars"
                viewBox={`0 0 ${d.byDay.length * 20} 120`}
                preserveAspectRatio="none"
                role="img"
                aria-label={a.byDay}
              >
                {d.byDay.map((x, i) => {
                  const h = (x.bookings / maxDay) * 100;
                  const wd = isoWeekday(x.date);
                  return (
                    <g key={x.date}>
                      <title>
                        {x.date}: {x.bookings} · {formatMoney(x.revenue, lang)}
                      </title>
                      <rect
                        x={i * 20 + 3}
                        y={110 - h}
                        width={14}
                        height={Math.max(h, 1)}
                        rx={3}
                        className={wd >= 6 ? 'weekend' : ''}
                      />
                    </g>
                  );
                })}
              </svg>
              <div className="bars-axis">
                {d.byDay
                  .filter((_, i) => i % Math.ceil(d.byDay.length / 7) === 0)
                  .map((x) => (
                    <span key={x.date}>
                      {weekdayShort(isoWeekday(x.date), lang)} {parseLocalDate(x.date).day}
                    </span>
                  ))}
              </div>
            </figure>
            <figure className="chart-card">
              <figcaption>{a.topServices}</figcaption>
              <ul className="hbars">
                {d.topServices.map((s) => (
                  <li key={s.serviceId}>
                    <span className="hbar-label">{pickText(s.name, lang)}</span>
                    <span className="hbar">
                      <span style={{ width: `${(s.count / maxSvc) * 100}%` }} />
                    </span>
                    <span className="num hbar-val">{s.count}</span>
                  </li>
                ))}
              </ul>
            </figure>
            <figure className="chart-card">
              <figcaption>{a.byMaster}</figcaption>
              <ul className="hbars">
                {d.byStaff.map((s) => (
                  <li key={s.staffId}>
                    <span className="hbar-label">{s.name}</span>
                    <span className="hbar">
                      <span style={{ width: pct(s.utilisation), background: s.color }} />
                    </span>
                    <span className="num hbar-val">{pct(s.utilisation)}</span>
                  </li>
                ))}
              </ul>
            </figure>
            <figure className="chart-card">
              <figcaption>{a.source}</figcaption>
              <ul className="hbars">
                {d.sources.map((s) => (
                  <li key={s.source}>
                    <span className="hbar-label">{a.sources[s.source]}</span>
                    <span className="hbar">
                      <span style={{ width: `${(s.count / Math.max(1, d.totals.bookings)) * 100}%` }} />
                    </span>
                    <span className="num hbar-val">{s.count}</span>
                  </li>
                ))}
              </ul>
            </figure>
          </div>
        </>
      )}
    </section>
  );
}
