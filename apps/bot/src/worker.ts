/**
 * Outbox worker: claims due notification jobs, renders them with the shared templates and
 * sends them. Also queues the masters' morning digests. Safe to run in several replicas.
 */
import { type Lang, type NotificationPayload, renderNotification } from '@navbat/core';
import {
  type AppContext,
  claimDueJobs,
  enqueueDailyDigests,
  markCancelled,
  markFailed,
  markSent,
} from '@navbat/db';
import { type Api, GrammyError } from 'grammy';
import { keyboard } from './bot.js';

export interface WorkerDeps {
  ctx: AppContext;
  api: Pick<Api, 'sendMessage'>;
  webAppUrl: string;
}

export interface TickResult {
  sent: number;
  failed: number;
  skipped: number;
}

const REMINDERS = new Set(['reminder_24h', 'reminder_2h']);

export async function processDueNotifications(deps: WorkerDeps, limit = 25): Promise<TickResult> {
  const { db } = deps.ctx;
  const now = deps.ctx.now();
  const jobs = await claimDueJobs(db, now, limit);
  const result: TickResult = { sent: 0, failed: 0, skipped: 0 };
  for (const job of jobs) {
    if (REMINDERS.has(job.kind) && job.bookingId) {
      const b = await db
        .selectFrom('bookings')
        .select(['status', 'start_at'])
        .where('id', '=', job.bookingId)
        .executeTakeFirst();
      if (!b || b.status !== 'confirmed' || b.start_at.getTime() <= now) {
        await markCancelled(db, job.id, 'booking no longer upcoming');
        result.skipped++;
        continue;
      }
    }
    const rendered = renderNotification(job.payload as NotificationPayload, job.lang as Lang, deps.webAppUrl);
    try {
      await deps.api.sendMessage(job.chatId, rendered.text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(rendered.buttons.length ? { reply_markup: keyboard(rendered.buttons) } : {}),
      });
      await markSent(db, job.id, now);
      result.sent++;
    } catch (e) {
      // 400 chat not found / 403 blocked by user are permanent; 429 and 5xx are retried.
      const permanent = e instanceof GrammyError && (e.error_code === 403 || e.error_code === 400);
      await markFailed(db, job.id, now, e instanceof Error ? e.message : String(e), permanent);
      result.failed++;
    }
  }
  return result;
}

export async function queueDigests(ctx: AppContext): Promise<number> {
  const businesses = await ctx.db.selectFrom('businesses').select('id').execute();
  let n = 0;
  for (const b of businesses) n += await enqueueDailyDigests(ctx, b.id);
  return n;
}

/** Runs forever: one tick every `intervalMs`. Returns a stop function. */
export function startWorker(deps: WorkerDeps, intervalMs = 15_000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await queueDigests(deps.ctx);
      let r: TickResult;
      do r = await processDueNotifications(deps);
      while (!stopped && r.sent + r.failed + r.skipped === 25);
    } catch (e) {
      console.error('Worker tick failed', e);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
