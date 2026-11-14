import { DEMO_SLUG, migrate, seedDemo } from '@navbat/db';
import { createPgDb } from '@navbat/db/node';
import { buildApp } from './app.js';
import { readEnv } from './env.js';

const env = readEnv();
const { db } = createPgDb({ connectionString: env.databaseUrl });

const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

if (env.seedDemo) {
  const existing = await db
    .selectFrom('businesses')
    .select('id')
    .where('slug', '=', DEMO_SLUG)
    .executeTakeFirst();
  if (!existing) {
    await seedDemo(db, { now: Date.now(), depositPercent: 0 });
    console.log('Seeded "Demo Barbershop" (slug: demo)');
  }
}

const app = await buildApp({
  db,
  botToken: env.botToken,
  sessionSecret: env.sessionSecret,
  appUrl: env.appUrl,
  devAuth: env.devAuth,
  payments: env.payments,
  corsOrigin: env.corsOrigin,
  logger: true,
});

if (env.devAuth) app.log.warn('AUTH_DEV_MODE is on: "Authorization: dev <telegramId>" is accepted');

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: env.port, host: env.host });
