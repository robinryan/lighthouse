import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const DISMISS_KEY = 'lh_install_dismissed';
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Nudge to add the app to the home screen: full screen, faster to open between sets, works offline. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (dismissed || isStandalone()) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!evt && !ios) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  return (
    <div className="card install-card">
      <div className="grow">
        <b>Install Lighthouse</b>
        <div className="small muted">
          {evt ? 'Full screen, opens instantly between sets, works without signal.'
            : <>Tap <b>Share</b> then <b>Add to Home Screen</b> for full screen and offline use.</>}
        </div>
      </div>
      {evt && <button className="btn sm primary" onClick={async () => { await evt.prompt(); setEvt(null); }}>Install</button>}
      <button className="btn sm ghost" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
