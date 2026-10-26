import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { activeWorkoutId } from '../api';
import { fmtDuration } from '../format';

/** `workoutId`: the workout the rest belongs to, so the bar can take you back to it. */
interface TimerState { endsAt: number; duration: number; label: string; workoutId?: number }
interface TimerApi {
  timer: TimerState | null;
  remaining: number;
  start: (seconds: number, label: string, workoutId?: number) => void;
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

// The rest-timer beep must never stop the user's own music or podcast. On iOS a web page's audio
// takes over the phone's audio by default, which pauses other apps, including when you come back
// to the app. "ambient" mixes the beep in on top instead (Safari 16.4+), and the audio context is
// only running for the moment it beeps, so the app holds no audio while you train.
let audioCtx: AudioContext | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Returns false on browsers without the Audio Session API (older iOS). */
function mixWithOtherAudio(): boolean {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (!session) return false;
    if (session.type !== 'ambient') session.type = 'ambient';
    return true;
  } catch { return false; }
}
mixWithOtherAudio();
function sleepSoon(ms: number) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (audioCtx?.state === 'running') void audioCtx.suspend().catch(() => {}); }, ms);
}
/** Must be called from a user gesture once so iOS allows sound later. */
export function unlockAudio() {
  if (!prefs().sound) return;
  try {
    // Where audio can't be told to mix, wake it on the first tap only, so taps don't pause music.
    if (!mixWithOtherAudio() && audioCtx) return;
    audioCtx ??= new AudioContext();
    if (audioCtx.state !== 'running') void audioCtx.resume().catch(() => {});
    sleepSoon(300);
  } catch { /* no audio */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) sleepSoon(0); });
}
async function beep() {
  if (!audioCtx) return;
  mixWithOtherAudio();
  try { await audioCtx.resume(); } catch { return; }
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
  sleepSoon(1200);
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

  // Countdown in the tab title, so it shows in the app switcher.
  useEffect(() => {
    const base = 'Gym Bestie';
    document.title = timer ? (remaining > 0 ? `${fmtDuration(remaining)} · Rest` : 'Go! · Gym Bestie') : base;
    return () => { document.title = base; };
  }, [timer, Math.ceil(remaining)]);

  useEffect(() => {
    if (!timer) return;
    if (remaining > 0) { fired.current = false; return; }
    if (fired.current) return;
    fired.current = true;
    const p = prefs();
    if (p.vibrate && 'vibrate' in navigator) navigator.vibrate([250, 120, 250, 120, 400]);
    if (p.sound) void beep();
    void notify(timer.label);
    const clear = setTimeout(() => setTimer(null), 8000);
    return () => clearTimeout(clear);
  }, [remaining, timer]);

  const start = useCallback((seconds: number, label: string, workoutId?: number) => {
    fired.current = false;
    setNow(Date.now());
    setTimer({ endsAt: Date.now() + seconds * 1000, duration: seconds, label, workoutId });
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!timer) return null;
  const finished = remaining <= 0;
  const pct = finished ? 100 : 100 - (remaining / timer.duration) * 100;
  const onWorkout = /^\/workout\/\d+/.test(pathname);

  // Tapping the time takes you back to the workout (or, if you're on it, to the exercise you're doing).
  async function backToWorkout() {
    const id = timer?.workoutId ?? await activeWorkoutId().catch(() => null);
    if (id == null) { navigate('/'); return; }
    if (pathname === `/workout/${id}`) {
      document.querySelector('.ex-card.active')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate(`/workout/${id}`);
    }
  }

  return (
    <div className="timer-bar" role="timer" aria-live="polite">
      <div className={`timer-inner ${finished ? 'finished' : ''}`}>
        <button type="button" className="timer-open" onClick={() => void backToWorkout()}
          aria-label={onWorkout ? 'Scroll to the current exercise' : 'Back to your workout'}>
          <span className="timer-time">{finished ? 'Go!' : fmtDuration(remaining)}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className={`small timer-hint ${onWorkout ? 'muted' : 'link'}`}>
              {onWorkout ? (finished ? 'Rest complete' : 'Rest') : 'Workout ›'}
            </span>
            <span className="small" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{timer.label}</span>
          </span>
        </button>
        {!finished && <button className="btn sm" onClick={() => adjust(-15)} aria-label="Subtract 15 seconds">−15</button>}
        {!finished && <button className="btn sm" onClick={() => adjust(15)} aria-label="Add 15 seconds">+15</button>}
        <button className="btn sm" onClick={stop}>{finished ? 'Done' : 'Skip'}</button>
        <div className="timer-progress" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
