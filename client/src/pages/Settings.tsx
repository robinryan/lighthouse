import { useState } from 'react';
import { api, type Profile } from '../api';
import { useSession } from '../hooks';
import { ProfileFields } from './Setup';

function Toggle({ k, label }: { k: string; label: string }) {
  const read = () => { try { return localStorage.getItem(k) !== 'off'; } catch { return true; } };
  const [on, setOn] = useState(read);
  return (
    <label className="spread" style={{ padding: '6px 0' }}>
      <span>{label}</span>
      <input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={on} onChange={(e) => {
        setOn(e.target.checked);
        try { localStorage.setItem(k, e.target.checked ? 'on' : 'off'); } catch { /* ignore */ }
      }} />
    </label>
  );
}

export function SettingsPage() {
  const { user, profile, refreshProfile, logout } = useSession();
  const [draft, setDraft] = useState<Omit<Profile, 'onboarded'>>(profile);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [notif, setNotif] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  async function save(rebuild: boolean) {
    setError(null);
    try {
      await api.put('/profile', draft);
      if (rebuild) await api.post('/program/regenerate');
      await refreshProfile();
      setSaved(rebuild ? 'Saved and program rebuilt.' : 'Saved.');
      setTimeout(() => setSaved(null), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}><h1>Settings</h1></div>

      <div className="card stack">
        <h2>Training profile</h2>
        <ProfileFields draft={draft} set={setDraft} section="all" />
        {draft.units !== profile.units && <p className="notice">Switching units converts all your logged weights.</p>}
        {error && <p className="error">{error}</p>}
        {saved && <p className="small" style={{ color: 'var(--good)' }}>{saved}</p>}
        <div className="row">
          <button className="btn primary grow" onClick={() => save(false)}>Save</button>
          <button className="btn grow" onClick={() => save(true)}>Save & rebuild program</button>
        </div>
      </div>

      <div className="card">
        <h2>Rest timer</h2>
        <Toggle k="lh_autostart" label="Start automatically when I check off a set" />
        <Toggle k="lh_sound" label="Sound when rest is over" />
        <Toggle k="lh_vibrate" label="Vibrate when rest is over" />
        {notif !== 'granted' && typeof Notification !== 'undefined' && (
          <button className="btn sm" style={{ marginTop: 6 }} onClick={async () => setNotif(await Notification.requestPermission())}>
            Enable notifications
          </button>
        )}
        <p className="tiny muted" style={{ marginTop: 6 }}>Tip: install the app to your home screen (Share → Add to Home Screen) for full-screen use and notifications.</p>
      </div>

      <div className="card stack">
        <h2>Data</h2>
        <a className="btn block" href="/api/export.csv" download>Export workouts (CSV)</a>
      </div>

      <div className="card stack">
        <h2>Account</h2>
        <p className="small muted" style={{ margin: 0 }}>{user.name} · {user.email}</p>
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.post('/auth/password', pw); setPw({ current: '', next: '' }); setSaved('Password changed.'); }
          catch (err) { setError((err as Error).message); }
        }}>
          <input type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input type="password" placeholder="New password (8+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} />
          <button className="btn" disabled={!pw.current || pw.next.length < 8}>Change password</button>
        </form>
        <button className="btn danger" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
