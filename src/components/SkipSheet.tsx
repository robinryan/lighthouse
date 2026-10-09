import { useEffect, useState } from 'react';
import {
  type Joint, type SkipFeedback, type SkipReason, type Suggestion, JOINT_NAMES, SKIP_REASONS,
  getReplacementSuggestions, skipExercise, skipSet,
} from '../api';
import { Sheet } from './Sheet';
import { ExerciseName } from './ExerciseName';

/**
 * Ask why the user is skipping, save it (which also feeds the health profile),
 * then offer ranked replacements based on that reason.
 */
export function SkipSheet({ target, exerciseName, initialFeedback, onClose, onSkipped, onPick, onAskCoach }: {
  target: { kind: 'exercise'; wexId: number } | { kind: 'set'; wexId: number; setId: number };
  exerciseName: string;
  /** Already skipped: jump straight to replacements. */
  initialFeedback?: SkipFeedback | null;
  onClose: () => void;
  onSkipped: () => void | Promise<void>;
  /** Use a suggestion: swap it in (whole-exercise skip) or add it (set skip). */
  onPick: (s: Suggestion) => Promise<void>;
  onAskCoach: (prompt: string) => void;
}) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [joints, setJoints] = useState<Joint[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SkipFeedback | null>(initialFeedback ?? null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    if (!saved) return;
    getReplacementSuggestions(target.wexId).then(setSuggestions).catch(() => setSuggestions([]));
  }, [saved, target.wexId]);

  async function save() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const feedback: SkipFeedback = { reason, joints: reason === 'pain' ? joints : [], note: note.trim() };
    try {
      if (target.kind === 'exercise') await skipExercise(target.wexId, feedback);
      else await skipSet(target.setId, feedback);
      await onSkipped();
      setSaved(feedback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const what = target.kind === 'exercise' ? exerciseName : `a set of ${exerciseName}`;

  if (saved) {
    const reasonLabel = SKIP_REASONS.find((r) => r.id === saved.reason)?.label.toLowerCase() ?? '';
    const prompt = `I skipped ${what} — ${reasonLabel}${saved.joints.length ? ` (${saved.joints.map((j) => JOINT_NAMES[j]).join(', ')})` : ''}${saved.note ? `: ${saved.note}` : ''}. What should I do instead?`;
    return (
      <Sheet onClose={onClose} tall title="Skipped">
        <p className="small muted" style={{ marginTop: 0 }}>
          Saved{saved.reason === 'pain' || saved.reason === 'dislike' ? ' to your health profile, so future suggestions take it into account' : ''}.
          {target.kind === 'set' ? ' Skipped sets don\'t count against your progression.' : ' Skipping doesn\'t count as a failed session.'}
        </p>
        <h3>{target.kind === 'exercise' ? 'Swap in instead' : 'Add something instead'}</h3>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {suggestions == null ? <p className="muted small">Finding good options…</p>
            : suggestions.length === 0 ? <p className="muted small">No good alternatives with your equipment — try the coach.</p>
            : suggestions.map((s) => (
              <div key={s.exerciseId} className="list-item" style={{ cursor: 'default' }}>
                <div className="grow">
                  <ExerciseName name={s.name} style={{ fontWeight: 600 }} />
                  <div className="small muted">{s.reasons.join(' · ')}</div>
                </div>
                <button className="btn sm primary" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { await onPick(s); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); }
                }}>{target.kind === 'exercise' ? 'Swap in' : 'Add'}</button>
              </div>
            ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn grow" onClick={() => onAskCoach(prompt)}>Ask the coach</button>
          <button className="btn grow ghost" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title={`Skip ${target.kind === 'exercise' ? 'exercise' : 'set'}`}>
      <p className="small muted" style={{ marginTop: 0 }}>Why are you skipping {what}? This helps tailor what we suggest next.</p>
      <div className="chips">
        {SKIP_REASONS.map((r) => (
          <button key={r.id} className={`chip ${reason === r.id ? 'on' : ''}`} onClick={() => setReason(r.id)}>{r.label}</button>
        ))}
      </div>
      {reason === 'pain' && (
        <>
          <div className="small muted" style={{ margin: '12px 0 6px' }}>Where?</div>
          <div className="chips">
            {(Object.keys(JOINT_NAMES) as Joint[]).map((j) => (
              <button key={j} className={`chip ${joints.includes(j) ? 'on' : ''}`}
                onClick={() => setJoints((cur) => (cur.includes(j) ? cur.filter((x) => x !== j) : [...cur, j]))}>
                {JOINT_NAMES[j][0].toUpperCase() + JOINT_NAMES[j].slice(1)}
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>Sharp pain, swelling, numbness or a "pop"? Stop and get it checked by a professional.</p>
        </>
      )}
      <textarea style={{ marginTop: 12 }} placeholder="Anything else? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={!reason || busy} onClick={save}>
        {busy ? 'Saving…' : `Skip ${target.kind === 'exercise' ? 'exercise' : 'set'}`}
      </button>
    </Sheet>
  );
}
