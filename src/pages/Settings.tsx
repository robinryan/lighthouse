import { useState } from 'react';
import { Link } from 'react-router';
import { db, exportCsv, localDate, regenerateProgram, saveProfile, type Profile } from '../api';
import { usePlan, useSession } from '../hooks';
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

const PLAN_NAMES = { free: 'FREE', paid: 'PAID', admin: 'ADMIN' } as const;
const PLAN_DETAILS = {
  free: 'Coach answers use fast, low-cost models; questions about pain or injury get a stronger model. Research with studies is part of the paid plan.',
  paid: 'Everyday questions get a fast model, questions about your own training a stronger one, and pain, injury and research questions the most capable one.',
  admin: 'Same coach as the paid plan, with no limits.',
} as const;

export function SettingsPage() {
  const { user, profile, refreshProfile, logout } = useSession();
  const [draft, setDraft] = useState<Omit<Profile, 'onboarded'>>(profile);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const plan = usePlan(true);
  const [notif, setNotif] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  async function save(rebuild: boolean) {
    setError(null);
    try {
      await saveProfile({ ...draft, onboarded: profile.onboarded });
      if (rebuild) await regenerateProgram();
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
        <div className="spread">
          <h2 style={{ margin: 0 }}>Your plan</h2>
          {plan && <span className={`badge ${plan.tier === 'free' ? '' : 'T1'}`}>{PLAN_NAMES[plan.tier]}</span>}
        </div>
        {plan ? (
          <>
            <p className="small" style={{ margin: 0 }}>{PLAN_DETAILS[plan.tier]}</p>
            {plan.usedPct != null && (
              <>
                <div className="small muted">Coach allowance this month: {plan.usedPct}% used{plan.dailyLimit ? ` · ${plan.messagesToday} of ${plan.dailyLimit} messages today` : ''}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${plan.usedPct}%` }} /></div>
              </>
            )}
            {plan.tier === 'admin' && (
              <>
                <div className="small muted">Your coach spending this month: ${(plan.spentUsd ?? 0).toFixed(2)} (no limit)</div>
                <Link className="btn block" to="/admin">Open admin: users, usage and spending</Link>
              </>
            )}
          </>
        ) : <p className="small muted">{plan === null ? 'Plan details will show here once the coach function is up to date.' : 'Loading…'}</p>}
        <p className="tiny muted" style={{ margin: 0 }}>Only the AI coach has running costs; the program, logging and progress tracking are free.</p>
      </div>


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

      <div className="card spread">
        <div>
          <h2 style={{ marginBottom: 2 }}>Health profile</h2>
          <div className="small muted">Sensitive joints, exercises to avoid or that work well — learned from your skips and coach chats.</div>
        </div>
        <Link className="btn sm" to="/health">Open</Link>
      </div>

      <div className="card">
        <h2>Workout display</h2>
        <Toggle k="lh_wakelock" label="Keep the screen on during workouts" />
        <Toggle k="lh_collapse" label="Collapse exercises once all sets are done" />
        <Toggle k="lh_tips" label="Show form tips under each exercise" />
        <Toggle k="lh_autostretch" label="Add recommended stretches automatically (7/10+ prep before main lifts, plus a cool-down)" />
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
        <button className="btn block" onClick={async () => {
          try {
            const csv = await exportCsv(profile.units);
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `lighthouse-${localDate()}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) { setError((e as Error).message); }
        }}>Export workouts (CSV)</button>
      </div>

      <div className="card stack">
        <h2>Account</h2>
        <p className="small muted" style={{ margin: 0 }}>{profile.name ? `${profile.name} · ` : ''}{user.email}</p>
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          const { error: err } = await db().auth.updateUser({ password: pw });
          if (err) setError(err.message);
          else { setPw(''); setSaved('Password changed.'); }
        }}>
          <input type="password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} />
          <button className="btn" disabled={pw.length < 8}>Change password</button>
        </form>
        <button className="btn danger" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
