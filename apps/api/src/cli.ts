/** `node dist/cli.js migrate|seed` — database maintenance without starting the server. */
import { DEMO_SLUG, migrate, seedDemo } from '@navbat/db';
import { createPgDb } from '@navbat/db/node';

const command = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const { db } = createPgDb({ connectionString: url, max: 2 });

try {
  if (command === 'migrate') {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } else if (command === 'seed') {
    await migrate(db);
    const existing = await db.selectFrom('businesses').select('id').where('slug', '=', DEMO_SLUG).executeTakeFirst();
    if (existing) console.log('Demo business already exists, nothing to do');
    else {
      const res = await seedDemo(db, { now: Date.now(), depositPercent: Number(process.env.DEMO_DEPOSIT_PERCENT ?? 0) });
      console.log(`Seeded Demo Barbershop (${res.businessId})`);
    }
  } else {
    console.error('Usage: cli.ts migrate|seed');
    process.exitCode = 1;
  }
} finally {
  await db.destroy();
}
