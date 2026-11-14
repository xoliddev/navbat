import { formatMoney } from '@navbat/core';
import { useState } from 'react';
import type { BookingDTO, CreatedBookingDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { Sheet, useBackend, useToast } from '../lib';
import { tg } from '../telegram';

/**
 * Checkout step. The sandbox provider completes in-app; real providers (Payme, Click) return a
 * checkout URL and Telegram Stars an invoice link — both open outside the Mini App.
 */
export function PaymentSheet({
  open,
  onClose,
  payment,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  payment: NonNullable<CreatedBookingDTO['payment']>;
  onPaid: (b: BookingDTO) => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const sandbox = payment.payUrl.startsWith('sandbox://');

  const pay = async () => {
    if (!sandbox) {
      window.open(payment.payUrl, '_blank', 'noopener');
      return;
    }
    setBusy(true);
    try {
      const b = await backend.completeSandboxPayment(payment.reference);
      tg.haptic('success');
      if (b) onPaid(b);
      toast(t.paid);
    } catch (e) {
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t.checkoutTitle}>
      <div className="checkout">
        <div className="checkout-amount num">{formatMoney(payment.amount, lang)}</div>
        <div className="checkout-providers" aria-hidden>
          <span className="on">Sandbox</span>
          <span>Payme</span>
          <span>Click</span>
          <span>Stars</span>
        </div>
        <p className="fine">{t.checkoutHint}</p>
        <button type="button" className="btn block" data-testid="sandbox-pay" disabled={busy} onClick={pay}>
          {busy ? <span className="spinner light" /> : `${t.pay} ${formatMoney(payment.amount, lang)}`}
        </button>
      </div>
    </Sheet>
  );
}
