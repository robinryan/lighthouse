import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { addExerciseToWorkout, discardWorkout, finishWorkout, flushOutbox, getWorkout, getAddSuggestions, updateWorkout, type Suggestion, type WorkoutExercise } from '../api';
import { pref, useAsync, useOnline, useSession, useWakeLock } from '../hooks';
import { fmtDuration } from '../format';
import { unlockAudio, useRestTimer } from '../components/RestTimer';
import { ExercisePicker } from '../components/ExercisePicker';
import { PlateCalculator } from '../components/PlateCalculator';
import { CoachChat } from '../components/CoachChat';
import { Sheet } from '../components/Sheet';
import { ExerciseCard } from '../components/workout/ExerciseCard';

const COACH_SUGGESTIONS = [
  'My elbow hurts today — what can I do instead?',
  'What should I stretch for today\'s session?',
  'This weight feels too heavy today',
  'Low on time — what can I cut?',
];


export function WorkoutPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useSession();
  const { data: w, setData, reload, error } = useAsync(() => getWorkout(Number(id)), [id]);
  const [now, setNow] = useState(Date.now());
  const [picker, setPicker] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachPrompt, setCoachPrompt] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [timerSheet, setTimerSheet] = useState(false);
  const [plates, setPlates] = useState<number | null>(null);
  const online = useOnline();
  const timer = useRestTimer();

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Keep the screen on between sets while the workout is in progress.
  useWakeLock(!!w && w.status === 'in_progress' && pref('lh_wakelock'));
  useEffect(() => { if (online) void flushOutbox(); }, [online]);

  const progress = useMemo(() => {
    if (!w) return { done: 0, total: 0 };
    const sets = w.exercises.filter((e) => !e.skipped).flatMap((e) => e.sets.filter((s) => s.kind === 'working' && !s.skipped));
    return { done: sets.filter((s) => s.done).length, total: sets.length };
  }, [w]);

  if (error) return <p className="error">{error}</p>;
  if (!w) return <p className="muted">Loading workout…</p>;
  const readOnly = w.status !== 'in_progress';
  // The exercise you're on: the first one with sets still to do. It gets the highlight.
  const activeId = readOnly ? null : w.exercises.find((e) => !e.skipped && e.sets.some((s) => !s.done && !s.skipped))?.id ?? null;
  const nextBarbellWeight = () => {
    for (const e of w.exercises) {
      if (e.skipped || !e.equipment.includes('barbell')) continue;
      const s = e.sets.find((x) => !x.done && !x.skipped && x.targetWeight);
      if (s) return s.targetWeight!;
    }
    return 0;
  };

  const updateExercise = (exId: number, fn: (e: WorkoutExercise) => WorkoutExercise) =>
    setData((cur) => cur && { ...cur, exercises: cur.exercises.map((e) => (e.id === exId ? fn(e) : e)) });

  async function finish() {
    if (!w) return;
    const remaining = progress.total - progress.done;
    if (remaining > 0 && !confirm(`${remaining} working set${remaining === 1 ? '' : 's'} not checked off. Finish anyway? Unchecked sets count as not done.`)) return;
    setFinishing(true);
    try {
      await flushOutbox();
      await finishWorkout(w.id);
      timer.stop();
      navigate(`/history/${w.id}?done=1`, { replace: true });
    } catch (e) {
      setMsg((e as Error).message);
      setFinishing(false);
    }
  }

  async function discard() {
    if (!w || !confirm('Discard this workout? Logged sets will be deleted.')) return;
    await discardWorkout(w.id);
    navigate('/', { replace: true });
  }

  const elapsed = (now - Date.parse(w.startedAt)) / 1000;
  const openCoach = (prompt?: string) => { setCoachPrompt(prompt); setCoachOpen(true); };
  const openPicker = () => {
    setSuggestions(null);
    setPicker(true);
    getAddSuggestions(w.id).then(setSuggestions).catch(() => setSuggestions([]));
  };

  return (
    <div>
      {!readOnly && (
        <div className="workout-header">
          <button className="tool" onClick={() => setTimerSheet(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5" /></svg>
            Timer
          </button>
          <button className="tool" onClick={() => setPlates(nextBarbellWeight())}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h3M9.5 6.5v3M13.5 8h3M8 15.5h3M13.5 14l3 3M16.5 14l-3 3" /></svg>
            Plates
          </button>
          <button className="tool" onClick={() => openCoach()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
            Coach
          </button>
          <span className="grow" />
          <span className="time-pill" aria-label="Time elapsed">{fmtDuration(elapsed)}</span>
          <button className="btn primary" onClick={finish} disabled={finishing}>{finishing ? 'Saving…' : 'Finish'}</button>
        </div>
      )}
      <div className={readOnly ? 'page-header' : 'workout-title'}>
        <div className="grow">
          <h1>{w.title}</h1>
          <div className="muted num">
            {readOnly ? w.date : `${progress.done} of ${progress.total} sets done`}
          </div>
        </div>
      </div>
      {msg && <p className="error">{msg}</p>}

      {w.exercises.map((ex, i) => (
        <ExerciseCard
          key={ex.id} ex={ex} units={profile.units} readOnly={readOnly} active={ex.id === activeId}
          isLast={i === w.exercises.length - 1}
          nextName={w.exercises[i + 1]?.name ?? null}
          onLocalChange={(fn) => updateExercise(ex.id, fn)}
          onReload={reload}
          onAskCoach={openCoach}
          workoutId={w.id}
        />
      ))}

      {!readOnly && (
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn block" onClick={openPicker}>+ Add exercise</button>
          <button className="btn block" onClick={() => openCoach()}>Something hurts? Ask the coach</button>
          <label className="field"><span>Workout notes</span>
            <textarea
              defaultValue={w.notes}
              placeholder="How did it feel? Sleep, energy, anything sore?"
              onBlur={(e) => { if (e.target.value !== w.notes) void updateWorkout(w.id, { notes: e.target.value }); }}
            />
          </label>
          <button className="btn ghost danger" onClick={discard}>Discard workout</button>
        </div>
      )}

      {picker && (
        <ExercisePicker
          title="Add exercise"
          suggestions={suggestions ?? 'loading'}
          onClose={() => setPicker(false)}
          onPick={async (e) => {
            setPicker(false);
            await addExerciseToWorkout(w.id, e.id);
            await reload();
          }}
        />
      )}
      {timerSheet && (
        <Sheet onClose={() => setTimerSheet(false)} title="Rest timer">
          <div className="chips">
            {[60, 90, 120, 180, 240, 300].map((sec) => (
              <button key={sec} className="chip" onClick={() => { unlockAudio(); timer.start(sec, w.exercises.find((e) => e.id === activeId)?.name ?? w.title, w.id); setTimerSheet(false); }}>
                {fmtDuration(sec)}
              </button>
            ))}
          </div>
          {timer.timer && <button className="btn block" style={{ marginTop: 12 }} onClick={() => { timer.stop(); setTimerSheet(false); }}>Stop timer</button>}
        </Sheet>
      )}
      {plates != null && <PlateCalculator weight={plates} units={profile.units} onClose={() => setPlates(null)} />}
      {coachOpen && (
        <Sheet onClose={() => setCoachOpen(false)} tall title="Coach">
          <CoachChat workoutId={w.id} suggestions={COACH_SUGGESTIONS} onApplied={reload} initialPrompt={coachPrompt} />
        </Sheet>
      )}
    </div>
  );
}
