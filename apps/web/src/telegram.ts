/**
 * Thin bridge over Telegram.WebApp. Outside Telegram (browser, demo, tests) a mock with the
 * same surface is used: MainButton/BackButton are rendered by <TelegramChrome/>, haptics map
 * to navigator.vibrate, theme follows prefers-color-scheme.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

interface TgButton {
  setParams(p: { text?: string; is_active?: boolean; is_visible?: boolean; color?: string; text_color?: string }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  show(): void;
  hide(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; language_code?: string }; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string | undefined>;
  platform: string;
  ready(): void;
  expand(): void;
  MainButton: TgButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  onEvent(event: string, cb: () => void): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

function realWebApp(): TgWebApp | null {
  const w = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  return w && w.initData ? w : null;
}

export const tg = {
  get app() {
    return realWebApp();
  },
  get inTelegram() {
    return realWebApp() !== null;
  },
  get initData() {
    return realWebApp()?.initData ?? '';
  },
  get startParam(): string | null {
    const fromTg = realWebApp()?.initDataUnsafe.start_param;
    if (fromTg) return fromTg;
    try {
      return new URLSearchParams(window.location.search).get('startapp');
    } catch {
      return null;
    }
  },
  get languageCode(): string | undefined {
    return realWebApp()?.initDataUnsafe.user?.language_code ?? navigator.language;
  },
  ready() {
    const w = realWebApp();
    if (w) {
      w.ready();
      w.expand();
      w.onEvent('themeChanged', () => applyTheme());
    }
    applyTheme();
  },
  haptic(kind: 'light' | 'medium' | 'success' | 'error' | 'select') {
    const h = realWebApp()?.HapticFeedback;
    if (h) {
      if (kind === 'success' || kind === 'error') h.notificationOccurred(kind);
      else if (kind === 'select') h.selectionChanged();
      else h.impactOccurred(kind);
      return;
    }
    try {
      navigator.vibrate?.(kind === 'error' ? [30, 40, 30] : kind === 'success' ? 18 : 8);
    } catch {
      /* not supported */
    }
  },
};

/* ---------- theme ---------- */

let forcedScheme: 'light' | 'dark' | null = null;

export function setForcedScheme(s: 'light' | 'dark' | null) {
  forcedScheme = s;
  applyTheme();
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = Number.parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function applyTheme() {
  const root = document.documentElement;
  const w = realWebApp();
  const vars: Record<string, string | undefined> = {};
  let scheme: 'light' | 'dark';
  if (w) {
    const p = w.themeParams;
    scheme = p.bg_color ? (luminance(p.bg_color) < 0.5 ? 'dark' : 'light') : w.colorScheme;
    vars['--bg'] = p.secondary_bg_color ?? p.bg_color;
    vars['--surface'] = p.section_bg_color ?? p.bg_color;
    vars['--surface-2'] = p.secondary_bg_color;
    vars['--text'] = p.text_color;
    vars['--muted'] = p.hint_color ?? p.subtitle_text_color;
    vars['--accent'] = p.button_color;
    vars['--accent-text'] = p.button_text_color;
  } else {
    scheme = forcedScheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  root.dataset.theme = scheme;
  for (const [k, v] of Object.entries(vars)) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
}

/* ---------- MainButton / BackButton ---------- */

export interface MainButtonState {
  text: string;
  visible: boolean;
  disabled: boolean;
  progress: boolean;
  onClick: (() => void) | null;
}

let mainState: MainButtonState = { text: '', visible: false, disabled: false, progress: false, onClick: null };
let backHandler: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useMockChrome() {
  const main = useSyncExternalStore(subscribe, () => mainState);
  const back = useSyncExternalStore(subscribe, () => backHandler);
  return { main, back };
}

/** Declarative MainButton: native in Telegram, rendered by TelegramChrome elsewhere. */
export function useMainButton(opts: { text: string; visible?: boolean; disabled?: boolean; progress?: boolean; onClick: () => void }) {
  const cb = useRef(opts.onClick);
  cb.current = opts.onClick;
  const visible = opts.visible ?? true;
  const disabled = !!opts.disabled;
  const progress = !!opts.progress;
  useEffect(() => {
    const w = realWebApp();
    const handler = () => {
      if (!disabled && !progress) cb.current();
    };
    if (w) {
      w.MainButton.setParams({ text: opts.text, is_active: !disabled, is_visible: visible });
      if (progress) w.MainButton.showProgress(false);
      else w.MainButton.hideProgress();
      w.MainButton.onClick(handler);
      return () => {
        w.MainButton.offClick(handler);
        w.MainButton.hide();
      };
    }
    mainState = { text: opts.text, visible, disabled, progress, onClick: handler };
    emit();
    return () => {
      mainState = { ...mainState, visible: false, onClick: null };
      emit();
    };
  }, [opts.text, visible, disabled, progress]);
}

export function useBackButton(handler: (() => void) | null) {
  const cb = useRef(handler);
  cb.current = handler;
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    const w = realWebApp();
    const h = () => cb.current?.();
    if (w) {
      w.BackButton.onClick(h);
      w.BackButton.show();
      return () => {
        w.BackButton.offClick(h);
        w.BackButton.hide();
      };
    }
    backHandler = h;
    emit();
    return () => {
      if (backHandler === h) backHandler = null;
      emit();
    };
  }, [active]);
}

/** Loads telegram-web-app.js only when the page was opened from Telegram. */
export async function loadTelegramScript(): Promise<void> {
  const hash = window.location.hash;
  const looksLikeTelegram = /tgWebAppData|tgWebAppVersion/.test(hash) || /tgWebApp/.test(window.location.search);
  if (!looksLikeTelegram) return;
  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}
