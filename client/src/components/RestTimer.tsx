import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmtDuration } from '../format';

interface TimerState { endsAt: number; duration: number; label: string }
interface TimerApi {
  timer: TimerState | null;
  remaining: number;
  start: (seconds: number, label: string) => void;
  adjust: (delta: number) => void;
  stop: () => void;
}

const Ctx = createContext<TimerApi | null>(null);
const KEY = 'lh_timer';

export function prefs() {
  try {
    return { sound: localStorage.getItem('lh_sound') !== 'off', vibrate: localStorage.getItem('lh_vibrate') !== 'off', autoStart: localStorage.getItem('lh_autostart') !== 'off' };
  } catch {
    return { sound: true, vibrate: true, autoStart: true };
  }
}

let audioCtx: AudioContext | null = null;
/** Must be called from a user gesture once so iOS allows sound later. */
export function unlockAudio() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch { /* no audio */ }
}
function beep() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((offset, i) => {
    const o = audioCtx!.createOscillator();
    const g = audioCtx!.createGain();
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + offset);
    g.gain.exponentialRampToValueAtTime(0.4, t + offset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
    o.connect(g).connect(audioCtx!.destination);
    o.start(t + offset);
    o.stop(t + offset + 0.2);
  });
}

async function notify(label: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: `Rest over — next set of ${label}`, tag: 'rest-timer', icon: '/icon-192.png' };
    if (reg) await reg.showNotification('Time to lift', opts);
    else new Notification('Time to lift', opts);
  } catch { /* ignore */ }
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<TimerState | null>(() => {
    try {
      const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as TimerState | null;
      return t && t.endsAt > Date.now() ? t : null;
    } catch { return null; }
  });
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);

  useEffect(() => {
    try {
      if (timer) localStorage.setItem(KEY, JSON.stringify(timer));
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, [timer]);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer]);

  const remaining = timer ? Math.max(0, (timer.endsAt - now) / 1000) : 0;

  useEffect(() => {
    if (!timer) return;
    if (remaining > 0) { fired.current = false; return; }
    if (fired.current) return;
    fired.current = true;
    const p = prefs();
    if (p.vibrate && 'vibrate' in navigator) navigator.vibrate([250, 120, 250, 120, 400]);
    if (p.sound) beep();
    void notify(timer.label);
    const clear = setTimeout(() => setTimer(null), 8000);
    return () => clearTimeout(clear);
  }, [remaining, timer]);

  const start = useCallback((seconds: number, label: string) => {
    fired.current = false;
    setNow(Date.now());
    setTimer({ endsAt: Date.now() + seconds * 1000, duration: seconds, label });
  }, []);
  const adjust = useCallback((delta: number) => {
    setTimer((t) => (t ? { ...t, endsAt: Math.max(Date.now(), t.endsAt + delta * 1000), duration: Math.max(1, t.duration + delta) } : t));
  }, []);
  const stop = useCallback(() => setTimer(null), []);

  const value = useMemo(() => ({ timer, remaining, start, adjust, stop }), [timer, remaining, start, adjust, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRestTimer() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRestTimer outside provider');
  return v;
}

export function RestTimerBar() {
  const { timer, remaining, adjust, stop } = useRestTimer();
  if (!timer) return null;
  const finished = remaining <= 0;
  const pct = finished ? 100 : 100 - (remaining / timer.duration) * 100;
  return (
    <div className="timer-bar" role="timer" aria-live="polite">
      <div className={`timer-inner ${finished ? 'finished' : ''}`}>
        <div className="timer-time">{finished ? 'Go!' : fmtDuration(remaining)}</div>
        <div className="grow">
          <div className="small muted">{finished ? 'Rest complete' : 'Rest'}</div>
          <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{timer.label}</div>
        </div>
        {!finished && <button className="btn sm" onClick={() => adjust(-15)} aria-label="Subtract 15 seconds">−15</button>}
        {!finished && <button className="btn sm" onClick={() => adjust(15)} aria-label="Add 15 seconds">+15</button>}
        <button className="btn sm" onClick={stop}>{finished ? 'Done' : 'Skip'}</button>
        <div className="timer-progress" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
