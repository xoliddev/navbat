import { formatDateLong, formatMoney, formatPhone, pickText, utcToZoned } from '@navbat/core';
import { useEffect, useState } from 'react';
import type { CatalogDTO } from '../backend/types';
import { useI18n } from '../i18n';
import { useAsync, useBackend, useTime } from '../lib';
import { statusChip } from './BookingDrawer';
import { useAdminI18n } from './strings';

function openClient(id: string) {
  window.location.hash = `#/admin/clients/${id}`;
}

export function ClientsView({ catalog }: { catalog: CatalogDTO }) {
  const backend = useBackend();
  const { a, lang } = useAdminI18n();
  const tz = catalog.business.timezone;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  const list = useAsync(() => backend.clients(q || undefined), [q]);
  const day = (t: number | null) => (t ? formatDateLong(utcToZoned(t, tz).date, lang).split(',')[0] : '—');

  return (
    <section className="panel">
      <header className="panel-head">
        <h1>{a.clients}</h1>
        <input
          className="input search"
          type="search"
          placeholder={a.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={a.search}
        />
      </header>
      <div className="table-wrap">
        <table className="table" data-testid="clients-table">
          <thead>
            <tr>
              <th>{a.client}</th>
              <th>{a.phone}</th>
              <th className="r">{a.visits}</th>
              <th className="r">{a.noShows}</th>
              <th className="r">{a.spent}</th>
              <th>{a.lastVisit}</th>
              <th>{a.nextVisit}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr
                key={c.id}
                onClick={() => openClient(c.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openClient(c.id)}
              >
                <td>
                  <b>{c.name}</b>
                  {c.telegramUserId ? <span className="tg-dot" title="Telegram" /> : null}
                </td>
                <td className="num-ui">{c.phone ? formatPhone(c.phone) : '—'}</td>
                <td className="r num-ui">{c.visits}</td>
                <td className="r num-ui">
                  {c.noShows ? <span className="chip bad">{c.noShows}</span> : '0'}
                </td>
                <td className="r num-ui">{formatMoney(c.totalSpent, lang)}</td>
                <td>{day(c.lastVisit)}</td>
                <td>{day(c.nextVisit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.length === 0 && <p className="empty-line">{a.noClients}</p>}
      </div>
    </section>
  );
}

export function ClientDetail({ id, catalog }: { id: string; catalog: CatalogDTO }) {
  const backend = useBackend();
  const { t } = useI18n();
  const { a, lang } = useAdminI18n();
  const tz = catalog.business.timezone;
  const time = useTime(tz);
  const c = useAsync(() => backend.client(id), [id]);
  if (!c.data) return <div className="spinner center" />;
  const d = c.data;
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <a href="#/admin/clients" className="back-link">
            ‹ {a.clients}
          </a>
          <h1>{d.name}</h1>
          <p className="muted">{d.phone ? formatPhone(d.phone) : '—'}</p>
        </div>
      </header>
      <div className="kpis small">
        <div className="kpi">
          <span>{a.visits}</span>
          <b className="num">{d.visits}</b>
        </div>
        <div className="kpi">
          <span>{a.noShows}</span>
          <b className="num">{d.noShows}</b>
        </div>
        <div className="kpi">
          <span>{a.spent}</span>
          <b className="num">{formatMoney(d.totalSpent, lang)}</b>
        </div>
      </div>
      <h2 className="group-title">{a.history}</h2>
      <ul className="history">
        {d.history.map((b) => (
          <li key={b.id}>
            <span className="num">{formatDateLong(utcToZoned(b.startAt, tz).date, lang).split(',')[0]}</span>
            <span className="num">{time.hm(b.startAt)}</span>
            <span>{b.items.map((i) => pickText(i.name, lang)).join(' + ')}</span>
            <span className="muted">{b.staffName}</span>
            <span className={`chip ${statusChip(b.status)}`}>{t.status[b.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
