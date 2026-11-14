import { type Permission, can } from '@navbat/core';
import { type ReactNode, useEffect } from 'react';
import { errorText, useI18n } from '../i18n';
import { useAsync, useBackend } from '../lib';
import { tg } from '../telegram';
import { AnalyticsView } from './Analytics';
import { CalendarView } from './Calendar';
import { ClientDetail, ClientsView } from './Clients';
import { ServicesView, SettingsView, TeamView } from './Manage';
import { useAdminI18n } from './strings';
import '../styles/admin.css';

const ICONS: Record<string, ReactNode> = {
  calendar: <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4" />,
  clients: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M18 15c2.3.6 4 2.6 4 6" />,
  services: <path d="M6 3l12 18M18 3L6 21M4 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM16 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0z" />,
  team: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
};

const SECTIONS: { key: keyof typeof ICONS; perm: Permission }[] = [
  { key: 'calendar', perm: 'calendar.own' },
  { key: 'clients', perm: 'clients.view' },
  { key: 'services', perm: 'catalog.manage' },
  { key: 'team', perm: 'catalog.manage' },
  { key: 'analytics', perm: 'analytics.view' },
  { key: 'settings', perm: 'settings.manage' },
];

export function AdminApp({ hash, embedded }: { hash: string; embedded?: boolean }) {
  const backend = useBackend();
  const { t } = useI18n();
  const { a } = useAdminI18n();
  const me = useAsync(() => backend.adminMe(), []);
  const catalog = useAsync(() => backend.adminCatalog(), []);
  const parts = hash.replace(/^#\/admin\/?/, '').split('/');
  const section = (parts[0] || 'calendar') as keyof typeof ICONS;

  useEffect(() => {
    if (tg.inTelegram) document.documentElement.classList.add('in-telegram');
  }, []);

  if (me.error) {
    return (
      <div className="admin-empty">
        <h1>{a.signIn}</h1>
        <p className="muted">{a.signInHint}</p>
        <p className="muted">{errorText(t, me.error)}</p>
      </div>
    );
  }
  if (!me.data || !catalog.data) {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    );
  }
  const role = me.data.role;
  const allowed = SECTIONS.filter((s) => can(role, s.perm));
  const current = allowed.find((s) => s.key === section) ? section : 'calendar';

  return (
    <div className={`admin ${embedded ? 'embedded' : ''}`} data-testid="admin">
      <nav className="admin-nav" aria-label="Admin">
        {!embedded && (
          <div className="admin-brand">
            <span className="mini-logo">N</span>
            <span>{catalog.data.business.name}</span>
          </div>
        )}
        {allowed.map((s) => (
          <a key={s.key} href={`#/admin/${s.key}`} className={current === s.key ? 'on' : ''} data-testid={`admin-nav-${s.key}`}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[s.key]}
            </svg>
            <span>{a[s.key as 'calendar']}</span>
          </a>
        ))}
        <div className="admin-me">
          <b>{me.data.name}</b>
          <small>{a.roles[role]}</small>
        </div>
      </nav>
      <main className="admin-main">
        {current === 'calendar' && <CalendarView catalog={catalog.data} me={me.data} />}
        {current === 'clients' &&
          (parts[1] ? <ClientDetail id={parts[1]} catalog={catalog.data} /> : <ClientsView catalog={catalog.data} />)}
        {current === 'services' && <ServicesView catalog={catalog.data} onSaved={catalog.reload} />}
        {current === 'team' && <TeamView catalog={catalog.data} me={me.data} onSaved={catalog.reload} />}
        {current === 'analytics' && <AnalyticsView catalog={catalog.data} />}
        {current === 'settings' && <SettingsView catalog={catalog.data} onSaved={catalog.reload} />}
      </main>
    </div>
  );
}
