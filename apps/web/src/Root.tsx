import type { Lang } from '@navbat/core';
import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { MiniApp } from './app/MiniApp';
import type { DemoBackend } from './backend/demo';
import { createHttpBackend } from './backend/http';
import type { Backend } from './backend/types';
import { DICTS, I18nContext, initialLang } from './i18n';
import { BackendContext, DataVersionContext, ToastProvider } from './lib';
import { tg } from './telegram';

const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));
const DemoShell = lazy(() => import('./demo/DemoShell').then((m) => ({ default: m.DemoShell })));

export function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function httpBackend(): Backend {
  const env = import.meta.env;
  return createHttpBackend({
    baseUrl: env.VITE_API_URL ?? '',
    slug: env.VITE_BUSINESS_SLUG ?? 'demo',
    auth: () => {
      if (tg.initData) return `tma ${tg.initData}`;
      try {
        const token = localStorage.getItem('navbat-session');
        if (token) return `Bearer ${token}`;
      } catch {
        /* ignore */
      }
      return env.VITE_DEV_USER ? `dev ${env.VITE_DEV_USER}` : null;
    },
  });
}

export function Root({ demo, launchHash }: { demo: boolean; launchHash: string }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [version, setVersion] = useState(0);
  const [backend, setBackend] = useState<Backend | null>(demo ? null : httpBackend);
  const [bootError, setBootError] = useState<string | null>(null);
  const hash = useHashRoute();
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!demo) return;
    let alive = true;
    import('./backend/demo')
      .then((m) => m.createDemoBackend(bump))
      .then((b) => alive && setBackend(b))
      .catch((e: unknown) => {
        console.error(e);
        if (alive) setBootError(String((e as Error)?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [demo, bump]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const i18n = useMemo(
    () => ({
      lang,
      t: DICTS[lang],
      setLang: (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem('navbat-lang', l);
        } catch {
          /* ignore */
        }
      },
    }),
    [lang],
  );

  let body: React.ReactNode;
  if (bootError) {
    body = (
      <div className="boot">
        <p>Demo could not start: {bootError}</p>
      </div>
    );
  } else if (!backend) {
    body = <DemoBoot demo={demo} />;
  } else if (demo) {
    body = <DemoShell backend={backend as DemoBackend} hash={hash} launchHash={launchHash} />;
  } else if (hash.startsWith('#/admin')) {
    body = <AdminApp hash={hash} />;
  } else {
    body = <MiniApp startParam={tg.startParam} hash={launchHash || hash} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <I18nContext.Provider value={i18n}>
        <BackendContext.Provider value={backend}>
          <DataVersionContext.Provider value={version}>
            <ToastProvider>
              <Suspense fallback={<DemoBoot demo={demo} />}>{body}</Suspense>
            </ToastProvider>
          </DataVersionContext.Provider>
        </BackendContext.Provider>
      </I18nContext.Provider>
    </MotionConfig>
  );
}

const BOOT_TEXT: Record<Lang, { badge: string; boot: string }> = {
  uz: {
    badge: 'Demo rejim — hammasi brauzeringizda ishlaydi',
    boot: 'PostgreSQL brauzeringizda ishga tushmoqda…',
  },
  ru: {
    badge: 'Демо-режим — всё работает в вашем браузере',
    boot: 'PostgreSQL запускается в вашем браузере…',
  },
  en: { badge: 'Demo mode — runs entirely in your browser', boot: 'PostgreSQL is starting in your browser…' },
};

/** Shown while PGlite downloads and seeds (first visit only takes a few seconds). */
function DemoBoot({ demo }: { demo?: boolean }) {
  const text = BOOT_TEXT[initialLang()];
  return (
    <>
      {demo && (
        <header className="demo-bar">
          <span className="demo-logo">
            <span className="mini-logo">N</span>
            <span>Navbat</span>
          </span>
          <span className="demo-badge" data-testid="demo-badge">
            <span className="dot" aria-hidden />
            {text.badge}
          </span>
        </header>
      )}
      <div className="boot" data-testid="booting">
        <div className="boot-ticket" aria-hidden>
          N
        </div>
        <p className="muted">{text.boot}</p>
      </div>
    </>
  );
}
