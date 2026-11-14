/**
 * Pluggable prepayment providers. The booking service only talks to this interface;
 * Payme, Click and Telegram Stars adapters live in apps/api, the sandbox lives here so the
 * browser demo can use it.
 */

export type ProviderId = 'sandbox' | 'payme' | 'click' | 'stars';

export interface PaymentIntent {
  bookingId: string;
  /** Amount in so'm (UZS) or in Stars when provider = stars. */
  amount: number;
  currency: 'UZS' | 'XTR';
  description: string;
  returnUrl?: string;
}

export interface PaymentSession {
  provider: ProviderId;
  /** Our payment id / provider reference used to match webhooks. */
  reference: string;
  /** Where to send the customer (checkout page or Telegram invoice link). */
  payUrl: string;
}

export type PaymentEvent =
  | { type: 'paid'; reference: string; bookingId: string; amount: number; providerTxId?: string }
  | { type: 'failed'; reference: string; bookingId: string; reason: string }
  | { type: 'ignored' };

export interface PaymentProvider {
  readonly id: ProviderId;
  createPayment(intent: PaymentIntent): Promise<PaymentSession>;
}

/**
 * Sandbox provider: no network, no keys. A "payment" succeeds when `complete()` is called,
 * which the demo does after the customer taps "Pay" on a fake checkout sheet.
 */
export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox' as const;
  private readonly sessions = new Map<string, PaymentIntent>();
  private counter = 0;

  async createPayment(intent: PaymentIntent): Promise<PaymentSession> {
    this.counter += 1;
    const reference = `sbx_${intent.bookingId.slice(0, 8)}_${this.counter}`;
    this.sessions.set(reference, intent);
    return { provider: this.id, reference, payUrl: `sandbox://checkout/${reference}` };
  }

  complete(reference: string, outcome: 'paid' | 'failed' = 'paid'): PaymentEvent {
    const intent = this.sessions.get(reference);
    if (!intent) return { type: 'ignored' };
    this.sessions.delete(reference);
    return outcome === 'paid'
      ? { type: 'paid', reference, bookingId: intent.bookingId, amount: intent.amount }
      : { type: 'failed', reference, bookingId: intent.bookingId, reason: 'declined in sandbox' };
  }
}
