import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { getWorkout, listWorkouts } from '../api';
import { useAsync, useSession } from '../hooks';
import { fmtDate, fmtNum } from '../format';
import { WorkoutPage } from './Workout';

export function HistoryPage() {
  const { profile } = useSession();
  const { data, error } = useAsync(() => listWorkouts(), []);
  if (error) return <p className="error">{error}</p>;
  return (
    <div>
      <div className="page-header"><h1>History</h1></div>
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? (
        <div className="card"><p className="muted">No finished workouts yet. Your sessions will show up here.</p></div>
      ) : data.map((w) => (
        <Link key={w.id} to={`/history/${w.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
          <div className="spread">
            <b>{w.title}</b>
            <span className="small muted">{fmtDate(w.date)}</span>
          </div>
          <div className="small muted" style={{ margin: '4px 0' }}>{w.exercises.join(' · ')}</div>
          <div className="row small num" style={{ gap: 14 }}>
            <span>{w.setsDone} sets</span>
            <span>{fmtNum(Math.round(w.volume))} {profile.units} volume</span>
            {w.durationMin != null && <span>{w.durationMin} min</span>}
            {w.prs > 0 && <span className="badge pr">{w.prs} PR{w.prs > 1 ? 's' : ''}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function WorkoutDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useSession();
  const { data } = useAsync(() => getWorkout(Number(id)), [id]);
  const justFinished = params.get('done') === '1';
  const s = data?.summary;

  return (
    <div className="stack">
      {justFinished && s && (
        <div className="card stack">
          <h1>Workout complete 💪</h1>
          <div className="stat-grid">
            <div className="stat"><b>{s.setsDone}</b><span>sets</span></div>
            <div className="stat"><b>{fmtNum(Math.round(s.volume))}</b><span>{profile.units} volume</span></div>
            <div className="stat"><b>{s.durationMin ?? '—'}</b><span>minutes</span></div>
          </div>
          {s.prs.length > 0 && (
            <div>
              <h3>New personal records 🏆</h3>
              {s.prs.map((p) => (
                <div key={p.exerciseId} className="spread small"><span>{p.name}</span><span className="num">{fmtNum(p.weight)}×{p.reps} · e1RM {fmtNum(p.e1rm)}</span></div>
              ))}
            </div>
          )}
          <div>
            <h3>Next time</h3>
            {s.results.filter((r) => r.outcome !== 'none').map((r, i) => (
              <p key={i} className="small" style={{ margin: '4px 0' }}>
                {r.outcome === 'progress' ? '⬆️' : r.outcome === 'stage_down' || r.outcome === 'reset' || r.outcome === 'deload' ? '🔁' : '➡️'} {r.message}
              </p>
            ))}
          </div>
          <button className="btn primary block" onClick={() => navigate('/')}>Done</button>
        </div>
      )}
      {!justFinished && s && s.results.length > 0 && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Progression from this session</summary>
          {s.results.map((r, i) => <p key={i} className="small" style={{ margin: '6px 0 0' }}>{r.message}</p>)}
        </details>
      )}
      <WorkoutPage />
    </div>
  );
}
