import { LANGS, type Lang } from '@navbat/core';
import { useMemo, useState } from 'react';
import type { CatalogDTO } from '../backend/types';
import { LANG_LABEL, errorText, useI18n } from '../i18n';
import { useAsync, useBackend } from '../lib';
import { BookingFlow, type FlowStart } from './BookingFlow';
import { BookingDetail, BookingList } from './MyBookings';
import { MockBackButton, MockMainButton } from './TelegramChrome';

type Screen = { name: 'book'; start: FlowStart; key: number } | { name: 'list' } | { name: 'detail'; id: string };

/** Parses `startapp` payloads (`master_<id>`, `service_<id>`, `booking_<id>`) and `#/booking/<id>`. */
export function initialScreens(catalog: CatalogDTO, startParam: string | null, hash: string): Screen[] {
  const book: Screen = { name: 'book', start: { serviceIds: [], staffId: undefined, lockedStaff: false }, key: 0 };
  const fromHash = /#\/booking\/([0-9a-f-]{36})/.exec(hash)?.[1];
  if (fromHash) return [book, { name: 'list' }, { name: 'detail', id: fromHash }];
  const m = /^(master|service|booking)_([0-9a-f-]{36})$/.exec(startParam ?? '');
  if (m?.[1] === 'master' && catalog.staff.some((s) => s.id === m[2] && s.bookable)) {
    return [{ ...book, start: { serviceIds: [], staffId: m[2]!, lockedStaff: true } }];
  }
  if (m?.[1] === 'service' && catalog.services.some((s) => s.id === m[2])) {
    return [{ ...book, start: { serviceIds: [m[2]!], staffId: undefined, lockedStaff: false } }];
  }
  if (m?.[1] === 'booking') return [book, { name: 'list' }, { name: 'detail', id: m[2]! }];
  return [book];
}

export function MiniApp({ startParam, hash }: { startParam: string | null; hash: string }) {
  const backend = useBackend();
  const { t, lang, setLang } = useI18n();
  const catalog = useAsync(() => backend.catalog(), []);
  const me = useAsync(() => backend.me(), []);
  const [stack, setStack] = useState<Screen[] | null>(null);
  const screens = useMemo(
    () => stack ?? (catalog.data ? initialScreens(catalog.data, startParam, hash) : null),
    [stack, catalog.data, startParam, hash],
  );

  if (catalog.error && !catalog.data) {
    return (
      <div className="mini">
        <div className="step">
          <p className="empty-line">{errorText(t, catalog.error)}</p>
          <button type="button" className="btn" onClick={catalog.reload}>
            {t.retry}
          </button>
        </div>
      </div>
    );
  }
  if (!catalog.data || !screens) {
    return (
      <div className="mini">
        <div className="boot">
          <div className="spinner" />
        </div>
      </div>
    );
  }
  const c = catalog.data;
  const top = screens[screens.length - 1]!;
  const push = (s: Screen) => setStack([...screens, s]);
  const pop = () => setStack(screens.length > 1 ? screens.slice(0, -1) : screens);
  const toBook = () => setStack([{ name: 'book', start: { serviceIds: [], staffId: undefined, lockedStaff: false }, key: Date.now() }]);

  const changeLang = (l: Lang) => {
    setLang(l);
    void backend.patchMe({ lang: l }).catch(() => undefined);
  };

  return (
    <div className="mini" data-testid="mini-app">
      <header className="mini-head">
        <MockBackButton label={t.back} />
        <div className="mini-brand">
          <span className="mini-logo" aria-hidden>
            N
          </span>
          <span className="mini-name">{c.business.name}</span>
        </div>
        <label className="lang-pick">
          <span className="sr-only">{t.language}</span>
          <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        {top.name === 'book' && (
          <button type="button" className="icon-btn" aria-label={t.myBookings} data-testid="open-my-bookings" onClick={() => push({ name: 'list' })}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.2a2.8 2.8 0 0 0 0 5.6V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a2.8 2.8 0 0 0 0-5.6z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path d="M14.5 5v14" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" />
            </svg>
          </button>
        )}
      </header>
      <main className="mini-main">
        {top.name === 'book' && (
          <BookingFlow key={top.key} catalog={c} me={me.data} start={top.start} onOpenBookings={() => push({ name: 'list' })} />
        )}
        {top.name === 'list' && (
          <BookingList catalog={c} onOpen={(id) => push({ name: 'detail', id })} onBook={toBook} onBack={pop} />
        )}
        {top.name === 'detail' && <BookingDetail key={top.id} catalog={c} id={top.id} onBack={pop} />}
      </main>
      <MockMainButton />
    </div>
  );
}
