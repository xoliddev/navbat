import type { PaymentConfig } from './payments/providers.js';

export interface Env {
  port: number;
  host: string;
  databaseUrl: string;
  botToken: string;
  sessionSecret: string;
  appUrl: string;
  corsOrigin: string[] | boolean;
  devAuth: boolean;
  seedDemo: boolean;
  production: boolean;
  payments: PaymentConfig;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = required('SESSION_SECRET', env.SESSION_SECRET);
  if (production && sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const payments: PaymentConfig = {};
  if (env.PAYME_MERCHANT_ID && env.PAYME_KEY) {
    payments.payme = { merchantId: env.PAYME_MERCHANT_ID, key: env.PAYME_KEY, checkoutUrl: env.PAYME_CHECKOUT_URL };
  }
  if (env.CLICK_SERVICE_ID && env.CLICK_MERCHANT_ID && env.CLICK_SECRET_KEY) {
    payments.click = {
      serviceId: env.CLICK_SERVICE_ID,
      merchantId: env.CLICK_MERCHANT_ID,
      secretKey: env.CLICK_SECRET_KEY,
      returnUrl: env.WEBAPP_URL,
    };
  }
  if (env.STARS_ENABLED === 'true' && env.BOT_TOKEN) {
    payments.stars = { botToken: env.BOT_TOKEN, uzsPerStar: Number(env.STARS_UZS_PER_STAR ?? 170) };
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    botToken: required('BOT_TOKEN', env.BOT_TOKEN),
    sessionSecret,
    appUrl: env.WEBAPP_URL ?? 'http://localhost:5173',
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
    devAuth: !production && env.AUTH_DEV_MODE === 'true',
    seedDemo: env.SEED_DEMO === 'true',
    production,
    payments,
  };
}
