import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { loadTelegramScript, tg } from './telegram';

const isDemo = import.meta.env.MODE === 'demo' || new URLSearchParams(window.location.search).has('demo');

async function boot() {
  await loadTelegramScript();
  // Telegram passes launch params in the hash; keep only our own routes.
  const launchHash = window.location.hash;
  if (/tgWebApp/.test(launchHash))
    history.replaceState(null, '', window.location.pathname + window.location.search);
  tg.ready();
  createRoot(document.getElementById('root')!).render(<Root demo={isDemo} launchHash={launchHash} />);
}

void boot();
