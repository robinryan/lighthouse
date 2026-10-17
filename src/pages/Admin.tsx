import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { getAdminReport, setUserTier, type AdminUserRow } from '../api';
import { useAsync, usePlan } from '../hooks';

const MODEL_NAMES: Record<string, string> = { 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' };
const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—');

/** Admins only: every user, their class, coach usage and spending. No chat content is shown. */
export function AdminPage() {
  const plan = usePlan();
  const { data, error, reload } = useAsync(() => getAdminReport(), []);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  }, [data, query]);

  if (plan && plan.tier !== 'admin') return <p className="muted">This page is for admins.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  async function change(u: AdminUserRow, tier: 'free' | 'paid') {
    setBusy(u.id);
    setMsg(null);
    try {
      await setUserTier(u.id, tier);
      await reload();
      setMsg(`${u.email} is now on the ${tier} plan.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const t = data.totals;
  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/settings" className="small">← Settings</Link>
          <h1>Admin</h1>
        </div>
        <button className="btn sm" onClick={() => void reload()}>Refresh</button>
      </div>

      <div className="stat-grid">
        <div className="stat"><b>{t.users}</b><span>users: {t.paid} paid, {t.free} free{t.admin ? `, ${t.admin} admin` : ''}</span></div>
        <div className="stat"><b>{usd(t.monthUsd)}</b><span>AI spend this month</span></div>
        <div className="stat"><b>{usd(t.avgUsdPerActiveUser)}</b><span>per active user</span></div>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {t.monthMessages} coach messages this month. Costs are estimated from token counts at list prices; months are UTC.
      </p>

      <div className="card">
        <h2>By model, this month</h2>
        {data.byModel.length ? data.byModel.map((m) => (
          <div key={m.model} className="spread small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span>{MODEL_NAMES[m.model] ?? m.model}</span>
            <span className="num muted">{m.replies} replies · <b style={{ color: 'var(--text)' }}>{usd(m.usd)}</b> · {usd(m.replies ? m.usd / m.replies : 0)} each</span>
          </div>
        )) : <p className="small muted">No coach use yet this month.</p>}
      </div>

      <div className="card">
        <h2>Last 30 days</h2>
        {data.byDay.length ? (
          <table className="admin-table">
            <thead><tr><th>Day</th><th>Replies</th><th>Spend</th></tr></thead>
            <tbody>
              {[...data.byDay].reverse().map((d) => (
                <tr key={d.day}><td>{date(d.day)}</td><td className="num">{d.replies}</td><td className="num">{usd(d.usd)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="small muted">No coach use in the last 30 days.</p>}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Users</h2>
        <input placeholder="Search by email or name" value={query} onChange={(e) => setQuery(e.target.value)} />
        {msg && <p className="notice">{msg}</p>}
        {users.map((u) => (
          <div key={u.id} className="admin-user">
            <div className="spread">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name || u.email}</div>
                {u.name && <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>}
              </div>
              {u.fixedAdmin ? <span className="badge T1">ADMIN</span> : (
                <div className="chips" role="group" aria-label={`Plan for ${u.email}`}>
                  {(['free', 'paid'] as const).map((tier) => (
                    <button key={tier} className={`chip ${u.tier === tier ? 'on' : ''}`} disabled={busy === u.id || u.tier === tier}
                      onClick={() => void change(u, tier)}>{tier === 'free' ? 'Free' : 'Paid'}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="small muted num" style={{ marginTop: 6 }}>
              This month <b style={{ color: 'var(--text)' }}>{usd(u.month_usd)}</b> · {u.month_messages} msg{u.month_messages === 1 ? '' : 's'}
              {' · '}all time {usd(u.total_usd)} · {u.workouts} workout{u.workouts === 1 ? '' : 's'}
            </div>
            <div className="tiny muted">Joined {date(u.joined)} · last workout {date(u.last_workout)} · last coach use {date(u.last_coach)}</div>
          </div>
        ))}
        {!users.length && <p className="small muted">No users match.</p>}
      </div>
    </div>
  );
}
