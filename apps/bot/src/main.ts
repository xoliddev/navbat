import { migrate } from '@navbat/db';
import { createPgDb } from '@navbat/db/node';
import { createBot } from './bot.js';
import { startWorker } from './worker.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const token = required('BOT_TOKEN');
const { db } = createPgDb({ connectionString: required('DATABASE_URL'), max: 5 });
await migrate(db);

const ctx = { db, now: () => Date.now(), appUrl: required('WEBAPP_URL') };
const bot = createBot({
  ctx,
  token,
  businessSlug: process.env.BUSINESS_SLUG ?? 'demo',
  webAppUrl: ctx.appUrl,
});

await bot.api.setMyCommands([
  { command: 'start', description: 'Navbat olish / Записаться / Book' },
  { command: 'bookings', description: 'Navbatlarim / Мои записи / My bookings' },
  { command: 'language', description: 'Til / Язык / Language' },
]);

const stopWorker = startWorker({ ctx, api: bot.api, webAppUrl: ctx.appUrl });

const shutdown = async () => {
  stopWorker();
  await bot.stop();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('Navbat bot is running (long polling)');
await bot.start({ allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
