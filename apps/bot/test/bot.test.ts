import { addDays, todayIn, zonedToUtc } from '@navbat/core';
import {
  type AppContext,
  createBooking,
  DEMO_IDS,
  DEMO_TZ,
  listNotifications,
  migrate,
  seedDemo,
  setBookingStatus,
} from '@navbat/db';
import { createPGlite, kyselyFromPGlite } from '@navbat/db/pglite';
import { GrammyError } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appLink, createBot } from '../src/bot.js';
import { processDueNotifications, queueDigests } from '../src/worker.js';

const NOW = zonedToUtc('2026-11-12', 8 * 60, DEMO_TZ);
const at = (d: number, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return zonedToUtc(addDays(todayIn(DEMO_TZ, NOW), d), h * 60 + m, DEMO_TZ);
};

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true as const,
  first_name: 'Navbat',
  username: 'navbat_demo_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

async function setup() {
  const pg = await createPGlite();
  const db = kyselyFromPGlite(pg);
  await migrate(db);
  const seed = await seedDemo(db, { now: NOW, history: false });
  let now = NOW;
  const ctx: AppContext = { db, now: () => now, appUrl: 'https://example.test/app' };
  const bot = createBot({
    ctx,
    token: '1:TEST',
    businessSlug: 'demo',
    webAppUrl: 'https://example.test/app',
    botInfo: BOT_INFO,
  });
  const calls: Call[] = [];
  let failNext: { code: number; description: string } | null = null;
  // Mocked Telegram Bot API: record every call, answer like Telegram would.
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (failNext) {
      const f = failNext;
      failNext = null;
      return { ok: false, error_code: f.code, description: f.description } as never;
    }
    const result =
      method === 'sendMessage'
        ? {
            message_id: calls.length,
            date: 0,
            chat: { id: (payload as { chat_id: number }).chat_id, type: 'private' },
            text: '',
          }
        : true;
    return { ok: true, result } as never;
  });
  let updateId = 1;
  const from = (id: number, lang = 'uz') => ({ id, is_bot: false, first_name: 'Akmal', language_code: lang });
  const message = (id: number, text: string, lang?: string): Update => ({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(now / 1000),
      chat: { id, type: 'private', first_name: 'Akmal' },
      from: from(id, lang),
      text,
      ...(text.startsWith('/')
        ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] }
        : {}),
    },
  });
  const callback = (id: number, data: string): Update => ({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: from(id),
      chat_instance: '1',
      data,
      message: { message_id: 99, date: 0, chat: { id, type: 'private', first_name: 'Akmal' }, text: 'x' },
    },
  });
  return {
    db,
    ctx,
    seed,
    bot,
    calls,
    send: (u: Update) => bot.handleUpdate(u),
    message,
    callback,
    setNow: (t: number) => {
      now = t;
    },
    failNext: (code: number, description: string) => {
      failNext = { code, description };
    },
    sent: () => calls.filter((c) => c.method === 'sendMessage'),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.db.destroy();
});

async function book(e: Env, day = 2, hm = '11:00') {
  return (
    await createBooking(e.ctx, {
      businessId: e.seed.businessId,
      serviceIds: [e.seed.serviceIds.classic!],
      staffId: e.seed.staffIds.masters[0]!,
      start: at(day, hm),
      actor: { kind: 'customer', customerId: e.seed.visitorCustomerId },
      customer: { name: 'Akmal Demo' },
    })
  ).booking;
}

describe('commands', () => {
  it('/start asks a new user for a language, then greets with a Mini App button', async () => {
    await env.send(env.message(555, '/start master_abc', 'ru'));
    const ask = env.sent()[0]!;
    expect(ask.payload.text).toContain('Choose a language');
    const kb = (ask.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] })
      .inline_keyboard;
    expect(kb[0]!.map((b) => b.callback_data)).toEqual([
      'lang:uz:master_abc',
      'lang:ru:master_abc',
      'lang:en:master_abc',
    ]);

    await env.send(env.callback(555, 'lang:ru:master_abc'));
    expect(env.calls.find((c) => c.method === 'editMessageText')!.payload.text).toBe(
      'Язык сохранён: русский.',
    );
    const welcome = env.sent().at(-1)!;
    expect(welcome.payload.text).toContain('Demo Barbershop');
    const button = (welcome.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] })
      .inline_keyboard[0]![0]!;
    expect(button.web_app!.url).toBe('https://example.test/app?startapp=master_abc');
  });

  it('/start greets a returning user in their language right away', async () => {
    await env.send(env.message(DEMO_IDS.visitor, '/start'));
    expect(env.sent()).toHaveLength(1);
    expect(env.sent()[0]!.payload.text).toContain('Assalomu alaykum');
  });

  it('/bookings lists upcoming bookings with manage and cancel buttons', async () => {
    await env.send(env.message(DEMO_IDS.visitor, '/bookings'));
    expect(env.sent()[0]!.payload.text).toContain('faol navbatingiz yoʻq');
    const b = await book(env);
    await env.send(env.message(DEMO_IDS.visitor, '/bookings'));
    const msg = env.sent().at(-1)!;
    expect(msg.payload.text).toContain('Jasur Aminov');
    const kb = (msg.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] })
      .inline_keyboard;
    expect(kb[0]![1]!.callback_data).toBe(`cancel:${b.id}`);
  });

  it('/language shows the picker and /help lists commands', async () => {
    await env.send(env.message(DEMO_IDS.visitor, '/language'));
    await env.send(env.message(DEMO_IDS.visitor, '/help'));
    expect(env.sent().map((c) => c.payload.text)).toEqual([
      'Tilni tanlang · Выберите язык · Choose a language',
      expect.stringContaining('/bookings'),
    ]);
  });
});

describe('inline actions', () => {
  it('cancels a booking after confirmation', async () => {
    const b = await book(env);
    await env.send(env.callback(DEMO_IDS.visitor, `cancel:${b.id}`));
    expect(env.sent().at(-1)!.payload.text).toContain('Rostdan ham bekor qilasizmi?');
    await env.send(env.callback(DEMO_IDS.visitor, `cancel_yes:${b.id}`));
    const status = await env.db
      .selectFrom('bookings')
      .select('status')
      .where('id', '=', b.id)
      .executeTakeFirstOrThrow();
    expect(status.status).toBe('cancelled');
    const jobs = await listNotifications(env.db, env.seed.businessId);
    expect(jobs.some((j) => j.kind === 'booking_cancelled')).toBe(true);
  });

  it('refuses to cancel inside the policy window with an alert', async () => {
    const b = await book(env, 1, '10:00');
    env.setNow(at(1, '09:00'));
    await env.send(env.callback(DEMO_IDS.visitor, `cancel_yes:${b.id}`));
    const alert = env.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
    expect(alert.payload).toMatchObject({ show_alert: true, text: expect.stringContaining('muddati oʻtib') });
  });

  it('"running late" notifies the master and the front desk', async () => {
    const b = await book(env, 1, '10:00');
    env.setNow(at(1, '09:00'));
    await env.send(env.callback(DEMO_IDS.visitor, `late:${b.id}:10`));
    const answer = env.calls.find((c) => c.method === 'answerCallbackQuery')!;
    expect(answer.payload.text).toContain('10 daqiqa');
    const late = (await listNotifications(env.db, env.seed.businessId)).filter(
      (j) => j.kind === 'admin_running_late',
    );
    expect(late.map((j) => j.chatId).sort()).toEqual(
      [DEMO_IDS.owner, DEMO_IDS.admin, DEMO_IDS.masters[0]].sort(),
    );
  });

  it('rates a completed visit from the review request', async () => {
    const b = await book(env, 1, '10:00');
    env.setNow(at(1, '11:00'));
    await setBookingStatus(env.ctx, {
      businessId: env.seed.businessId,
      bookingId: b.id,
      event: 'complete',
      actor: { kind: 'staff', staffId: env.seed.staffIds.owner, role: 'owner' },
    });
    await env.send(env.callback(DEMO_IDS.visitor, `rate:${b.id}:5`));
    expect(env.calls.find((c) => c.method === 'editMessageText')!.payload.text).toContain('★★★★★');
    const review = await env.db
      .selectFrom('reviews')
      .select('rating')
      .where('booking_id', '=', b.id)
      .executeTakeFirst();
    expect(review?.rating).toBe(5);
  });
});

describe('notification worker', () => {
  it('sends confirmations and staff alerts, then reminders when due', async () => {
    await book(env, 2, '11:00');
    const first = await processDueNotifications({
      ctx: env.ctx,
      api: env.bot.api,
      webAppUrl: 'https://example.test/app',
    });
    expect(first).toEqual({ sent: 4, failed: 0, skipped: 0 });
    const toVisitor = env.sent().filter((c) => c.payload.chat_id === DEMO_IDS.visitor);
    expect(toVisitor[0]!.payload.text).toContain('Navbat tasdiqlandi');
    expect(toVisitor[0]!.payload.parse_mode).toBe('HTML');

    env.setNow(at(2, '09:00'));
    const second = await processDueNotifications({
      ctx: env.ctx,
      api: env.bot.api,
      webAppUrl: 'https://example.test/app',
    });
    expect(second.sent).toBe(2); // 24h and 2h reminders
    const reminder = env.sent().at(-1)!;
    expect(reminder.payload.text).toContain('2 soatdan keyin');
    const kb = (reminder.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] })
      .inline_keyboard;
    expect(kb.flat().map((b) => b.callback_data)).toEqual([
      expect.stringMatching(/^late:.+:10$/),
      expect.stringMatching(/^late:.+:20$/),
      expect.stringMatching(/^cancel:/),
    ]);
  });

  it('skips reminders of cancelled bookings and retries transient failures', async () => {
    const b = await book(env, 2, '11:00');
    await env.db.updateTable('bookings').set({ status: 'cancelled' }).where('id', '=', b.id).execute();
    env.failNext(429, 'Too Many Requests: retry after 1');
    const r = await processDueNotifications({
      ctx: env.ctx,
      api: env.bot.api,
      webAppUrl: 'https://example.test/app',
    });
    expect(r.failed).toBe(1);
    env.setNow(at(2, '09:30'));
    const later = await processDueNotifications({
      ctx: env.ctx,
      api: env.bot.api,
      webAppUrl: 'https://example.test/app',
    });
    expect(later.skipped).toBe(2); // both reminders: booking is no longer upcoming
    expect(later.sent).toBe(1); // the retried message
  });

  it('marks blocked chats as permanently failed', async () => {
    await book(env, 2, '11:00');
    env.failNext(403, 'Forbidden: bot was blocked by the user');
    await processDueNotifications({ ctx: env.ctx, api: env.bot.api, webAppUrl: 'https://example.test/app' });
    const failed = await env.db
      .selectFrom('notification_jobs')
      .select(['status', 'last_error'])
      .where('status', '=', 'failed')
      .execute();
    expect(failed).toHaveLength(1);
    expect(failed[0]!.last_error).toContain('blocked');
  });

  it('sends each master a morning digest once', async () => {
    await book(env, 0, '15:00');
    env.setNow(at(0, '08:01'));
    expect(await queueDigests(env.ctx)).toBe(4);
    expect(await queueDigests(env.ctx)).toBe(0);
    await processDueNotifications({ ctx: env.ctx, api: env.bot.api, webAppUrl: 'https://example.test/app' });
    const digest = env
      .sent()
      .find(
        (c) => c.payload.chat_id === DEMO_IDS.masters[0] && String(c.payload.text).includes('Bugungi jadval'),
      );
    expect(digest!.payload.text).toContain('15:00–15:45');
  });
});

describe('helpers', () => {
  it('builds Mini App deep links and ignores unsafe payloads', () => {
    expect(appLink('https://x.test/app', 'service_12')).toBe('https://x.test/app?startapp=service_12');
    expect(appLink('https://x.test/app', 'bad payload!')).toBe('https://x.test/app');
  });

  it('GrammyError is what the API layer throws for failures', () => {
    expect(
      new GrammyError('x', { ok: false, error_code: 403, description: 'd' }, 'sendMessage', {}).error_code,
    ).toBe(403);
  });
});
