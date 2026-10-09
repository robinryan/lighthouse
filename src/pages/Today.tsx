import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getToday, localDate, startWorkout, summary } from '../api';
import { useAsync, useSession } from '../hooks';
import { ExerciseName } from '../components/ExerciseName';
import { fmtDate, fmtNum } from '../format';

export function TodayPage() {
  const { profile } = useSession();
  const navigate = useNavigate();
  const date = localDate();
  const today = useAsync(() => getToday(date), [date]);
  const stats = useAsync(() => summary(date), [date]);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = today.data;
  const days = t?.days ?? [];
  const selected = choice ?? t?.next?.dayIndex ?? 0;
  const preview = days[selected] ?? t?.next ?? null;

  async function start(empty = false) {
    setBusy(true);
    setError(null);
    try {
      const id = await startWorkout(empty ? { date, empty: true, title: 'Freestyle workout' } : { date, dayIndex: selected });
      navigate(`/workout/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="small muted">{fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>{greeting}{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
        </div>
      </div>

      {stats.data && (
        <div className="stat-grid">
          <div className="stat"><b>{stats.data.thisWeek}<span className="muted" style={{ fontSize: 14 }}>/{profile.daysPerWeek}</span></b><span>this week</span></div>
          <div className="stat"><b>{stats.data.streakWeeks}</b><span>week streak</span></div>
          <div className="stat"><b>{stats.data.totalWorkouts}</b><span>workouts</span></div>
        </div>
      )}

      {t?.activeWorkoutId ? (
        <div className="card stack">
          <h2>Workout in progress</h2>
          <Link className="btn primary block" to={`/workout/${t.activeWorkoutId}`}>Resume workout</Link>
        </div>
      ) : preview ? (
        <div className="card stack">
          <div className="spread">
            <div>
              <div className="small muted">{choice == null ? 'Up next' : 'Selected'} · Day {preview.key}</div>
              <h2 style={{ margin: 0 }}>{preview.name}</h2>
            </div>
          </div>
          <div>
            {preview.exercises.map((e) => (
              <div key={e.slotId} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="grow">
                  <ExerciseName name={e.name} style={{ fontWeight: e.tier === 'T3' ? 500 : 700 }} />
                  {e.note && <div className="tiny" style={{ color: 'var(--warn)' }}>{e.note}</div>}
                </div>
                <span className={`badge ${e.tier}`}>{e.tier === 'T3' ? 'ACC' : e.tier}</span>
                <div className="small num" style={{ minWidth: 92, textAlign: 'right' }}>
                  {e.scheme}{e.loadType === 'weight' && e.weight ? <><br /><span className="muted">{fmtNum(e.weight)} {profile.units}{e.perHand ? ' ea' : ''}</span></> : null}
                </div>
              </div>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary block" onClick={() => start()} disabled={busy}>Start workout</button>
          <div className="chips" aria-label="Pick a different day">
            {days.map((d) => (
              <button key={d.dayIndex} className={`chip ${d.dayIndex === selected ? 'on' : ''}`} onClick={() => setChoice(d.dayIndex)}>{d.key}</button>
            ))}
            <button className="chip" onClick={() => start(true)} disabled={busy}>Freestyle</button>
          </div>
        </div>
      ) : today.error ? (
        <div className="card stack"><p className="error">{today.error}</p><button className="btn" onClick={() => today.reload()}>Retry</button></div>
      ) : (
        <div className="card"><p className="muted">Loading your plan…</p></div>
      )}

      {t && !t.activeWorkoutId && t.lastWorkoutDate && (
        <p className="small muted center">Last workout {fmtDate(t.lastWorkoutDate)}</p>
      )}

      <div className="card spread">
        <div>
          <b>Program</b>
          <div className="small muted">See all four days, swap exercises</div>
        </div>
        <Link className="btn sm" to="/program">Open</Link>
      </div>

      {stats.data && stats.data.recentPRs.length > 0 && (
        <div className="card">
          <h3>Recent PRs 🏆</h3>
          {stats.data.recentPRs.slice(0, 3).map((p, i) => (
            <div key={i} className="spread small" style={{ padding: '4px 0' }}>
              <span>{p.name}</span>
              <span className="num">{fmtNum(p.weight)}×{p.reps} <span className="muted">· e1RM {fmtNum(p.e1rm)}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
