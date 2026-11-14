import { type ButtonSpec, type Lang, type NotificationPayload, formatTimeIn, isLang, messagesFor, renderNotification } from '@navbat/core';
import { AnimatePresence, motion } from 'motion/react';
import { useContext, useEffect, useRef, useState } from 'react';
import type { DemoBackend } from '../backend/demo';
import type { NotificationDTO } from '../backend/types';
import { errorText, useI18n } from '../i18n';
import { DataVersionContext, useAsync, useToast } from '../lib';

const VISITOR = 1001;
const APP_URL = 'https://t.me/navbat_demo_bot/app';

const COPY: Record<Lang, { title: string; scheduled: string; sendNow: string; empty: string; you: string; hint: string; at: string }> = {
  uz: {
    title: 'Telegram bot',
    scheduled: 'Rejalashtirilgan',
    sendNow: 'Hozir yuborish',
    empty: 'Navbat oling — tasdiq shu yerga keladi.',
    you: 'Siz (mijoz)',
    hint: 'Xabarlar haqiqiy bot shablonlaridan chiqadi. Eslatmalarni kutmasdan koʻrish uchun “Hozir yuborish”ni bosing.',
    at: 'yuboriladi',
  },
  ru: {
    title: 'Telegram-бот',
    scheduled: 'Запланировано',
    sendNow: 'Отправить сейчас',
    empty: 'Запишитесь — подтверждение придёт сюда.',
    you: 'Вы (клиент)',
    hint: 'Сообщения собраны из настоящих шаблонов бота. Нажмите «Отправить сейчас», чтобы не ждать напоминаний.',
    at: 'отправка',
  },
  en: {
    title: 'Telegram bot',
    scheduled: 'Scheduled',
    sendNow: 'Send now',
    empty: 'Book a visit — the confirmation lands here.',
    you: 'You (customer)',
    hint: 'Messages come from the real bot templates. Tap “Send now” to see reminders without waiting.',
    at: 'sends at',
  },
};

function Bubble({
  job,
  tz,
  onButton,
  busy,
}: {
  job: NotificationDTO;
  tz: string;
  onButton: (b: ButtonSpec) => void;
  busy: boolean;
}) {
  const lang = isLang(job.lang) ? job.lang : 'uz';
  const r = renderNotification(job.payload as NotificationPayload, lang, APP_URL);
  return (
    <motion.div className="bubble-wrap" layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="bubble" data-testid="bot-message" data-kind={job.kind}>
        {/* Templates escape every user-provided value; only <b>, <i>, <code> remain. */}
        <div className="bubble-text" dangerouslySetInnerHTML={{ __html: r.text.replace(/\n/g, '<br/>') }} />
        <span className="bubble-time">{formatTimeIn(job.sentAt ?? job.sendAt, tz)}</span>
      </div>
      {r.buttons.length > 0 && (
        <div className="kb">
          {r.buttons.map((row, i) => (
            <div key={i} className="kb-row">
              {row.map((b) => (
                <button key={b.text} type="button" className="kb-btn" disabled={busy} onClick={() => onButton(b)}>
                  {b.text}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function BotChat({ backend, tz, businessName, onOpenApp }: { backend: DemoBackend; tz: string; businessName: string; onOpenApp: () => void }) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const c = COPY[lang];
  const version = useContext(DataVersionContext);
  const [chatId, setChatId] = useState(VISITOR);
  const [jobs, setJobs] = useState<NotificationDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const chats = useAsync(() => backend.staffChats(), []);
  const scroller = useRef<HTMLDivElement>(null);

  // The demo's stand-in for the bot worker: deliver due messages every 2 seconds.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      await backend.tick();
      const list = await backend.notifications(chatId);
      if (alive) setJobs(list.filter((j) => j.status !== 'cancelled' && j.status !== 'failed'));
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [backend, chatId, version]);

  const sent = jobs.filter((j) => j.status === 'sent').sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
  const scheduled = jobs.filter((j) => j.status === 'pending').sort((a, b) => a.sendAt - b.sendAt);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [sent.length]);

  const onButton = async (b: ButtonSpec) => {
    if (!('callback' in b)) {
      onOpenApp();
      return;
    }
    const [action, id, arg] = b.callback.split(':');
    setBusy(true);
    try {
      if (action === 'late') await backend.late(id!, Number(arg));
      else if (action === 'cancel') await backend.cancel(id!, 'Cancelled in the bot');
      else if (action === 'rate') await backend.review(id!, Number(arg));
    } catch (e) {
      toast(errorText(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const welcome = messagesFor(lang).welcome('Akmal', businessName);

  return (
    <section className="chat" aria-label={c.title} data-testid="bot-chat">
      <header className="chat-head">
        <span className="chat-avatar" aria-hidden>
          N
        </span>
        <div>
          <strong>Navbat bot</strong>
          <span className="muted">@navbat_demo_bot</span>
        </div>
        <select className="chat-switch" value={chatId} onChange={(e) => setChatId(Number(e.target.value))} aria-label="Chat">
          <option value={VISITOR}>{c.you}</option>
          {(chats.data ?? []).map((s) => (
            <option key={s.chatId} value={s.chatId}>
              {s.name} · {s.role}
            </option>
          ))}
        </select>
      </header>
      <div className="chat-scroll" ref={scroller}>
        <p className="chat-hint">{c.hint}</p>
        {chatId === VISITOR && (
          <>
            <div className="bubble-wrap me">
              <div className="bubble me">/start</div>
            </div>
            <div className="bubble-wrap">
              <div className="bubble">
                <div className="bubble-text" dangerouslySetInnerHTML={{ __html: welcome.replace(/\n/g, '<br/>') }} />
              </div>
              <div className="kb">
                <div className="kb-row">
                  <button type="button" className="kb-btn" onClick={onOpenApp}>
                    {messagesFor(lang).buttons.book}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        <AnimatePresence initial={false}>
          {sent.map((j) => (
            <Bubble key={j.id} job={j} tz={tz} onButton={onButton} busy={busy} />
          ))}
        </AnimatePresence>
        {sent.length === 0 && chatId !== VISITOR && <p className="chat-hint">{c.empty}</p>}
        {scheduled.length > 0 && (
          <div className="scheduled">
            <h3>{c.scheduled}</h3>
            {scheduled.map((j) => (
              <div key={j.id} className="scheduled-row" data-testid="scheduled-message">
                <span>
                  <b>{j.kind.replace(/_/g, ' ')}</b>
                  <small>
                    {c.at} {new Date(j.sendAt).toLocaleString(lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'uz-UZ', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </small>
                </span>
                <button type="button" className="btn small quiet" onClick={() => backend.deliverNow(j.id)}>
                  {c.sendNow}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
