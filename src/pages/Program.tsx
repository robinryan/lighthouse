import { useState } from 'react';
import { Link } from 'react-router';
import { getProgramView, localDate, regenerateProgram, setNextDay, setSlotExercise } from '../api';
import { useAsync, useSession } from '../hooks';
import { fmtNum } from '../format';
import { ExercisePicker } from '../components/ExercisePicker';

export function ProgramPage() {
  const { profile } = useSession();
  const date = localDate();
  const { data, reload } = useAsync(() => getProgramView(date), [date]);
  const [editing, setEditing] = useState<{ slotId: string; exerciseId: string } | null>(null);

  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/" className="small">← Today</Link>
          <h1>Your program</h1>
        </div>
      </div>
      <p className="small muted">
        Each day pairs a <b>heavy main lift</b> (T1, low reps, last set as many as possible) with a <b>volume main lift</b> (T2),
        then accessories. Weights go up every time you hit your reps; a missed session switches to an easier rep scheme
        before ever lowering the weight. Tap an exercise to change it.
      </p>
      {data.days.map((d) => (
        <div key={d.dayIndex} className="card">
          <div className="spread" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{d.key} · {d.name}</h2>
            {d.dayIndex === data.nextDay && <span className="badge T1">NEXT</span>}
          </div>
          {d.exercises.map((e) => (
            <button key={e.slotId} className="list-item" onClick={() => setEditing({ slotId: e.slotId, exerciseId: e.exerciseId })}>
              <span className={`badge ${e.tier}`} style={{ width: 34, textAlign: 'center' }}>{e.tier === 'T3' ? 'ACC' : e.tier}</span>
              <span className="grow">{e.name}</span>
              <span className="small muted num">{e.scheme}{e.loadType === 'weight' && e.weight ? ` · ${fmtNum(e.weight)}${profile.units}` : ''}</span>
            </button>
          ))}
          {d.dayIndex !== data.nextDay && (
            <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={async () => { await setNextDay(d.dayIndex); await reload(); }}>
              Make this next
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <Link className="btn grow" to={`/coach?prompt=${encodeURIComponent('Review my program for my goals and any joint issues. Suggest specific changes I can apply.')}`}>Ask coach to review</Link>
        <button className="btn ghost" onClick={async () => {
          if (!confirm('Rebuild accessories and main-lift choices from your profile? Your progress on each lift is kept.')) return;
          await regenerateProgram();
          await reload();
        }}>Rebuild</button>
      </div>
      {editing && (
        <ExercisePicker
          title="Replace in program" similarTo={editing.exerciseId} onClose={() => setEditing(null)}
          onPick={async (e) => {
            await setSlotExercise(editing.slotId, e.id);
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}
