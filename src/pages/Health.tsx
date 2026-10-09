import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  addHealthNotes, JOINT_NAMES, listHealthNotes, removeHealthNote, type HealthNote, type Joint,
} from '../api';
import { useAsync, useExercises, useSession } from '../hooks';
import { fmtDate } from '../format';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseName } from '../components/ExerciseName';

const SOURCE: Record<string, string> = { skip: 'from a skipped exercise', coach: 'from a coach chat', user: 'added by you' };
const SEV_COLOR = ['', 'var(--gold)', 'var(--warn)', 'var(--bad)'];
const SEV_LABEL = ['', 'mild', 'moderate', 'severe'];

function isActive(n: HealthNote) { return !n.expires_at || Date.parse(n.expires_at) > Date.now(); }

export function HealthPage() {
  const { profile } = useSession();
  const exercises = useExercises();
  const { data: notes, reload, error } = useAsync(() => listHealthNotes(), []);
  const [kind, setKind] = useState<HealthNote['kind']>('joint');
  const [joint, setJoint] = useState<Joint>('elbow');
  const [severity, setSeverity] = useState(2);
  const [text, setText] = useState('');
  const [exercise, setExercise] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const groups = useMemo(() => {
    const active = (notes ?? []).filter(isActive);
    return {
      joint: active.filter((n) => n.kind === 'joint'),
      avoid: active.filter((n) => n.kind === 'avoid'),
      prefer: active.filter((n) => n.kind === 'prefer'),
      dislike: active.filter((n) => n.kind === 'dislike'),
      note: active.filter((n) => n.kind === 'note'),
      past: (notes ?? []).filter((n) => !isActive(n)),
    };
  }, [notes]);

  const name = (id: string | null) => exercises.find((e) => e.id === id)?.name ?? id ?? '';
  const needsExercise = kind === 'avoid' || kind === 'prefer' || kind === 'dislike';

  async function add() {
    setBusy(true);
    try {
      await addHealthNotes([{
        kind, joint: kind === 'joint' ? joint : null, exercise_id: needsExercise ? exercise?.id ?? null : null,
        severity: kind === 'joint' ? severity : 1, note: text.trim(), source: 'user', workout_id: null, expires_at: null,
      }]);
      setText('');
      setExercise(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const Item = ({ n, children }: { n: HealthNote; children: React.ReactNode }) => (
    <div className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <div className="grow">
        {children}
        {n.note && <div className="small">{n.note}</div>}
        <div className="tiny muted">
          {fmtDate(n.created_at.slice(0, 10))} · {SOURCE[n.source] ?? n.source}
          {n.expires_at ? ` · fades ${fmtDate(n.expires_at.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}
        </div>
      </div>
      <button className="btn sm ghost" aria-label="Remove" onClick={async () => { await removeHealthNote(n.id); await reload(); }}>Remove</button>
    </div>
  );

  const Section = ({ title, items, empty, render }: { title: string; items: HealthNote[]; empty: string; render: (n: HealthNote) => React.ReactNode }) => (
    <div className="card">
      <h3>{title}</h3>
      {items.length ? items.map((n) => <Item key={n.id} n={n}>{render(n)}</Item>) : <p className="small muted">{empty}</p>}
    </div>
  );

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/settings" className="small">← Settings</Link>
          <h1>Health profile</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Built from your skip reasons, coach chats and your own notes. It shapes suggestions, the coach's advice and program rebuilds.
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {profile.limitations.length > 0 && (
        <div className="card">
          <h3>Joints protected in your profile</h3>
          <p className="small">{profile.limitations.map((j) => JOINT_NAMES[j]).join(', ')}</p>
          <Link to="/settings" className="small">Change in Settings</Link>
        </div>
      )}

      <Section title="Sensitive joints" items={groups.joint} empty="Nothing recorded."
        render={(n) => (
          <div style={{ fontWeight: 600 }}>
            <span className="health-sev" style={{ background: SEV_COLOR[n.severity] }} />
            {n.joint ? JOINT_NAMES[n.joint][0].toUpperCase() + JOINT_NAMES[n.joint].slice(1) : 'Joint'} · {SEV_LABEL[n.severity]}
          </div>
        )} />
      <Section title="Exercises to avoid" items={groups.avoid} empty="None — suggestions use your full exercise list."
        render={(n) => <ExerciseName name={name(n.exercise_id)} style={{ fontWeight: 600 }} />} />
      <Section title="Works well for you" items={groups.prefer} empty="Nothing yet."
        render={(n) => <ExerciseName name={name(n.exercise_id)} style={{ fontWeight: 600 }} />} />
      <Section title="Don't enjoy" items={groups.dislike} empty="Nothing yet."
        render={(n) => <ExerciseName name={name(n.exercise_id)} style={{ fontWeight: 600 }} />} />
      <Section title="Notes" items={groups.note} empty="Nothing yet." render={() => null} />

      <div className="card stack">
        <h3>Add to your profile</h3>
        <div className="chips">
          {([['joint', 'Sensitive joint'], ['avoid', 'Avoid exercise'], ['prefer', 'Works well'], ['dislike', 'Don\'t enjoy'], ['note', 'Note']] as const).map(([k, l]) => (
            <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {kind === 'joint' && (
          <>
            <div className="chips">
              {(Object.keys(JOINT_NAMES) as Joint[]).map((j) => (
                <button key={j} className={`chip ${joint === j ? 'on' : ''}`} onClick={() => setJoint(j)}>{JOINT_NAMES[j]}</button>
              ))}
            </div>
            <div className="chips">
              {[1, 2, 3].map((s) => <button key={s} className={`chip ${severity === s ? 'on' : ''}`} onClick={() => setSeverity(s)}>{SEV_LABEL[s]}</button>)}
            </div>
          </>
        )}
        {needsExercise && (
          <button className="btn" onClick={() => setPicking(true)}>{exercise ? exercise.name : 'Choose exercise'}</button>
        )}
        <textarea placeholder={kind === 'note' ? 'e.g. Desk job, tight hips; had ACL surgery in 2019' : 'Details (optional)'}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" onClick={add}
          disabled={busy || (needsExercise && !exercise) || (kind === 'note' && !text.trim())}>Add</button>
      </div>

      {groups.past.length > 0 && (
        <div className="card">
          <button className="link-btn" onClick={() => setShowPast((v) => !v)}>{showPast ? 'Hide' : 'Show'} faded entries ({groups.past.length})</button>
          {showPast && groups.past.map((n) => (
            <Item key={n.id} n={n}>
              <div className="small" style={{ fontWeight: 600 }}>{n.kind === 'joint' && n.joint ? JOINT_NAMES[n.joint] : name(n.exercise_id) || n.kind}</div>
            </Item>
          ))}
        </div>
      )}

      {picking && (
        <ExercisePicker title="Choose exercise" onClose={() => setPicking(false)}
          onPick={(e) => { setExercise({ id: e.id, name: e.name }); setPicking(false); }} />
      )}
    </div>
  );
}
