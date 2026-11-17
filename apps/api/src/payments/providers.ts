/**
 * Payment adapters behind the core `PaymentProvider` interface. Keys come from env vars only;
 * the repository ships placeholders. The sandbox is used by the demo and by default in dev.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type PaymentIntent,
  type PaymentProvider,
  type PaymentSession,
  type ProviderId,
  SandboxProvider,
} from '@navbat/core';

export interface PaymeConfig {
  merchantId: string;
  /** Merchant API key; webhooks authenticate with Basic "Paycom:<key>". */
  key: string;
  checkoutUrl?: string;
}

export interface ClickConfig {
  serviceId: string;
  merchantId: string;
  secretKey: string;
  returnUrl?: string;
}

export interface StarsConfig {
  botToken: string;
  /** How many so'm one Telegram Star is worth when converting a deposit. */
  uzsPerStar: number;
  apiBase?: string;
}

export interface PaymentConfig {
  payme?: PaymeConfig;
  click?: ClickConfig;
  stars?: StarsConfig;
}

/** Constant-time string comparison, so webhook credentials cannot be guessed byte by byte from response timing. */
function sameSecret(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

function reference(prefix: string, bookingId: string): string {
  return `${prefix}_${bookingId.replace(/-/g, '').slice(0, 12)}_${randomUUID().slice(0, 8)}`;
}

/** so'm → tiyin (Payme works in the smallest unit). */
export const toTiyin = (uzs: number) => Math.round(uzs * 100);

export class PaymeProvider implements PaymentProvider {
  readonly id = 'payme' as const;
  constructor(private readonly config: PaymeConfig) {}

  async createPayment(intent: PaymentIntent): Promise<PaymentSession> {
    const params = `m=${this.config.merchantId};ac.booking_id=${intent.bookingId};a=${toTiyin(intent.amount)}`;
    const base = (this.config.checkoutUrl ?? 'https://checkout.paycom.uz').replace(/\/$/, '');
    return {
      provider: this.id,
      reference: reference('pm', intent.bookingId),
      payUrl: `${base}/${Buffer.from(params).toString('base64')}`,
    };
  }

  /** Validates the `Authorization: Basic base64(Paycom:<key>)` header of a webhook. */
  isAuthorized(header: string | undefined): boolean {
    if (!header?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [login, ...rest] = decoded.split(':');
    return login === 'Paycom' && sameSecret(rest.join(':'), this.config.key);
  }
}

export class ClickProvider implements PaymentProvider {
  readonly id = 'click' as const;
  constructor(private readonly config: ClickConfig) {}

  async createPayment(intent: PaymentIntent): Promise<PaymentSession> {
    const ref = reference('ck', intent.bookingId);
    const url = new URL('https://my.click.uz/services/pay');
    url.searchParams.set('service_id', this.config.serviceId);
    url.searchParams.set('merchant_id', this.config.merchantId);
    url.searchParams.set('amount', intent.amount.toFixed(2));
    url.searchParams.set('transaction_param', ref);
    if (intent.returnUrl ?? this.config.returnUrl)
      url.searchParams.set('return_url', (intent.returnUrl ?? this.config.returnUrl)!);
    return { provider: this.id, reference: ref, payUrl: url.toString() };
  }

  /**
   * md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time)
   */
  sign(fields: Record<string, string>): string {
    const parts = [
      fields.click_trans_id,
      fields.service_id,
      this.config.secretKey,
      fields.merchant_trans_id,
      ...(fields.action === '1' ? [fields.merchant_prepare_id] : []),
      fields.amount,
      fields.action,
      fields.sign_time,
    ];
    return createHash('md5')
      .update(parts.map((p) => p ?? '').join(''))
      .digest('hex');
  }

  verify(fields: Record<string, string>): boolean {
    return fields.service_id === this.config.serviceId && sameSecret(fields.sign_string, this.sign(fields));
  }
}

export class StarsProvider implements PaymentProvider {
  readonly id = 'stars' as const;
  constructor(
    private readonly config: StarsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  stars(amountUzs: number): number {
    return Math.max(1, Math.ceil(amountUzs / this.config.uzsPerStar));
  }

  async createPayment(intent: PaymentIntent): Promise<PaymentSession> {
    const ref = reference('st', intent.bookingId);
    const base = this.config.apiBase ?? 'https://api.telegram.org';
    const res = await this.fetchImpl(`${base}/bot${this.config.botToken}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Deposit',
        description: intent.description,
        payload: ref,
        currency: 'XTR',
        prices: [{ label: 'Deposit', amount: this.stars(intent.amount) }],
      }),
    });
    const body = (await res.json()) as { ok: boolean; result?: string; description?: string };
    if (!body.ok || !body.result)
      throw new Error(`createInvoiceLink failed: ${body.description ?? res.status}`);
    return { provider: this.id, reference: ref, payUrl: body.result };
  }
}

export interface PaymentRegistry {
  get(id: ProviderId): PaymentProvider | undefined;
  sandbox: SandboxProvider;
  payme?: PaymeProvider;
  click?: ClickProvider;
  stars?: StarsProvider;
}

export function createPaymentRegistry(
  config: PaymentConfig = {},
  fetchImpl: typeof fetch = fetch,
): PaymentRegistry {
  const sandbox = new SandboxProvider();
  const payme = config.payme ? new PaymeProvider(config.payme) : undefined;
  const click = config.click ? new ClickProvider(config.click) : undefined;
  const stars = config.stars ? new StarsProvider(config.stars, fetchImpl) : undefined;
  return {
    sandbox,
    payme,
    click,
    stars,
    get(id) {
      if (id === 'sandbox') return sandbox;
      if (id === 'payme') return payme;
      if (id === 'click') return click;
      if (id === 'stars') return stars;
      return undefined;
    },
  };
}
