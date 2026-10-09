import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { exerciseHistory, listBodyweight, localDate, logBodyweight, summary, trainedExercises } from '../api';
import { useAsync, useSession } from '../hooks';
import { fmtDate, fmtNum, MUSCLE_LABELS } from '../format';
import { LineChart } from '../components/LineChart';

const MUSCLE_ORDER = ['chest', 'back', 'shoulders', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];

function Calendar({ days }: { days: string[] }) {
  const set = new Set(days);
  const today = new Date();
  const cells: Array<{ date: string; label: number }> = [];
  // Last 5 weeks, Monday-aligned.
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 28);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cells.push({ date: localDate(d), label: d.getDate() });
  const todayStr = localDate(today);
  return (
    <div>
      <div className="calendar small muted" style={{ marginBottom: 4 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} style={{ background: 'none', aspectRatio: 'auto' }}>{d}</div>)}
      </div>
      <div className="calendar">
        {cells.map((c) => <div key={c.date} className={`${set.has(c.date) ? 'on' : ''} ${c.date === todayStr ? 'today' : ''}`}>{c.label}</div>)}
      </div>
    </div>
  );
}

export function ProgressPage() {
  const { profile } = useSession();
  const date = localDate();
  const { data: s } = useAsync(() => summary(date), [date]);
  const { data: list } = useAsync(() => trainedExercises(), []);
  const { data: bw, reload: reloadBw } = useAsync(() => listBodyweight(), []);
  const [bwInput, setBwInput] = useState('');

  if (!s) return <p className="muted">Loading…</p>;
  const maxSets = Math.max(20, ...Object.values(s.muscleSets));

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}><h1>Progress</h1></div>

      <div className="card">
        <h3>Main lifts — estimated 1-rep max</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {s.mains.map((m) => (
            <Link key={m.exerciseId} to={`/progress/${m.exerciseId}`} className="stat" style={{ color: 'inherit' }}>
              <span>{m.name}</span>
              <b>{m.bestE1rm ? `${fmtNum(Math.round(m.bestE1rm))}` : '—'}<span className="muted" style={{ fontSize: 13 }}> {m.bestE1rm ? profile.units : ''}</span></b>
              {m.trend.length > 1 && <LineChart compact height={50} points={m.trend.map((t) => ({ x: t.date, y: t.e1rm }))} />}
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Hard sets per muscle — last 7 days</h3>
        <p className="small muted">Shaded band is the 10–20 sets/week range most research supports for growth.</p>
        {MUSCLE_ORDER.map((m) => {
          const v = s.muscleSets[m] ?? 0;
          return (
            <div key={m} className="bar-row">
              <span>{MUSCLE_LABELS[m]}</span>
              <div className="bar-track">
                <div className="bar-band" style={{ left: `${(10 / maxSets) * 100}%`, width: `${(10 / maxSets) * 100}%` }} />
                <div className="bar-fill" style={{ width: `${(v / maxSets) * 100}%` }} />
              </div>
              <span className="num" style={{ textAlign: 'right' }}>{v}</span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Training days</h3>
        <Calendar days={s.days} />
      </div>

      <div className="card">
        <h3>Bodyweight</h3>
        {bw && bw.length > 1 && <LineChart points={bw.map((b) => ({ x: b.date, y: b.weight }))} unit={` ${profile.units}`} height={140} />}
        <form className="row" style={{ marginTop: 8 }} onSubmit={async (e) => {
          e.preventDefault();
          const weight = Number(bwInput);
          if (!(weight > 0)) return;
          await logBodyweight(date, weight);
          setBwInput('');
          await reloadBw();
        }}>
          <input inputMode="decimal" placeholder={`Today's weight (${profile.units})`} value={bwInput} onChange={(e) => setBwInput(e.target.value)} />
          <button className="btn">Log</button>
        </form>
        {bw && bw.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Latest: {fmtNum(bw[bw.length - 1].weight)} {profile.units} on {fmtDate(bw[bw.length - 1].date)}</p>}
      </div>

      <div className="card">
        <h3>All exercises</h3>
        {!list?.length ? <p className="small muted">Finish a workout to see exercise history.</p> : list.map((e) => (
          <Link key={e.id} to={`/progress/${e.id}`} className="list-item" style={{ color: 'inherit' }}>
            <span className="grow">{e.name}</span>
            <span className="small muted">{e.sessions} session{e.sessions === 1 ? '' : 's'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ExerciseProgressPage() {
  const { exerciseId } = useParams();
  const { profile } = useSession();
  const { data: h } = useAsync(() => exerciseHistory(String(exerciseId)), [exerciseId]);
  const [metric, setMetric] = useState<'e1rm' | 'top' | 'volume'>('e1rm');
  if (!h) return <p className="muted">Loading…</p>;
  const pts = h.sessions.map((s) => ({ x: s.date, y: metric === 'e1rm' ? s.e1rm : metric === 'top' ? s.topWeight : s.volume }));
  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/progress" className="small">← Progress</Link>
          <h1>{h.name}</h1>
        </div>
      </div>
      <div className="card">
        <div className="chips" style={{ marginBottom: 10 }}>
          {([['e1rm', 'Est. 1RM'], ['top', 'Top set'], ['volume', 'Volume']] as const).map(([k, l]) => (
            <button key={k} className={`chip ${metric === k ? 'on' : ''}`} onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
        <LineChart points={pts} unit={` ${profile.units}`} />
        {h.bestE1rm > 0 && <p className="small muted" style={{ marginTop: 8 }}>Best estimated 1RM: <b>{fmtNum(Math.round(h.bestE1rm))} {profile.units}</b> (Epley formula)</p>}
      </div>
      {h.repPRs.length > 0 && (
        <div className="card">
          <h3>Rep records</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
            {h.repPRs.map((r) => (
              <div key={r.reps} className="stat"><span>{r.reps} rep{r.reps > 1 ? 's' : ''}</span><b style={{ fontSize: 18 }}>{fmtNum(r.weight)}</b><span>{fmtDate(r.date, { month: 'short', day: 'numeric' })}</span></div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Sessions</h3>
        {[...h.sessions].reverse().map((s) => (
          <Link key={s.workoutId} to={`/history/${s.workoutId}`} className="list-item" style={{ color: 'inherit' }}>
            <span style={{ width: 90 }} className="small muted">{fmtDate(s.date, { month: 'short', day: 'numeric' })}</span>
            <span className="grow small num">{s.sets.map((x) => `${fmtNum(x.weight ?? 0)}×${x.reps}`).join(', ')}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
