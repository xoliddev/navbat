/**
 * Payme Merchant API (JSON-RPC) and Click SHOP API handlers. Both are thin: they find our
 * `payments` row, check amount and state, then call the shared `confirmPayment` service.
 */
import { type AppContext, confirmPayment, json } from '@navbat/db';
import { type ClickProvider, type PaymeProvider, toTiyin } from './providers.js';

type Msg = { ru: string; uz: string; en: string };
const msg = (en: string, ru: string, uz: string): Msg => ({ en, ru, uz });

export const PAYME_ERRORS = {
  auth: { code: -32504, message: msg('Insufficient privileges', 'Недостаточно привилегий', 'Ruxsat yoʻq') },
  method: { code: -32601, message: msg('Method not found', 'Метод не найден', 'Metod topilmadi') },
  parse: { code: -32700, message: msg('Parse error', 'Ошибка разбора', 'Soʻrov notoʻgʻri') },
  amount: { code: -31001, message: msg('Wrong amount', 'Неверная сумма', 'Summa notoʻgʻri') },
  notFound: { code: -31003, message: msg('Transaction not found', 'Транзакция не найдена', 'Tranzaksiya topilmadi') },
  cannot: { code: -31008, message: msg('Cannot perform operation', 'Невозможно выполнить операцию', 'Amalni bajarib boʻlmaydi') },
  account: { code: -31050, message: msg('Booking not found', 'Запись не найдена', 'Navbat topilmadi') },
  busy: { code: -31099, message: msg('Another transaction is in progress', 'Идёт другая транзакция', 'Boshqa tranzaksiya bajarilmoqda') },
} as const;

interface PaymeState {
  create_time?: number;
  perform_time?: number;
  cancel_time?: number;
  state?: number;
  reason?: number | null;
}

export interface RpcRequest {
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResult = { result: unknown } | { error: { code: number; message: Msg; data?: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handlePayme(
  ctx: AppContext,
  provider: PaymeProvider,
  authHeader: string | undefined,
  body: RpcRequest,
): Promise<RpcResult & { id: RpcRequest['id'] }> {
  const id = body?.id ?? null;
  const fail = (e: { code: number; message: Msg }, data?: string) => ({ id, error: { ...e, ...(data ? { data } : {}) } });
  if (!provider.isAuthorized(authHeader)) return fail(PAYME_ERRORS.auth);
  if (!body || typeof body.method !== 'string') return fail(PAYME_ERRORS.parse);
  const p = body.params ?? {};
  const { db } = ctx;
  const now = ctx.now();

  const byBooking = async () => {
    const bookingId = String((p.account as Record<string, unknown> | undefined)?.booking_id ?? '');
    if (!UUID.test(bookingId)) return null;
    return db
      .selectFrom('payments')
      .selectAll()
      .where('booking_id', '=', bookingId)
      .where('provider', '=', 'payme')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  };
  const byTx = () =>
    db
      .selectFrom('payments')
      .selectAll()
      .where('provider', '=', 'payme')
      .where('provider_tx_id', '=', String(p.id ?? ''))
      .executeTakeFirst();

  const validateOrder = async () => {
    const payment = await byBooking();
    if (!payment || payment.status !== 'pending') return { error: fail(PAYME_ERRORS.account, 'booking_id') };
    if (Number(p.amount) !== toTiyin(payment.amount)) return { error: fail(PAYME_ERRORS.amount) };
    return { payment };
  };

  switch (body.method) {
    case 'CheckPerformTransaction': {
      const v = await validateOrder();
      if ('error' in v) return v.error!;
      return { id, result: { allow: true } };
    }
    case 'CreateTransaction': {
      const existing = await byTx();
      if (existing) {
        const s = existing.provider_data as PaymeState;
        if (s.state !== 1) return fail(PAYME_ERRORS.cannot);
        return { id, result: { create_time: s.create_time, transaction: existing.id, state: 1 } };
      }
      const v = await validateOrder();
      if ('error' in v) return v.error!;
      if (v.payment.provider_tx_id) return fail(PAYME_ERRORS.busy);
      const state: PaymeState = { create_time: Number(p.time ?? now), state: 1 };
      await db
        .updateTable('payments')
        .set({ provider_tx_id: String(p.id), provider_data: json(state), updated_at: new Date(now) })
        .where('id', '=', v.payment.id)
        .execute();
      return { id, result: { create_time: state.create_time, transaction: v.payment.id, state: 1 } };
    }
    case 'PerformTransaction': {
      const payment = await byTx();
      if (!payment) return fail(PAYME_ERRORS.notFound);
      const s = payment.provider_data as PaymeState;
      if (s.state === 2) return { id, result: { transaction: payment.id, perform_time: s.perform_time, state: 2 } };
      if (s.state !== 1) return fail(PAYME_ERRORS.cannot);
      await confirmPayment(ctx, { reference: payment.reference, providerTxId: String(p.id) });
      const next: PaymeState = { ...s, state: 2, perform_time: now };
      await db.updateTable('payments').set({ provider_data: json(next) }).where('id', '=', payment.id).execute();
      return { id, result: { transaction: payment.id, perform_time: now, state: 2 } };
    }
    case 'CancelTransaction': {
      const payment = await byTx();
      if (!payment) return fail(PAYME_ERRORS.notFound);
      const s = payment.provider_data as PaymeState;
      if (s.state === -1 || s.state === -2) {
        return { id, result: { transaction: payment.id, cancel_time: s.cancel_time, state: s.state } };
      }
      const state = s.state === 2 ? -2 : -1;
      const next: PaymeState = { ...s, state, cancel_time: now, reason: Number(p.reason ?? 0) || null };
      await db
        .updateTable('payments')
        .set({ provider_data: json(next), status: state === -2 ? 'refunded' : 'failed', updated_at: new Date(now) })
        .where('id', '=', payment.id)
        .execute();
      if (state === -2) {
        await db.updateTable('bookings').set({ payment_status: 'refunded' }).where('id', '=', payment.booking_id).execute();
      }
      return { id, result: { transaction: payment.id, cancel_time: now, state } };
    }
    case 'CheckTransaction': {
      const payment = await byTx();
      if (!payment) return fail(PAYME_ERRORS.notFound);
      const s = payment.provider_data as PaymeState;
      return {
        id,
        result: {
          create_time: s.create_time ?? 0,
          perform_time: s.perform_time ?? 0,
          cancel_time: s.cancel_time ?? 0,
          transaction: payment.id,
          state: s.state,
          reason: s.reason ?? null,
        },
      };
    }
    default:
      return fail(PAYME_ERRORS.method);
  }
}

export interface ClickResponse {
  click_trans_id?: string;
  merchant_trans_id?: string;
  merchant_prepare_id?: string;
  merchant_confirm_id?: string;
  error: number;
  error_note: string;
}

export async function handleClick(
  ctx: AppContext,
  provider: ClickProvider,
  stage: 'prepare' | 'complete',
  fields: Record<string, string>,
): Promise<ClickResponse> {
  const base = { click_trans_id: fields.click_trans_id, merchant_trans_id: fields.merchant_trans_id };
  const err = (error: number, error_note: string): ClickResponse => ({ ...base, error, error_note });
  if (!provider.verify(fields)) return err(-1, 'SIGN CHECK FAILED!');
  if (fields.action !== (stage === 'prepare' ? '0' : '1')) return err(-3, 'Action not found');
  const payment = await ctx.db
    .selectFrom('payments')
    .selectAll()
    .where('provider', '=', 'click')
    .where('reference', '=', fields.merchant_trans_id ?? '')
    .executeTakeFirst();
  if (!payment) return err(-5, 'User does not exist');
  if (Math.abs(Number(fields.amount) - payment.amount) > 0.01) return err(-2, 'Incorrect parameter amount');
  if (payment.status === 'paid') return err(-4, 'Already paid');
  if (payment.status !== 'pending') return err(-9, 'Transaction cancelled');

  if (stage === 'prepare') {
    await ctx.db
      .updateTable('payments')
      .set({ provider_tx_id: fields.click_trans_id ?? null, updated_at: new Date(ctx.now()) })
      .where('id', '=', payment.id)
      .execute();
    return { ...base, merchant_prepare_id: payment.id, error: 0, error_note: 'Success' };
  }
  if (fields.merchant_prepare_id !== payment.id) return err(-6, 'Transaction does not exist');
  if (Number(fields.error) < 0) {
    await ctx.db.updateTable('payments').set({ status: 'failed', updated_at: new Date(ctx.now()) }).where('id', '=', payment.id).execute();
    return err(-9, 'Transaction cancelled');
  }
  await confirmPayment(ctx, { reference: payment.reference, providerTxId: fields.click_trans_id });
  return { ...base, merchant_confirm_id: payment.id, error: 0, error_note: 'Success' };
}
