import type { Lang } from '@navbat/core';
import { lazy, Suspense, useState } from 'react';
import { MiniApp } from '../app/MiniApp';
import type { DemoBackend, DemoRole } from '../backend/demo';
import { useI18n } from '../i18n';
import { useAsync } from '../lib';
import { BotChat } from './BotChat';
import '../styles/demo.css';

const AdminApp = lazy(() => import('../admin/AdminApp').then((m) => ({ default: m.AdminApp })));

const COPY: Record<
  Lang,
  {
    badge: string;
    customer: string;
    admin: string;
    reset: string;
    app: string;
    chat: string;
    role: string;
    roles: Record<DemoRole, string>;
  }
> = {
  uz: {
    badge: 'Demo rejim — hammasi brauzeringizda ishlaydi',
    customer: 'Mijoz ilovasi',
    admin: 'Admin panel',
    reset: 'Demoni tiklash',
    app: 'Ilova',
    chat: 'Bot',
    role: 'Rol',
    roles: { owner: 'Egasi', admin: 'Administrator', master: 'Usta (Jasur)' },
  },
  ru: {
    badge: 'Демо-режим — всё работает в вашем браузере',
    customer: 'Приложение клиента',
    admin: 'Админ-панель',
    reset: 'Сбросить демо',
    app: 'Приложение',
    chat: 'Бот',
    role: 'Роль',
    roles: { owner: 'Владелец', admin: 'Администратор', master: 'Мастер (Жасур)' },
  },
  en: {
    badge: 'Demo mode — runs entirely in your browser',
    customer: 'Customer app',
    admin: 'Admin panel',
    reset: 'Reset demo',
    app: 'App',
    chat: 'Bot chat',
    role: 'Role',
    roles: { owner: 'Owner', admin: 'Front desk', master: 'Master (Jasur)' },
  },
};

export function DemoShell({
  backend,
  hash,
  launchHash,
}: {
  backend: DemoBackend;
  hash: string;
  launchHash: string;
}) {
  const { lang } = useI18n();
  const c = COPY[lang];
  const isAdmin = hash.startsWith('#/admin');
  const [pane, setPane] = useState<'app' | 'chat'>('app');
  const [role, setRole] = useState<DemoRole>(backend.role);
  const [appKey, setAppKey] = useState(0);
  const catalog = useAsync(() => backend.catalog(), []);

  const reset = async () => {
    await backend.reset();
    window.location.hash = '';
    window.location.reload();
  };

  return (
    <div className={`demo ${isAdmin ? 'is-admin' : 'is-customer'}`}>
      <header className="demo-bar">
        <a className="demo-logo" href="#/" aria-label="Navbat">
          <span className="mini-logo">N</span>
          <span>Navbat</span>
        </a>
        <span className="demo-badge" data-testid="demo-badge">
          <span className="dot" aria-hidden />
          {c.badge}
        </span>
        <nav className="demo-nav" aria-label="Demo views">
          <a href="#/" className={!isAdmin ? 'on' : ''} data-testid="nav-customer">
            {c.customer}
          </a>
          <a href="#/admin/calendar" className={isAdmin ? 'on' : ''} data-testid="nav-admin">
            {c.admin}
          </a>
        </nav>
        <div className="demo-tools">
          {isAdmin && (
            <label className="demo-role">
              <span>{c.role}</span>
              <select
                value={role}
                data-testid="role-select"
                onChange={(e) => {
                  const r = e.target.value as DemoRole;
                  backend.setRole(r);
                  setRole(r);
                }}
              >
                {(Object.keys(c.roles) as DemoRole[]).map((r) => (
                  <option key={r} value={r}>
                    {c.roles[r]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="btn small ghost" onClick={reset}>
            {c.reset}
          </button>
          <a
            className="btn small ghost"
            href="https://github.com/xoliddev/navbat"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>

      {isAdmin ? (
        <Suspense
          fallback={
            <div className="boot">
              <div className="spinner" />
            </div>
          }
        >
          <AdminApp key={role} hash={hash} embedded />
        </Suspense>
      ) : (
        <div className="demo-stage">
          <div className="demo-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'app'}
              className={pane === 'app' ? 'on' : ''}
              onClick={() => setPane('app')}
            >
              {c.app}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'chat'}
              className={pane === 'chat' ? 'on' : ''}
              data-testid="tab-chat"
              onClick={() => setPane('chat')}
            >
              {c.chat}
            </button>
          </div>
          <div className={`phone ${pane === 'app' ? 'show' : ''}`}>
            <div className="phone-screen" id="phone-screen">
              <MiniApp
                key={appKey}
                startParam={new URLSearchParams(window.location.search).get('startapp')}
                hash={launchHash}
              />
            </div>
          </div>
          <div className={`chat-pane ${pane === 'chat' ? 'show' : ''}`}>
            {catalog.data && (
              <BotChat
                backend={backend}
                tz={catalog.data.business.timezone}
                businessName={catalog.data.business.name}
                onOpenApp={() => {
                  setPane('app');
                  setAppKey((k) => k + 1);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
