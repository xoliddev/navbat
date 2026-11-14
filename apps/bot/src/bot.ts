/**
 * Telegram bot: onboarding, language, "my bookings", inline cancel / running late / rating,
 * and Telegram Stars payments. All business rules live in @navbat/core and @navbat/db —
 * handlers only translate Telegram updates into service calls.
 */
import { type ButtonSpec, DomainError, isDomainError, isLang, type Lang, messagesFor } from '@navbat/core';
import {
  type AppContext,
  type BusinessDTO,
  cancelBooking,
  confirmPayment,
  customerFromTelegram,
  getBookingFor,
  getBusiness,
  leaveReview,
  listCustomerBookings,
  reportRunningLate,
  setCustomerLang,
  toCard,
} from '@navbat/db';
import { Bot, type Context, InlineKeyboard } from 'grammy';
import type { InlineKeyboardButton, UserFromGetMe } from 'grammy/types';

export interface BotDeps {
  ctx: AppContext;
  token: string;
  businessSlug: string;
  /** Public URL of the Mini App (used for web_app buttons). */
  webAppUrl: string;
  /** Pre-fetched bot info (tests pass a stub so no getMe call is made). */
  botInfo?: UserFromGetMe;
}

export function keyboard(rows: ButtonSpec[][]): InlineKeyboard {
  return InlineKeyboard.from(
    rows.map((row) =>
      row.map((b): InlineKeyboardButton => {
        if ('callback' in b) return { text: b.text, callback_data: b.callback };
        if ('webApp' in b) return { text: b.text, web_app: { url: b.webApp } };
        return { text: b.text, url: b.url };
      }),
    ),
  );
}

/** Mini App URL carrying a deep-link payload such as `master_<id>` or `service_<id>`. */
export function appLink(base: string, startParam?: string): string {
  if (!startParam || !/^[A-Za-z0-9_-]{1,64}$/.test(startParam)) return base;
  const url = new URL(base);
  url.searchParams.set('startapp', startParam);
  return url.toString();
}

const LANG_KEYBOARD = new InlineKeyboard()
  .text('Oʻzbekcha', 'lang:uz')
  .text('Русский', 'lang:ru')
  .text('English', 'lang:en');

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  const { ctx: app } = deps;
  let cachedBusiness: BusinessDTO | undefined;
  const business = async () => {
    cachedBusiness ??= await getBusiness(app.db, deps.businessSlug);
    return cachedBusiness;
  };

  async function identify(ctx: Context) {
    if (!ctx.from) throw new DomainError('UNAUTHORIZED');
    const b = await business();
    const customer = await customerFromTelegram(app.db, b.id, ctx.from);
    return { b, customer, actor: { kind: 'customer' as const, customerId: customer.customerId } };
  }

  async function sendWelcome(ctx: Context, lang: Lang, startParam?: string) {
    const b = await business();
    const m = messagesFor(lang);
    await ctx.reply(m.welcome(ctx.from?.first_name ?? '', b.name), {
      parse_mode: 'HTML',
      reply_markup: keyboard([
        [{ text: m.buttons.book, webApp: appLink(deps.webAppUrl, startParam) }],
        [{ text: m.buttons.myBookings, callback: 'my' }],
      ]),
    });
  }

  async function sendBookings(ctx: Context) {
    const { b, customer } = await identify(ctx);
    const m = messagesFor(customer.lang);
    const now = app.now();
    const upcoming = (await listCustomerBookings(app.db, b.id, customer.customerId))
      .filter((x) => (x.status === 'confirmed' || x.status === 'pending') && x.endAt > now)
      .sort((x, y) => x.startAt - y.startAt);
    if (upcoming.length === 0) {
      await ctx.reply(m.noUpcoming, {
        reply_markup: keyboard([[{ text: m.buttons.book, webApp: deps.webAppUrl }]]),
      });
      return;
    }
    const lines = upcoming.map((x, i) => `${i + 1}. ${m.upcomingLine(toCard(x, customer.lang, b.timezone))}`);
    await ctx.reply(`${m.upcomingHeader}\n\n${lines.join('\n\n')}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard(
        upcoming.map((x, i) => [
          { text: `${i + 1}. ${m.buttons.manage}`, webApp: `${deps.webAppUrl}#/booking/${x.id}` },
          { text: m.buttons.cancel, callback: `cancel:${x.id}` },
        ]),
      ),
    });
  }

  bot.command('start', async (ctx) => {
    const { customer } = await identify(ctx);
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (customer.isNew) {
      await ctx.reply(messagesFor(customer.lang).chooseLanguage, {
        reply_markup: payload
          ? new InlineKeyboard()
              .text('Oʻzbekcha', `lang:uz:${payload}`)
              .text('Русский', `lang:ru:${payload}`)
              .text('English', `lang:en:${payload}`)
          : LANG_KEYBOARD,
      });
      return;
    }
    await sendWelcome(ctx, customer.lang, payload || undefined);
  });

  bot.command('language', async (ctx) => {
    const { customer } = await identify(ctx);
    await ctx.reply(messagesFor(customer.lang).chooseLanguage, { reply_markup: LANG_KEYBOARD });
  });

  bot.command(['bookings', 'mybookings'], sendBookings);

  bot.command('help', async (ctx) => {
    const { customer } = await identify(ctx);
    await ctx.reply(messagesFor(customer.lang).help);
  });

  bot.callbackQuery(/^lang:(uz|ru|en)(?::([A-Za-z0-9_-]{1,64}))?$/, async (ctx) => {
    const lang = ctx.match[1];
    if (!isLang(lang) || !ctx.from) return;
    const b = await business();
    await customerFromTelegram(app.db, b.id, ctx.from);
    await setCustomerLang(app.db, b.id, ctx.from.id, lang);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(messagesFor(lang).languageSaved);
    await sendWelcome(ctx, lang, ctx.match[2]);
  });

  bot.callbackQuery('my', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendBookings(ctx);
  });

  bot.callbackQuery(/^cancel:([0-9a-f-]{36})$/, async (ctx) => {
    const { b, customer, actor } = await identify(ctx);
    const booking = await getBookingFor(app.db, b.id, ctx.match[1]!, actor);
    const m = messagesFor(customer.lang);
    await ctx.answerCallbackQuery();
    await ctx.reply(m.cancelPrompt(toCard(booking, customer.lang, b.timezone)), {
      parse_mode: 'HTML',
      reply_markup: keyboard([
        [
          { text: m.buttons.confirmCancel, callback: `cancel_yes:${booking.id}` },
          { text: m.buttons.keep, callback: 'cancel_no' },
        ],
      ]),
    });
  });

  bot.callbackQuery(/^cancel_yes:([0-9a-f-]{36})$/, async (ctx) => {
    const { b, customer, actor } = await identify(ctx);
    const m = messagesFor(customer.lang);
    try {
      await cancelBooking(app, {
        businessId: b.id,
        bookingId: ctx.match[1]!,
        actor,
        reason: 'Cancelled in the bot',
      });
      await ctx.answerCallbackQuery();
      // The confirmation text itself comes from the outbox (booking_cancelled), so just tidy up.
      await ctx.deleteMessage().catch(() => undefined);
    } catch (e) {
      if (isDomainError(e) && e.code === 'CANCEL_WINDOW_PASSED') {
        await ctx.answerCallbackQuery({ text: m.cancelTooLate, show_alert: true });
        return;
      }
      throw e;
    }
  });

  bot.callbackQuery('cancel_no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });

  bot.callbackQuery(/^late:([0-9a-f-]{36}):(\d{1,2})$/, async (ctx) => {
    const { b, customer, actor } = await identify(ctx);
    const minutes = Number(ctx.match[2]);
    await reportRunningLate(app, { businessId: b.id, bookingId: ctx.match[1]!, minutes, actor });
    await ctx.answerCallbackQuery({ text: messagesFor(customer.lang).lateAck(minutes) });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  });

  bot.callbackQuery(/^rate:([0-9a-f-]{36}):([1-5])$/, async (ctx) => {
    const { b, customer } = await identify(ctx);
    await leaveReview(app, {
      businessId: b.id,
      bookingId: ctx.match[1]!,
      customerId: customer.customerId,
      rating: Number(ctx.match[2]),
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `${'★'.repeat(Number(ctx.match[2]))}\n${messagesFor(customer.lang).reviewThanks}`,
    );
  });

  // Telegram Stars: the invoice payload is our payment reference.
  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });
  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    await confirmPayment(app, { reference: p.invoice_payload, providerTxId: p.telegram_payment_charge_id });
  });

  bot.catch(async (err) => {
    const e = err.error;
    const ctx = err.ctx;
    if (isDomainError(e)) {
      const text = e.code === 'CANCEL_WINDOW_PASSED' ? messagesFor('uz').cancelTooLate : e.message;
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => undefined);
      else await ctx.reply(text).catch(() => undefined);
      return;
    }
    console.error('Bot error', e);
  });

  return bot;
}
