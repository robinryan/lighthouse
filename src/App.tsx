import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { db, flushOutbox, getProfile, isConfigured, NetworkError, type Profile, type User } from './api';
import { SessionContext, useOnline } from './hooks';
import { RestTimerBar, RestTimerProvider, useRestTimer } from './components/RestTimer';
import { LoginPage } from './pages/Login';
import { SetupPage } from './pages/Setup';
import { TodayPage } from './pages/Today';
import { WorkoutPage } from './pages/Workout';
import { DemoHost } from './components/DemoSheet';

// Today and the workout screen load with the app; everything else loads on first visit (smaller first download on mobile data).
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const WorkoutDetailPage = lazy(() => import('./pages/History').then((m) => ({ default: m.WorkoutDetailPage })));
const ProgressPage = lazy(() => import('./pages/Progress').then((m) => ({ default: m.ProgressPage })));
const ExerciseProgressPage = lazy(() => import('./pages/Progress').then((m) => ({ default: m.ExerciseProgressPage })));
const ProgramPage = lazy(() => import('./pages/Program').then((m) => ({ default: m.ProgramPage })));
const CoachPage = lazy(() => import('./pages/Coach').then((m) => ({ default: m.CoachPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const HealthPage = lazy(() => import('./pages/Health').then((m) => ({ default: m.HealthPage })));

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
      <main className={`app ${timer ? 'with-timer' : ''}`}>
        <Suspense fallback={<p className="muted center" style={{ marginTop: '20vh' }}>Loading…</p>}>{children}</Suspense>
      </main>
      <RestTimerBar />
      <DemoHost />
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
  if (!isConfigured()) {
    return (
      <main className="app"><div className="card stack" style={{ marginTop: '20vh' }}>
        <h2>Database not connected</h2>
        <p className="muted">The app can't find its database settings (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>). In Bolt, open the database icon at the top of the project to create or connect the project's database, then reload.</p>
      </div></main>
    );
  }
  return <SignedInApp />;
}

function SignedInApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const load = useCallback(async (u: User | null) => {
    if (!u) { setUser(null); setProfile(null); return; }
    try {
      setProfile(await getProfile() as Profile);
      setUser(u);
      setBootError(null);
    } catch (e) {
      setBootError(e instanceof NetworkError ? 'Can\'t reach the server. Check your connection.' : (e as Error).message);
      setUser(undefined);
    }
  }, []);

  useEffect(() => {
    const auth = db().auth;
    void auth.getSession().then(({ data }) => load(data.session ? { id: data.session.user.id, email: data.session.user.email ?? '' } : null));
    const { data: sub } = auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: Supabase recommends not awaiting other calls inside this callback.
        setTimeout(() => void load(session ? { id: session.user.id, email: session.user.email ?? '' } : null), 0);
      }
    });
    const flush = () => void flushOutbox();
    window.addEventListener('online', flush);
    flush();
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('online', flush); };
  }, [load]);

  const session = useMemo(() => (user && profile ? {
    user, profile,
    refreshProfile: async () => setProfile(await getProfile() as Profile),
    logout: async () => {
      await db().auth.signOut();
      try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k === 'api').map((k) => caches.delete(k))); } catch { /* ignore */ }
      setUser(null); setProfile(null);
    },
  } : null), [user, profile]);

  if (user === undefined) {
    return <main className="app">{bootError ? <div className="card stack"><p className="error">{bootError}</p><button className="btn" onClick={() => window.location.reload()}>Retry</button></div> : <p className="muted center" style={{ marginTop: '30vh' }}>Loading…</p>}</main>;
  }
  if (!user || !session) return <main className="app"><LoginPage /></main>;
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
            <Route path="/health" element={<HealthPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </RestTimerProvider>
    </SessionContext.Provider>
  );
}
