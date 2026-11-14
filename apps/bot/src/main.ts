import { migrate } from '@navbat/db';
import { createPgDb } from '@navbat/db/node';
import type { Api } from 'grammy';
import { createBot } from './bot.js';
import { startWorker } from './worker.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const token = required('BOT_TOKEN');
const dryRun = process.env.BOT_DRY_RUN === 'true';
const { db } = createPgDb({ connectionString: required('DATABASE_URL'), max: 5 });
await migrate(db);

const ctx = { db, now: () => Date.now(), appUrl: required('WEBAPP_URL') };
const bot = createBot({
  ctx,
  token,
  businessSlug: process.env.BUSINESS_SLUG ?? 'demo',
  webAppUrl: ctx.appUrl,
});

// Dry run: no Telegram calls at all — the worker prints what it would send. Lets the whole
// stack run locally (docker compose up) without a real bot token.
const dryApi: Pick<Api, 'sendMessage'> = {
  sendMessage: (async (chatId: number, text: string) => {
    console.log(`[dry-run] → ${chatId}\n${text}\n`);
    return {
      message_id: 0,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: '' },
    };
  }) as unknown as Api['sendMessage'],
};

const stopWorker = startWorker(
  { ctx, api: dryRun ? dryApi : bot.api, webAppUrl: ctx.appUrl },
  15_000,
  process.env.HEARTBEAT_FILE,
);

const shutdown = async () => {
  stopWorker();
  if (!dryRun) await bot.stop();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (dryRun) {
  console.log('Navbat bot worker is running in DRY RUN mode (no Telegram calls)');
} else {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Navbat olish / Записаться / Book' },
    { command: 'bookings', description: 'Navbatlarim / Мои записи / My bookings' },
    { command: 'language', description: 'Til / Язык / Language' },
  ]);
  console.log('Navbat bot is running (long polling)');
  await bot.start({ allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
}
