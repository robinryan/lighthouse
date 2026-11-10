import { useRef, useState } from 'react';
import { addExerciseToWorkout, addSet as addSetApi, deleteSet, patchSet, addStretch, parseSkip, describeSkip, removeWorkoutExercise, replaceSkipped, skipSet, swapExercise, unskipExercise, updateWorkoutExercise, type SetDTO, type Units, type WorkoutExercise } from '../../api';
import { pref } from '../../hooks';
import { fmtDuration, fmtNum } from '../../format';
import { prefs, unlockAudio, useRestTimer } from '../RestTimer';
import { ExercisePicker } from '../ExercisePicker';
import { PlateCalculator } from '../PlateCalculator';
import { Sheet } from '../Sheet';
import { SkipSheet } from '../SkipSheet';
import { ExerciseName, FormTips, tipsEnabled } from '../ExerciseName';
import { VARIETY_NOTE } from '../../../supabase/functions/_shared/frequency.ts';
import { EXERCISE_MAP } from '../../../supabase/functions/_shared/exercises.ts';
import { SetRow, parseField } from './SetRow';

/** One exercise in a workout: its header, notes, stretches, set table and menus. */
export function ExerciseCard({ ex, units, readOnly, active, isLast, nextName, onLocalChange, onReload, onAskCoach, workoutId }: {
  ex: WorkoutExercise; units: Units; readOnly: boolean; active: boolean; isLast: boolean; nextName: string | null;
  onLocalChange: (fn: (e: WorkoutExercise) => WorkoutExercise) => void; onReload: () => Promise<void>;
  onAskCoach: (prompt?: string) => void; workoutId: number;
}) {
  const timer = useRestTimer();
  const [menu, setMenu] = useState(false);
  const [swap, setSwap] = useState<null | 'pick' | { id: string; name: string }>(null);
  const [plates, setPlates] = useState<number | null>(null);
  const [skip, setSkip] = useState<null | { kind: 'exercise' } | { kind: 'set'; setId: number }>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const complete = !ex.skipped && ex.sets.length > 0 && ex.sets.every((s) => s.done || s.skipped);
  const collapsed = complete && !expanded && !readOnly && pref('lh_collapse');
  const [setOptions, setSetOptions] = useState<SetDTO | null>(null);
  const isBarbell = ex.equipment.includes('barbell');
  const working = ex.sets.filter((s) => s.kind === 'working');
  const unitLabel = units === 'lb' ? 'Lbs' : 'Kg';
  const weightHeader = ex.loadType === 'bodyweight' ? `+${unitLabel}` : ex.perHand ? `${unitLabel} ea` : unitLabel;
  const repsHeader = ex.loadType === 'time' ? 'Sec' : 'Reps';
  const showWeight = ex.loadType !== 'time' && !ex.stretch;
  const [allRecs, setAllRecs] = useState(false);

  function setLocal(setId: number, patch: Partial<SetDTO>) {
    onLocalChange((e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }));
  }

  async function toggle(s: SetDTO, typed: { reps: number | null; weight: number | null }) {
    unlockAudio();
    const done = !s.done;
    const patch: Partial<SetDTO> = { done };
    if (done) {
      patch.actualReps = typed.reps ?? s.targetReps;
      patch.actualWeight = typed.weight ?? s.targetWeight;
    }
    setLocal(s.id, patch);
    if (done && prefs().vibrate && 'vibrate' in navigator) navigator.vibrate(12);
    // Last open set of this exercise: bring the next exercise into view.
    if (done && ex.sets.every((x) => x.id === s.id || x.done || x.skipped)) {
      setExpanded(false);
      setTimeout(() => (cardRef.current?.nextElementSibling as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    }
    await patchSet(s.id, patch);
    if (done && prefs().autoStart && ex.restSeconds > 0) {
      const idx = ex.sets.findIndex((x) => x.id === s.id);
      const next = ex.sets.slice(idx + 1).find((x) => !x.done && !x.skipped);
      if (next || !isLast) {
        const rest = s.kind === 'warmup' ? Math.min(60, ex.restSeconds) : ex.restSeconds;
        const label = next
          ? `${ex.name} — ${next.kind === 'warmup' ? 'warm-up' : `set ${working.indexOf(next) + 1} of ${working.length}`}`
          : `next: ${nextName ?? 'next exercise'}`;
        timer.start(rest, label, workoutId);
      }
    }
  }

  async function edit(s: SetDTO, field: 'actualReps' | 'actualWeight' | 'rpe', raw: string, propagate = true) {
    const v = parseField(raw);
    if (v === undefined) return;
    if (s[field] === v) return;
    const value = field === 'actualReps' && v != null ? Math.round(v) : v;
    // Later sets meant to match this one (same kind and target, not yet done) take the same
    // weight/reps — unless you've already entered something different for them. AMRAP sets keep open reps.
    const followers = !propagate || field === 'rpe' || (field === 'actualReps' && s.amrap) ? [] : ex.sets
      .slice(ex.sets.findIndex((x) => x.id === s.id) + 1)
      .filter((x) => x.kind === s.kind && !x.done && !x.skipped
        && x.targetWeight === s.targetWeight && x.targetReps === s.targetReps
        && !(field === 'actualReps' && x.amrap)
        && (x[field] == null || x[field] === s[field]));
    for (const x of [s, ...followers]) setLocal(x.id, { [field]: value });
    await Promise.all([s, ...followers].map((x) => patchSet(x.id, { [field]: value })));
  }

  async function addSet(kind: 'working' | 'warmup') {
    await addSetApi(ex.id, kind);
    await onReload();
  }

  async function removeSet(s: SetDTO) {
    await deleteSet(s.id);
    onLocalChange((e) => ({ ...e, sets: e.sets.filter((x) => x.id !== s.id) }));
  }

  async function doSwap(exerciseId: string, scope: 'today' | 'program') {
    setSwap(null);
    await swapExercise(ex.id, exerciseId, scope);
    await onReload();
  }

  let workingNo = 0;
  const firstWorkWeight = working.find((s) => s.targetWeight)?.targetWeight ?? 0;
  const skipSheet = skip && (
    <SkipSheet
      target={skip.kind === 'exercise' ? { kind: 'exercise', wexId: ex.id } : { kind: 'set', wexId: ex.id, setId: skip.setId }}
      exerciseName={ex.name}
      initialFeedback={skip.kind === 'exercise' && ex.skipped ? parseSkip(ex.skipReason) : null}
      onClose={() => setSkip(null)}
      onSkipped={onReload}
      onPick={async (sug) => {
        if (skip.kind === 'exercise') await replaceSkipped(ex.id, sug.exerciseId);
        else await addExerciseToWorkout(workoutId, sug.exerciseId);
        await onReload();
      }}
      onAskCoach={(prompt) => { setSkip(null); onAskCoach(prompt); }}
    />
  );

  // The skip sheet is rendered beside the card so it keeps its state when the card flips to "skipped".
  function renderCard() {
    if (ex.skipped) {
      const why = parseSkip(ex.skipReason);
      return (
        <div ref={cardRef} className="card ex-card skipped-card">
          <div className="ex-head" style={{ paddingBottom: 0 }}>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>
                <ExerciseName name={ex.name} className="ex-title" />
                <span className="badge">SKIPPED</span>
              </div>
              {why && <div className="small muted">{describeSkip(why)}</div>}
            </div>
            {!readOnly && (
              <div className="row">
                <button className="btn sm" onClick={async () => { await unskipExercise(ex.id); await onReload(); }}>Undo</button>
              </div>
            )}
          </div>
          {!readOnly && (
            <div className="row" style={{ padding: '8px 4px 0' }}>
              <button className="btn sm grow" onClick={() => setSkip({ kind: 'exercise' })}>Find a replacement</button>
            </div>
          )}
        </div>
      );
    }

    if (collapsed) {
      const best = ex.sets.filter((x) => x.done && x.kind === 'working')
        .sort((a, b) => (b.actualWeight ?? 0) - (a.actualWeight ?? 0) || (b.actualReps ?? 0) - (a.actualReps ?? 0))[0];
      const doneCount = ex.sets.filter((x) => x.done && x.kind === 'working').length;
      return (
        <div ref={cardRef} className="card ex-card collapsed-card" role="button" tabIndex={0}
          onClick={() => setExpanded(true)} onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(true); }}>
          <span className="done-dot" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          <div className="grow">
            <div className="ex-title">{ex.name}</div>
            <div className="small muted">
              {doneCount} set{doneCount === 1 ? '' : 's'} done
              {best && ex.loadType !== 'time' && best.actualWeight ? ` · best ${fmtNum(best.actualWeight)}×${best.actualReps}` : ''}
              {ex.sets.some((x) => x.skipped) ? ' · some skipped' : ''}
            </div>
          </div>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Expand"><path d="M6 9l6 6 6-6" /></svg>
        </div>
      );
    }

    return (
      <div ref={cardRef} className={`card ex-card ${active ? 'active' : ''}`}>
        <div className="ex-head">
          <div className="grow">
            <div className="row wrap" style={{ gap: 6 }}>
              <ExerciseName name={ex.name} className="ex-title" />
              {ex.stretch
                ? <span className="badge stretch">{ex.stretch.when === 'before' ? 'STRETCH · BEFORE' : 'COOL-DOWN · AFTER'}</span>
                : <span className={`badge ${ex.tier}`}>{ex.tier === 'T1' ? 'MAIN · HEAVY' : ex.tier === 'T2' ? 'MAIN · VOLUME' : 'ACCESSORY'}</span>}
            </div>
            {ex.stretch ? (
              <div className="small muted">
                {ex.stretch.when === 'before' ? 'Before' : 'After'} {ex.stretch.forName} · <b>How long:</b> {ex.stretch.dose}
              </div>
            ) : (
              <div className="small muted">
                {ex.schemeLabel}{ex.loadType !== 'time' && firstWorkWeight ? ` @ ${fmtNum(firstWorkWeight)} ${units}${ex.perHand ? ' each' : ''}` : ''}
                {' · '}rest {fmtDuration(ex.restSeconds)}
                {ex.substitutedFrom ? ' · swapped' : ''}
              </div>
            )}
            {!ex.stretch && ex.previous.length > 0 && (
              <div className="small muted num">
                Last time{ex.previousDate ? ` (${new Date(`${ex.previousDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : ''}:{' '}
                {ex.previous.map((p) => (ex.loadType === 'time' ? `${p.reps}s` : p.weight ? `${fmtNum(p.weight)}×${p.reps}` : `×${p.reps}`)).join(', ')}
              </div>
            )}
          </div>
          {!readOnly && <button className="btn icon ghost" onClick={() => setMenu(true)} aria-label="Exercise options">⋯</button>}
        </div>
        {ex.engineNote && (
          <div className="notice" style={{ margin: '0 4px 8px' }}>
            {ex.engineNote.startsWith(VARIETY_NOTE) ? ex.engineNote.slice(VARIETY_NOTE.length).trim().replace(/^./, (c) => c.toUpperCase()) : ex.engineNote}
            {ex.engineNote.startsWith(VARIETY_NOTE) && ex.substitutedFrom && !readOnly && !ex.sets.some((x) => x.done) && (
              <> <button className="link-btn small" onClick={() => void doSwap(ex.substitutedFrom!, 'today')}>
                Do {EXERCISE_MAP.get(ex.substitutedFrom)?.name ?? 'the original'} instead
              </button></>
            )}
          </div>
        )}
        {ex.notes && <div className="small" style={{ margin: '0 4px 8px' }}>📝 {ex.notes}</div>}
        {ex.stretch?.importance != null && (
        <div className="imp-row">
          <Importance value={ex.stretch.importance} />
          <span className="small">{ex.stretch.why}</span>
        </div>
      )}
      {tipsEnabled() && <div style={{ margin: '0 4px 8px' }}><FormTips tips={ex.tips} /></div>}
      {!ex.stretch && ex.stretchRecs.length > 0 && (
        <div className="stretch-recs">
          <button className="stretch-summary" onClick={() => setAllRecs((v) => !v)} aria-expanded={allRecs}>
            <span className="small" style={{ fontWeight: 700 }}>Stretches for this lift</span>
            <span className="tiny muted grow" style={{ textAlign: 'left' }}>
              {ex.stretchRecs.slice(0, 2).map((r) => `${r.when === 'before' ? 'Before' : 'After'}: ${r.name} ${r.importance}/10`).join(' · ')}
            </span>
            <span aria-hidden="true">{allRecs ? '▴' : '▾'}</span>
          </button>
          {allRecs && ex.stretchRecs.map((r) => (
            <div key={`${r.stretchId}-${r.when}`} className="stretch-rec">
              <Importance value={r.importance} />
              <div className="grow">
                <div className="small">
                  <span className={`when ${r.when}`}>{r.when === 'before' ? 'Before' : 'After'}</span>{' '}
                  <ExerciseName name={r.name} style={{ fontWeight: 600 }} />
                </div>
                {r.dose && <div className="tiny"><b>How long:</b> {r.dose}</div>}
                <div className="tiny muted">{r.why}</div>
              </div>
              {r.inWorkout ? <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>✓ Added</span>
                : !readOnly && (
                  <button className="btn sm" onClick={async () => { await addStretch(workoutId, ex.id, r.stretchId, r.when); await onReload(); }}>Add</button>
                )}
            </div>
          ))}
        </div>
      )}

        <table className="set-table">
          <thead>
            <tr>
              <th>Set</th>
              <th>Previous</th>
              <th className="col-target">Target</th>
              {showWeight && <th>{weightHeader}</th>}
              <th>{repsHeader}</th>
              <th aria-label="Done">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12.5l4.5 4.5L16 7.5M11 16l1 1L21.5 7.5" /></svg>
              </th>
            </tr>
          </thead>
          <tbody>
            {ex.sets.map((s) => {
              const isWarm = s.kind === 'warmup';
              const current = active && s.id === ex.sets.find((x) => !x.done && !x.skipped)?.id;
              const n = isWarm ? 0 : ++workingNo;
              return (
                <SetRow
                  key={s.id} s={s} n={n} ex={ex} readOnly={readOnly} showWeight={showWeight} current={!!current} units={units}
                  prev={isWarm ? null : ex.previous[n - 1] ?? null}
                  onToggle={toggle} onEdit={edit} onMenu={setSetOptions} onDelete={removeSet}
                />
              );
            })}
          </tbody>
        </table>
        {!readOnly && working.some((s) => s.amrap && s.done) && (
          <div className="row small" style={{ padding: '4px 4px 0' }}>
            <span className="muted">AMRAP effort (RPE):</span>
            <select
              style={{ width: 90, minHeight: 34, padding: '4px 8px' }}
              value={working.find((s) => s.amrap)?.rpe ?? ''}
              onChange={(e) => { const s = working.find((x) => x.amrap)!; void edit(s, 'rpe', e.target.value); }}
            >
              <option value="">—</option>
              {[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {!readOnly && (
          <div className="row" style={{ padding: '8px 4px 0' }}>
            <button className="btn sm grow" onClick={() => void addSet('working')}>+ Add set</button>
            {isBarbell && <button className="btn sm" onClick={() => setPlates(firstWorkWeight)}>Plates</button>}
            <button className="btn sm" onClick={() => setSkip({ kind: 'exercise' })}>Skip</button>
          </div>
        )}

        {menu && (
          <Sheet onClose={() => setMenu(false)} title={ex.name}>
            <div className="stack">
              <button className="btn block" onClick={() => { setMenu(false); setSkip({ kind: 'exercise' }); }}>Skip exercise…</button>
              <button className="btn block" onClick={() => { setMenu(false); setSwap('pick'); }}>Swap exercise</button>
              <button className="btn block" onClick={() => { setMenu(false); void addSet('warmup'); }}>Add warm-up set</button>
              {isBarbell && <button className="btn block" onClick={() => { setMenu(false); setPlates(firstWorkWeight); }}>Plate calculator</button>}
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Rest timer</div>
                <div className="chips">
                  {[45, 60, 90, 120, 180, 240, 300].map((r) => (
                    <button key={r} className={`chip ${ex.restSeconds === r ? 'on' : ''}`} onClick={async () => {
                      onLocalChange((e) => ({ ...e, restSeconds: r }));
                      await updateWorkoutExercise(ex.id, { restSeconds: r });
                    }}>{fmtDuration(r)}</button>
                  ))}
                </div>
              </div>
              <label className="field"><span>Exercise note</span>
                <textarea defaultValue={ex.notes} placeholder="Seat height, grip, how it felt…" onBlur={async (e) => {
                  const notes = e.target.value;
                  onLocalChange((x) => ({ ...x, notes }));
                  await updateWorkoutExercise(ex.id, { notes });
                }} />
              </label>
              <button className="btn block danger" onClick={async () => {
                if (!confirm(`Remove ${ex.name} from this workout?`)) return;
                setMenu(false);
                await removeWorkoutExercise(ex.id);
                await onReload();
              }}>Remove from workout</button>
            </div>
          </Sheet>
        )}
        {swap === 'pick' && (
          <ExercisePicker
            title={`Swap ${ex.name}`} similarTo={ex.exerciseId} onClose={() => setSwap(null)}
            onPick={(e) => (ex.slotId ? setSwap({ id: e.id, name: e.name }) : void doSwap(e.id, 'today'))}
          />
        )}
        {swap && swap !== 'pick' && (
          <Sheet onClose={() => setSwap(null)} title={`Use ${swap.name}`}>
            <div className="stack">
              <button className="btn block primary" onClick={() => void doSwap(swap.id, 'today')}>Just for today</button>
              <button className="btn block" onClick={() => void doSwap(swap.id, 'program')}>Replace in my program</button>
            </div>
          </Sheet>
        )}
        {plates != null && <PlateCalculator weight={plates} units={units} onClose={() => setPlates(null)} />}
        {setOptions && (
          <Sheet onClose={() => setSetOptions(null)} title={`${setOptions.kind === 'warmup' ? 'Warm-up' : 'Set'} options`}>
            <div className="stack">
              {setOptions.skipped ? (
                <button className="btn block" onClick={async () => {
                  const id = setOptions.id;
                  setSetOptions(null);
                  await skipSet(id, null);
                  await onReload();
                }}>Un-skip this set</button>
              ) : (
                <button className="btn block" onClick={() => { const id = setOptions.id; setSetOptions(null); setSkip({ kind: 'set', setId: id }); }}>
                  Skip this set…
                </button>
              )}
              <button className="btn block danger" onClick={async () => {
                const target = setOptions;
                setSetOptions(null);
                await removeSet(target);
              }}>Remove set</button>
            </div>
          </Sheet>
        )}
      </div>
    );
  }

  return <>{renderCard()}{skipSheet}</>;
}

/** Importance out of 10, coloured by how much it matters. */
function Importance({ value }: { value: number }) {
  const level = value >= 7 ? 'high' : value >= 5 ? 'mid' : 'low';
  return <span className={`imp ${level}`} title={`Importance ${value} out of 10`}>{value}/10</span>;
}
