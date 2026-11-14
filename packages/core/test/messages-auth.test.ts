import { describe, expect, it } from 'vitest';
import {
  type BookingCard,
  formatDateLong,
  formatMoney,
  LANGS,
  langFromTelegram,
  messagesFor,
  NOTIFICATION_KINDS,
  type NotificationPayload,
  pickText,
  renderNotification,
  SandboxProvider,
  signInitData,
  signLoginWidget,
  signSession,
  TelegramAuthError,
  validateInitData,
  validateLoginWidget,
  verifySession,
  zonedToUtc,
} from '../src/index.js';

const card: BookingCard = {
  code: 'N-4K7P',
  services: ['Klassik soch olish', 'Soqol'],
  masterName: 'Jasur',
  branchName: 'Chilonzor',
  address: 'Bunyodkor 12',
  startAt: zonedToUtc('2026-11-16', 14 * 60, 'Asia/Tashkent'),
  endAt: zonedToUtc('2026-11-16', 15 * 60 + 25, 'Asia/Tashkent'),
  timeZone: 'Asia/Tashkent',
  price: 100_000,
  customerName: 'Aziz <script>',
  customerPhone: '+998901234567',
};

describe('i18n', () => {
  it('formats dates and money per language', () => {
    expect(formatDateLong('2026-11-16', 'uz')).toBe('16-noyabr, dushanba');
    expect(formatDateLong('2026-11-16', 'ru')).toBe('16 ноября, понедельник');
    expect(formatDateLong('2026-11-16', 'en')).toBe('Monday, 16 November');
    expect(formatMoney(100_000, 'uz')).toBe('100 000 soʻm');
    expect(formatMoney(1_250_000, 'en')).toBe('1,250,000 UZS');
  });

  it('maps Telegram language codes and falls back for missing translations', () => {
    expect(langFromTelegram('ru-RU')).toBe('ru');
    expect(langFromTelegram('en')).toBe('en');
    expect(langFromTelegram(undefined)).toBe('uz');
    expect(pickText({ uz: 'Soch', ru: 'Стрижка' }, 'en')).toBe('Soch');
  });
});

describe('message templates', () => {
  const payload = (kind: (typeof NOTIFICATION_KINDS)[number]): NotificationPayload =>
    kind === 'master_digest'
      ? {
          kind,
          date: '2026-11-16',
          timeZone: 'Asia/Tashkent',
          items: [
            { startAt: card.startAt, endAt: card.endAt, services: card.services, customerName: 'Aziz' },
          ],
        }
      : kind === 'admin_running_late'
        ? { kind, card, bookingId: 'b1', minutes: 10 }
        : { kind, card, bookingId: 'b1' };

  it('renders every notification kind in every language without gaps', () => {
    for (const lang of LANGS) {
      for (const kind of NOTIFICATION_KINDS) {
        const r = renderNotification(payload(kind), lang, 'https://t.me/app');
        expect(r.text.length, `${lang}/${kind}`).toBeGreaterThan(20);
        expect(r.text).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });

  it('includes time, master and code in confirmations', () => {
    const text = messagesFor('uz').bookingConfirmed(card);
    expect(text).toContain('14:00–15:25');
    expect(text).toContain('Jasur');
    expect(text).toContain('N-4K7P');
  });

  it('escapes HTML in user-provided names', () => {
    const text = messagesFor('en').adminNewBooking(card);
    expect(text).toContain('Aziz &lt;script&gt;');
    expect(text).toContain('+998 90 123 45 67');
  });

  it('adds running-late and cancel buttons to the 2h reminder', () => {
    const r = renderNotification(payload('reminder_2h'), 'ru', 'https://t.me/app');
    const callbacks = r.buttons.flat().flatMap((b) => ('callback' in b ? [b.callback] : []));
    expect(callbacks).toEqual(['late:b1:10', 'late:b1:20', 'cancel:b1']);
  });

  it('summarises the master digest', () => {
    const items = [
      { startAt: card.startAt, endAt: card.endAt, services: card.services, customerName: 'Aziz' },
    ];
    const text = messagesFor('en').masterDigest('2026-11-16', 'Asia/Tashkent', items);
    expect(text).toContain('Total: 1 client(s), 1 h 25 min');
    expect(messagesFor('uz').masterDigest('2026-11-16', 'Asia/Tashkent', [])).toContain(
      'yozilgan mijoz yoʻq',
    );
  });
});

describe('telegram auth', () => {
  const token = '123456:TEST-token-not-real';
  const user = { id: 42, first_name: 'Aziz', language_code: 'uz' };

  it('accepts correctly signed initData', async () => {
    const initData = await signInitData({ user, startParam: 'master_abc' }, token);
    const res = await validateInitData(initData, token);
    expect(res.user.id).toBe(42);
    expect(res.startParam).toBe('master_abc');
  });

  it('rejects tampered, foreign and expired initData', async () => {
    const initData = await signInitData({ user }, token);
    const tampered = initData.replace('Aziz', 'Admin');
    await expect(validateInitData(tampered, token)).rejects.toThrow(TelegramAuthError);
    await expect(validateInitData(initData, '999:other')).rejects.toMatchObject({ reason: 'BAD_HASH' });
    const old = await signInitData({ user, authDate: 1_000_000 }, token);
    await expect(validateInitData(old, token)).rejects.toMatchObject({ reason: 'EXPIRED' });
    await expect(validateInitData('user=%7B%7D', token)).rejects.toMatchObject({ reason: 'MISSING_HASH' });
  });

  it('validates the Login Widget payload', async () => {
    const signed = await signLoginWidget({ ...user, auth_date: Math.floor(Date.now() / 1000) }, token);
    expect((await validateLoginWidget(signed, token)).id).toBe(42);
    await expect(validateLoginWidget({ ...signed, id: 43 }, token)).rejects.toThrow(TelegramAuthError);
  });

  it('signs and verifies session tokens', async () => {
    const t = await signSession(
      { sub: 'staff-1', role: 'owner', exp: Math.floor(Date.now() / 1000) + 60 },
      's3cret',
    );
    expect(await verifySession(t, 's3cret')).toMatchObject({ sub: 'staff-1' });
    expect(await verifySession(t, 'other')).toBeNull();
    expect(await verifySession(`${t}x`, 's3cret')).toBeNull();
    const expired = await signSession({ sub: 'x', exp: 1 }, 's3cret');
    expect(await verifySession(expired, 's3cret')).toBeNull();
  });
});

describe('sandbox payments', () => {
  it('creates a session and completes it once', async () => {
    const p = new SandboxProvider();
    const s = await p.createPayment({
      bookingId: 'booking-123',
      amount: 30_000,
      currency: 'UZS',
      description: 'Deposit',
    });
    expect(s.payUrl).toMatch(/^sandbox:\/\//);
    expect(p.complete(s.reference)).toMatchObject({ type: 'paid', bookingId: 'booking-123', amount: 30_000 });
    expect(p.complete(s.reference)).toEqual({ type: 'ignored' });
  });
});
