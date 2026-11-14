import { AnimatePresence, motion } from 'motion/react';
import { tg, useMockChrome } from '../telegram';

/** Renders MainButton/BackButton when the page is not running inside Telegram. */
export function MockMainButton() {
  const { main } = useMockChrome();
  if (tg.inTelegram) return null;
  return (
    <AnimatePresence>
      {main.visible && (
        <motion.div
          className="tg-mainbar"
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        >
          <button
            type="button"
            className="btn block tg-main"
            data-testid="main-button"
            disabled={main.disabled || main.progress}
            onClick={() => main.onClick?.()}
          >
            {main.progress ? <span className="spinner light" /> : main.text}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MockBackButton({ label }: { label: string }) {
  const { back } = useMockChrome();
  if (tg.inTelegram || !back) return <span className="tg-back-spacer" />;
  return (
    <button type="button" className="icon-btn" aria-label={label} data-testid="back-button" onClick={() => back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
