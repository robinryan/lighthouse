// Domain layer: connects the pure engine to the database.

import { db, tx } from './db.js';
import { type Equipment, type Joint, EXERCISE_MAP, getExercise } from './exercises.js';
import {
  type FiveRMs, type LiftState, type PerformedSet, type Profile, type Program, type Tier, type Units,
  convertState, convertWeight, e1rm, evaluate, generateProgram, getScheme, initialState, prescribe, roundWeight,
} from './engine.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ---------------------------------------------------------------------------
// Profile

export interface FullProfile extends Profile { onboarded: boolean; limitationNotes: string }

interface ProfileRow {
  units: Units; experience: Profile['experience']; goal: Profile['goal']; days_per_week: number;
  session_minutes: number; equipment: string; limitations: string; limitation_notes: string;
  bodyweight: number | null; onboarded: number;
}

export function getProfile(userId: number): FullProfile {
  const r = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as ProfileRow | undefined;
  if (!r) throw new HttpError(404, 'Profile not found');
  return {
    units: r.units, experience: r.experience, goal: r.goal, daysPerWeek: r.days_per_week,
    sessionMinutes: r.session_minutes, equipment: JSON.parse(r.equipment) as Equipment[],
    limitations: JSON.parse(r.limitations) as Joint[], limitationNotes: r.limitation_notes,
    bodyweight: r.bodyweight, onboarded: !!r.onboarded,
  };
}

export function saveProfile(userId: number, p: FullProfile) {
  const prev = getProfile(userId);
  tx(() => {
    if (prev.onboarded && prev.units !== p.units) convertUserUnits(userId, prev.units, p.units);
    db.prepare(`UPDATE profiles SET units=?, experience=?, goal=?, days_per_week=?, session_minutes=?,
      equipment=?, limitations=?, limitation_notes=?, bodyweight=?, onboarded=? WHERE user_id=?`).run(
      p.units, p.experience, p.goal, p.daysPerWeek, p.sessionMinutes, JSON.stringify(p.equipment),
      JSON.stringify(p.limitations), p.limitationNotes, p.bodyweight, p.onboarded ? 1 : 0, userId,
    );
  });
}

/** Switch every stored weight for a user between kg and lb. */
function convertUserUnits(userId: number, from: Units, to: Units) {
  const states = db.prepare('SELECT exercise_id, tier, data FROM lift_states WHERE user_id = ?').all(userId) as
    Array<{ exercise_id: string; tier: Tier; data: string }>;
  const upd = db.prepare('UPDATE lift_states SET data = ? WHERE user_id = ? AND exercise_id = ? AND tier = ?');
  for (const s of states) {
    const ex = EXERCISE_MAP.get(s.exercise_id);
    if (!ex) continue;
    upd.run(JSON.stringify(convertState(JSON.parse(s.data), ex, from, to)), userId, s.exercise_id, s.tier);
  }
  const f = to === 'lb' ? 2.20462 : 1 / 2.20462;
  db.prepare(`UPDATE sets SET target_weight = ROUND(target_weight * ?, 1), actual_weight = ROUND(actual_weight * ?, 1)
    WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.user_id = ?)`)
    .run(f, f, userId);
  db.prepare('UPDATE bodyweights SET weight = ROUND(weight * ?, 1) WHERE user_id = ?').run(f, userId);
  const prog = db.prepare('SELECT five_rms FROM programs WHERE user_id = ?').get(userId) as { five_rms: string } | undefined;
  if (prog) {
    const five = JSON.parse(prog.five_rms) as FiveRMs;
    for (const k of Object.keys(five) as Array<keyof FiveRMs>) {
      const v = five[k];
      if (v) five[k] = Math.round(convertWeight(v, from, to));
    }
    db.prepare('UPDATE programs SET five_rms = ? WHERE user_id = ?').run(JSON.stringify(five), userId);
  }
}

// ---------------------------------------------------------------------------
// Program

export interface StoredProgram { program: Program; nextDay: number; fiveRMs: FiveRMs }

export function getProgram(userId: number): StoredProgram | null {
  const r = db.prepare('SELECT data, next_day, five_rms FROM programs WHERE user_id = ?').get(userId) as
    { data: string; next_day: number; five_rms: string } | undefined;
  if (!r) return null;
  return { program: JSON.parse(r.data), nextDay: r.next_day, fiveRMs: JSON.parse(r.five_rms) };
}

export function saveProgram(userId: number, sp: StoredProgram) {
  db.prepare(`INSERT INTO programs (user_id, data, next_day, five_rms, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, next_day=excluded.next_day, five_rms=excluded.five_rms, updated_at=excluded.updated_at`)
    .run(userId, JSON.stringify(sp.program), sp.nextDay % Math.max(1, sp.program.days.length), JSON.stringify(sp.fiveRMs));
}

export function regenerateProgram(userId: number, fiveRMs?: FiveRMs) {
  const profile = getProfile(userId);
  const existing = getProgram(userId);
  const program = generateProgram(profile);
  saveProgram(userId, { program, nextDay: existing?.nextDay ?? 0, fiveRMs: fiveRMs ?? existing?.fiveRMs ?? {} });
  return program;
}

export function setSlotExercise(userId: number, slotId: string, exerciseId: string) {
  if (!EXERCISE_MAP.has(exerciseId)) throw new HttpError(400, 'Unknown exercise');
  const sp = getProgram(userId);
  if (!sp) throw new HttpError(404, 'No program');
  const slot = sp.program.days.flatMap((d) => d.slots).find((s) => s.id === slotId);
  if (!slot) throw new HttpError(404, 'Unknown program slot');
  slot.exerciseId = exerciseId;
  saveProgram(userId, sp);
}

// ---------------------------------------------------------------------------
// Lift state

export function getLiftState(userId: number, exerciseId: string, tier: Tier): LiftState {
  const r = db.prepare('SELECT data FROM lift_states WHERE user_id = ? AND exercise_id = ? AND tier = ?')
    .get(userId, exerciseId, tier) as { data: string } | undefined;
  if (r) return JSON.parse(r.data);
  const profile = getProfile(userId);
  const five = getProgram(userId)?.fiveRMs ?? {};
  const ex = getExercise(exerciseId);
  const state = initialState(ex, tier, profile, five);
  // If this exercise has history at another tier, seed from the most recent weight used.
  if (state.weight == null) state.weight = lastWorkingWeight(userId, exerciseId);
  return state;
}

export function saveLiftState(userId: number, s: LiftState) {
  db.prepare(`INSERT INTO lift_states (user_id, exercise_id, tier, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, exercise_id, tier) DO UPDATE SET data = excluded.data`)
    .run(userId, s.exerciseId, s.tier, JSON.stringify(s));
}

function lastWorkingWeight(userId: number, exerciseId: string): number | null {
  const r = db.prepare(`SELECT s.actual_weight AS w FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND we.exercise_id = ? AND s.done = 1 AND s.kind = 'working' AND s.actual_weight IS NOT NULL
    ORDER BY w.date DESC, s.id DESC LIMIT 1`).get(userId, exerciseId) as { w: number } | undefined;
  return r?.w ?? null;
}

// ---------------------------------------------------------------------------
// Workouts

export function activeWorkoutId(userId: number): number | null {
  const r = db.prepare(`SELECT id FROM workouts WHERE user_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`)
    .get(userId) as { id: number } | undefined;
  return r?.id ?? null;
}

export function previewDay(userId: number, dayIndex: number, date: string) {
  const sp = getProgram(userId);
  if (!sp) throw new HttpError(404, 'No program yet');
  const profile = getProfile(userId);
  const day = sp.program.days[dayIndex % sp.program.days.length];
  return {
    dayIndex: dayIndex % sp.program.days.length,
    key: day.key,
    name: day.name,
    exercises: day.slots.map((slot) => {
      const ex = getExercise(slot.exerciseId);
      const state = getLiftState(userId, ex.id, slot.tier);
      const p = prescribe(state, ex, profile.goal, profile.units, date);
      const work = p.sets.find((s) => s.kind === 'working');
      return {
        slotId: slot.id, exerciseId: ex.id, name: ex.name, tier: slot.tier, scheme: p.scheme.label,
        weight: work?.targetWeight ?? null, loadType: ex.loadType, perHand: !!ex.perHand, note: p.note,
      };
    }),
  };
}

function insertExercise(
  userId: number, workoutId: number, exerciseId: string, tier: Tier, position: number,
  slotId: string | null, date: string, substitutedFrom: string | null = null,
): number {
  const profile = getProfile(userId);
  const ex = getExercise(exerciseId);
  const state = getLiftState(userId, exerciseId, tier);
  const p = prescribe(state, ex, profile.goal, profile.units, date);
  const info = db.prepare(`INSERT INTO workout_exercises
    (workout_id, exercise_id, position, tier, slot_id, scheme_label, rest_seconds, engine_note, substituted_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    workoutId, exerciseId, position, tier, slotId, p.scheme.label, p.scheme.rest, p.note, substitutedFrom,
  );
  const wexId = Number(info.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO sets (workout_exercise_id, position, kind, target_reps, target_weight, amrap)
    VALUES (?, ?, ?, ?, ?, ?)`);
  p.sets.forEach((s, i) => ins.run(wexId, i, s.kind, s.targetReps, s.targetWeight, s.amrap ? 1 : 0));
  return wexId;
}

export function startWorkout(userId: number, date: string, dayIndex?: number): number {
  const existing = activeWorkoutId(userId);
  if (existing) return existing;
  const sp = getProgram(userId);
  if (!sp) throw new HttpError(400, 'Finish setup first');
  const idx = (dayIndex ?? sp.nextDay) % sp.program.days.length;
  const day = sp.program.days[idx];
  return tx(() => {
    const info = db.prepare('INSERT INTO workouts (user_id, date, day_index, title) VALUES (?, ?, ?, ?)')
      .run(userId, date, idx, day.name);
    const workoutId = Number(info.lastInsertRowid);
    day.slots.forEach((slot, i) => insertExercise(userId, workoutId, slot.exerciseId, slot.tier, i, slot.id, date));
    return workoutId;
  });
}

export function startEmptyWorkout(userId: number, date: string, title: string): number {
  const existing = activeWorkoutId(userId);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO workouts (user_id, date, day_index, title) VALUES (?, ?, NULL, ?)')
    .run(userId, date, title || 'Freestyle workout');
  return Number(info.lastInsertRowid);
}

interface WorkoutRow {
  id: number; user_id: number; date: string; day_index: number | null; title: string; status: string;
  started_at: string; finished_at: string | null; notes: string; summary: string | null;
}
interface WexRow {
  id: number; workout_id: number; exercise_id: string; position: number; tier: Tier; slot_id: string | null;
  scheme_label: string; rest_seconds: number; notes: string; engine_note: string | null; substituted_from: string | null;
}
interface SetRow {
  id: number; workout_exercise_id: number; position: number; kind: 'warmup' | 'working'; target_reps: number | null;
  target_weight: number | null; amrap: number; actual_reps: number | null; actual_weight: number | null;
  rpe: number | null; done: number; completed_at: string | null;
}

export function ownedWorkout(userId: number, workoutId: number): WorkoutRow {
  const w = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(workoutId, userId) as WorkoutRow | undefined;
  if (!w) throw new HttpError(404, 'Workout not found');
  return w;
}

export function ownedWex(userId: number, wexId: number): WexRow & { status: string; date: string } {
  const r = db.prepare(`SELECT we.*, w.status, w.date FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
    WHERE we.id = ? AND w.user_id = ?`).get(wexId, userId) as (WexRow & { status: string; date: string }) | undefined;
  if (!r) throw new HttpError(404, 'Exercise not found');
  return r;
}

export function ownedSet(userId: number, setId: number): SetRow {
  const r = db.prepare(`SELECT s.* FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id WHERE s.id = ? AND w.user_id = ?`).get(setId, userId) as SetRow | undefined;
  if (!r) throw new HttpError(404, 'Set not found');
  return r;
}

function previousPerformance(userId: number, exerciseId: string, beforeWorkoutId: number) {
  const prev = db.prepare(`SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND we.exercise_id = ? AND w.status = 'completed' AND w.id != ?
      AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id AND s.done = 1)
    ORDER BY w.date DESC, w.id DESC LIMIT 1`).get(userId, exerciseId, beforeWorkoutId) as { id: number } | undefined;
  if (!prev) return [];
  return (db.prepare(`SELECT actual_reps AS reps, actual_weight AS weight FROM sets
    WHERE workout_exercise_id = ? AND kind = 'working' AND done = 1 ORDER BY position`).all(prev.id)) as
    Array<{ reps: number | null; weight: number | null }>;
}

function bestE1rm(userId: number, exerciseId: string, excludeWorkoutId: number): number {
  const rows = db.prepare(`SELECT s.actual_weight AS w, s.actual_reps AS r FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND we.exercise_id = ? AND s.done = 1 AND s.kind = 'working' AND w.id != ?
      AND s.actual_weight > 0 AND s.actual_reps > 0`).all(userId, exerciseId, excludeWorkoutId) as Array<{ w: number; r: number }>;
  return rows.reduce((m, x) => Math.max(m, e1rm(x.w, x.r)), 0);
}

export function getWorkout(userId: number, workoutId: number) {
  const w = ownedWorkout(userId, workoutId);
  const wexes = db.prepare('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position, id').all(workoutId) as WexRow[];
  const setsStmt = db.prepare('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position, id');
  return {
    id: w.id, date: w.date, title: w.title, status: w.status, notes: w.notes, dayIndex: w.day_index,
    startedAt: w.started_at, finishedAt: w.finished_at, summary: w.summary ? JSON.parse(w.summary) : null,
    exercises: wexes.map((we) => {
      const ex = EXERCISE_MAP.get(we.exercise_id);
      const sets = setsStmt.all(we.id) as SetRow[];
      return {
        id: we.id, exerciseId: we.exercise_id, name: ex?.name ?? we.exercise_id, tier: we.tier, slotId: we.slot_id,
        schemeLabel: we.scheme_label, restSeconds: we.rest_seconds, notes: we.notes, engineNote: we.engine_note,
        substitutedFrom: we.substituted_from, loadType: ex?.loadType ?? 'weight', perHand: !!ex?.perHand,
        equipment: ex?.equipment ?? [], cues: ex?.cues ?? '', muscles: ex?.muscles ?? [],
        previous: previousPerformance(userId, we.exercise_id, w.id),
        bestE1rm: bestE1rm(userId, we.exercise_id, w.id),
        sets: sets.map((s) => ({
          id: s.id, position: s.position, kind: s.kind, targetReps: s.target_reps, targetWeight: s.target_weight,
          amrap: !!s.amrap, actualReps: s.actual_reps, actualWeight: s.actual_weight, rpe: s.rpe, done: !!s.done,
        })),
      };
    }),
  };
}

export type WorkoutDTO = ReturnType<typeof getWorkout>;

export function updateSet(userId: number, setId: number, patch: {
  actualReps?: number | null; actualWeight?: number | null; rpe?: number | null; done?: boolean;
  targetWeight?: number | null; kind?: 'warmup' | 'working';
}) {
  const s = ownedSet(userId, setId);
  const next = {
    actual_reps: patch.actualReps !== undefined ? patch.actualReps : s.actual_reps,
    actual_weight: patch.actualWeight !== undefined ? patch.actualWeight : s.actual_weight,
    rpe: patch.rpe !== undefined ? patch.rpe : s.rpe,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : s.done,
    target_weight: patch.targetWeight !== undefined ? patch.targetWeight : s.target_weight,
    kind: patch.kind ?? s.kind,
  };
  if (next.done && !s.done) {
    next.actual_reps ??= s.target_reps;
    next.actual_weight ??= s.target_weight;
  }
  db.prepare(`UPDATE sets SET actual_reps=?, actual_weight=?, rpe=?, done=?, target_weight=?, kind=?,
    completed_at = CASE WHEN ? = 1 AND done = 0 THEN datetime('now') WHEN ? = 0 THEN NULL ELSE completed_at END WHERE id=?`)
    .run(next.actual_reps, next.actual_weight, next.rpe, next.done, next.target_weight, next.kind, next.done, next.done, setId);
  return ownedSet(userId, setId);
}

export function addSet(userId: number, wexId: number, kind: 'warmup' | 'working' = 'working') {
  ownedWex(userId, wexId);
  const last = db.prepare(`SELECT * FROM sets WHERE workout_exercise_id = ? AND kind = ? ORDER BY position DESC LIMIT 1`)
    .get(wexId, kind) as SetRow | undefined;
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sets WHERE workout_exercise_id = ?').get(wexId) as { p: number }).p;
  db.prepare(`INSERT INTO sets (workout_exercise_id, position, kind, target_reps, target_weight, amrap) VALUES (?, ?, ?, ?, ?, 0)`)
    .run(wexId, pos, kind, last?.actual_reps ?? last?.target_reps ?? 8, last?.actual_weight ?? last?.target_weight ?? null);
}

export function deleteSet(userId: number, setId: number) {
  ownedSet(userId, setId);
  db.prepare('DELETE FROM sets WHERE id = ?').run(setId);
}

export function swapExercise(userId: number, wexId: number, newExerciseId: string, scope: 'today' | 'program') {
  if (!EXERCISE_MAP.has(newExerciseId)) throw new HttpError(400, 'Unknown exercise');
  const we = ownedWex(userId, wexId);
  if (we.status !== 'in_progress') throw new HttpError(400, 'Workout is not in progress');
  tx(() => {
    db.prepare('DELETE FROM workout_exercises WHERE id = ?').run(wexId);
    insertExercise(userId, we.workout_id, newExerciseId, we.tier, we.position, we.slot_id, we.date, we.exercise_id);
    if (scope === 'program' && we.slot_id) setSlotExercise(userId, we.slot_id, newExerciseId);
  });
}

export function addExerciseToWorkout(userId: number, workoutId: number, exerciseId: string, opts: {
  sets?: number; reps?: number; restSeconds?: number; note?: string;
} = {}) {
  if (!EXERCISE_MAP.has(exerciseId)) throw new HttpError(400, 'Unknown exercise');
  const w = ownedWorkout(userId, workoutId);
  if (w.status !== 'in_progress') throw new HttpError(400, 'Workout is not in progress');
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM workout_exercises WHERE workout_id = ?').get(workoutId) as { p: number }).p;
  return tx(() => {
    const id = insertExercise(userId, workoutId, exerciseId, 'T3', pos, null, w.date);
    if (opts.sets || opts.reps) {
      const existing = db.prepare(`SELECT * FROM sets WHERE workout_exercise_id = ? AND kind = 'working' ORDER BY position`).all(id) as SetRow[];
      const n = opts.sets ?? existing.length;
      const w0 = existing[0]?.target_weight ?? null;
      db.prepare(`DELETE FROM sets WHERE workout_exercise_id = ?`).run(id);
      const ins = db.prepare(`INSERT INTO sets (workout_exercise_id, position, kind, target_reps, target_weight) VALUES (?, ?, 'working', ?, ?)`);
      for (let i = 0; i < n; i++) ins.run(id, i, opts.reps ?? existing[0]?.target_reps ?? 10, w0);
      db.prepare(`UPDATE workout_exercises SET scheme_label = ? WHERE id = ?`).run(`${n}×${opts.reps ?? existing[0]?.target_reps ?? 10}`, id);
    }
    if (opts.restSeconds) db.prepare('UPDATE workout_exercises SET rest_seconds = ? WHERE id = ?').run(opts.restSeconds, id);
    if (opts.note) db.prepare('UPDATE workout_exercises SET notes = ? WHERE id = ?').run(opts.note, id);
    return id;
  });
}

export function adjustLoad(userId: number, wexId: number, percent: number) {
  const we = ownedWex(userId, wexId);
  const ex = getExercise(we.exercise_id);
  const { units } = getProfile(userId);
  const sets = db.prepare('SELECT * FROM sets WHERE workout_exercise_id = ? AND done = 0').all(wexId) as SetRow[];
  const upd = db.prepare('UPDATE sets SET target_weight = ? WHERE id = ?');
  for (const s of sets) {
    if (s.target_weight == null || s.target_weight === 0) continue;
    upd.run(roundWeight(s.target_weight * (1 + percent / 100), ex, units), s.id);
  }
}

export interface FinishSummary {
  results: Array<{ exerciseId: string; name: string; tier: Tier; outcome: string; message: string }>;
  prs: Array<{ exerciseId: string; name: string; weight: number; reps: number; e1rm: number }>;
  volume: number;
  setsDone: number;
  durationMin: number | null;
}

export function finishWorkout(userId: number, workoutId: number): FinishSummary {
  const w = ownedWorkout(userId, workoutId);
  if (w.status !== 'in_progress') throw new HttpError(400, 'Workout already finished');
  const profile = getProfile(userId);
  const dto = getWorkout(userId, workoutId);
  const summary: FinishSummary = { results: [], prs: [], volume: 0, setsDone: 0, durationMin: null };

  tx(() => {
    const evaluated = new Set<string>();
    for (const we of dto.exercises) {
      const ex = getExercise(we.exerciseId);
      const key = `${we.exerciseId}|${we.tier}`;
      const performed: PerformedSet[] = we.sets.map((s) => ({
        kind: s.kind, targetReps: s.targetReps ?? 0, targetWeight: s.targetWeight,
        actualReps: s.actualReps, actualWeight: s.actualWeight, done: s.done,
      }));
      for (const s of we.sets) {
        if (!s.done || s.kind !== 'working') continue;
        summary.setsDone++;
        summary.volume += (s.actualWeight ?? 0) * (s.actualReps ?? 0);
      }
      // Personal record: best estimated 1RM this session beats all prior sessions.
      const best = we.sets
        .filter((s) => s.done && s.kind === 'working' && (s.actualWeight ?? 0) > 0 && (s.actualReps ?? 0) > 0)
        .map((s) => ({ w: s.actualWeight!, r: s.actualReps!, e: e1rm(s.actualWeight!, s.actualReps!) }))
        .sort((a, b) => b.e - a.e)[0];
      if (best && we.bestE1rm > 0 && best.e > we.bestE1rm + 1e-9) {
        summary.prs.push({ exerciseId: ex.id, name: ex.name, weight: best.w, reps: best.r, e1rm: Math.round(best.e * 10) / 10 });
      }
      if (evaluated.has(key)) continue;
      evaluated.add(key);
      const prev = getLiftState(userId, we.exerciseId, we.tier);
      const ev = evaluate(prev, ex, performed, profile.goal, profile.units, profile.experience, w.date);
      if (ev.outcome !== 'none') saveLiftState(userId, ev.state);
      summary.results.push({ exerciseId: ex.id, name: ex.name, tier: we.tier, outcome: ev.outcome, message: ev.message });
    }
    const started = Date.parse(w.started_at.replace(' ', 'T') + 'Z');
    summary.durationMin = Number.isFinite(started) ? Math.round((Date.now() - started) / 60000) : null;
    db.prepare(`UPDATE workouts SET status = 'completed', finished_at = datetime('now'), summary = ? WHERE id = ?`)
      .run(JSON.stringify(summary), workoutId);
    if (w.day_index != null) {
      const sp = getProgram(userId);
      if (sp) saveProgram(userId, { ...sp, nextDay: (w.day_index + 1) % sp.program.days.length });
    }
  });
  return summary;
}

export function discardWorkout(userId: number, workoutId: number) {
  ownedWorkout(userId, workoutId);
  db.prepare('DELETE FROM workouts WHERE id = ?').run(workoutId);
}

export function listWorkouts(userId: number, limit = 50, before?: string) {
  const rows = db.prepare(`SELECT w.id, w.date, w.title, w.status, w.started_at, w.finished_at, w.summary,
      (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
        WHERE we.workout_id = w.id AND s.done = 1 AND s.kind = 'working') AS sets_done,
      (SELECT GROUP_CONCAT(exercise_id) FROM (SELECT exercise_id FROM workout_exercises WHERE workout_id = w.id ORDER BY position)) AS ex_ids
    FROM workouts w WHERE w.user_id = ? AND w.status = 'completed' AND (? IS NULL OR w.date < ?)
    ORDER BY w.date DESC, w.id DESC LIMIT ?`).all(userId, before ?? null, before ?? null, limit) as Array<{
      id: number; date: string; title: string; status: string; started_at: string; finished_at: string | null;
      summary: string | null; sets_done: number; ex_ids: string | null;
    }>;
  return rows.map((r) => {
    const s = r.summary ? (JSON.parse(r.summary) as FinishSummary) : null;
    return {
      id: r.id, date: r.date, title: r.title, setsDone: r.sets_done,
      volume: s?.volume ?? 0, prs: s?.prs.length ?? 0, durationMin: s?.durationMin ?? null,
      exercises: (r.ex_ids ?? '').split(',').filter(Boolean).map((id) => EXERCISE_MAP.get(id)?.name ?? id),
    };
  });
}

// ---------------------------------------------------------------------------
// Onboarding

export function completeOnboarding(userId: number, profile: FullProfile, fiveRMs: FiveRMs) {
  tx(() => {
    saveProfile(userId, { ...profile, onboarded: true });
    db.prepare('DELETE FROM lift_states WHERE user_id = ?').run(userId);
    const program = generateProgram(profile);
    saveProgram(userId, { program, nextDay: 0, fiveRMs });
  });
}

export function schemeFor(userId: number, exerciseId: string, tier: Tier) {
  const p = getProfile(userId);
  const s = getLiftState(userId, exerciseId, tier);
  return getScheme(p.goal, tier, s.stage, getExercise(exerciseId));
}
