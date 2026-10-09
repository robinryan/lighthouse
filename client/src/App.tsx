import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { api, ApiError, flushOutbox, setUnauthorizedHandler, type Profile, type User } from './api';
import { SessionContext, useOnline } from './hooks';
import { RestTimerBar, RestTimerProvider, useRestTimer } from './components/RestTimer';
import { LoginPage } from './pages/Login';
import { SetupPage } from './pages/Setup';
import { TodayPage } from './pages/Today';
import { WorkoutPage } from './pages/Workout';
import { HistoryPage, WorkoutDetailPage } from './pages/History';
import { ExerciseProgressPage, ProgressPage } from './pages/Progress';
import { ProgramPage } from './pages/Program';
import { CoachPage } from './pages/Coach';
import { SettingsPage } from './pages/Settings';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const TABS = [
  { to: '/', label: 'Today', d: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12' },
  { to: '/history', label: 'History', d: 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' },
  { to: '/progress', label: 'Progress', d: 'M3 20h18M6 16l4-5 3 3 5-7' },
  { to: '/coach', label: 'Coach', d: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' },
  { to: '/settings', label: 'Settings', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { timer } = useRestTimer();
  const online = useOnline();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      {!online && <div className="offline-pill">Offline — sets will sync later</div>}
      <main className={`app ${timer ? 'with-timer' : ''}`}>{children}</main>
      <RestTimerBar />
      <div className="tabbar">
        <nav>
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon d={t.d} />{t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const u = await api.get<User>('/auth/me');
      const p = await api.get<Profile>('/profile');
      setUser(u);
      setProfile(p);
      setBootError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setUser(null); setProfile(null); }
      else setBootError('Can\'t reach the server. Check your connection.');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setProfile(null); });
    void load();
    const flush = () => void flushOutbox();
    window.addEventListener('online', flush);
    flush();
    return () => window.removeEventListener('online', flush);
  }, [load]);

  const session = useMemo(() => (user && profile ? {
    user, profile,
    refreshProfile: async () => setProfile(await api.get<Profile>('/profile')),
    logout: async () => {
      await api.post('/auth/logout');
      try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k === 'api').map((k) => caches.delete(k))); } catch { /* ignore */ }
      setUser(null); setProfile(null);
    },
  } : null), [user, profile]);

  if (user === undefined) {
    return <main className="app">{bootError ? <div className="card stack"><p className="error">{bootError}</p><button className="btn" onClick={load}>Retry</button></div> : <p className="muted center" style={{ marginTop: '30vh' }}>Loading…</p>}</main>;
  }
  if (!user || !session) return <main className="app"><LoginPage onAuthed={() => void load()} /></main>;
  if (!session.profile.onboarded) {
    return <SessionContext.Provider value={session}><main className="app"><SetupPage /></main></SessionContext.Provider>;
  }

  return (
    <SessionContext.Provider value={session}>
      <RestTimerProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/workout/:id" element={<WorkoutPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:id" element={<WorkoutDetailPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/progress/:exerciseId" element={<ExerciseProgressPage />} />
            <Route path="/program" element={<ProgramPage />} />
            <Route path="/coach" element={<CoachPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </RestTimerProvider>
    </SessionContext.Provider>
  );
}
