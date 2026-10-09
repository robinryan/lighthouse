// Training domain: connects the pure engine to Supabase. Row level security
// scopes every query to the signed-in user.

import { EXERCISE_MAP, getExercise } from '../../supabase/functions/_shared/exercises.ts';
import { EXERCISE_TIPS, videoUrl } from '../../supabase/functions/_shared/exerciseTips.ts';
import {
  type FiveRMs, type LiftState, type PerformedSet, type Tier, type Units,
  convertState, convertWeight, e1rm, evaluate, generateProgram, initialState, prescribe, roundWeight,
} from '../../supabase/functions/_shared/engine.ts';
import {
  type DoneSetRow, type FullProfile, type SetRow, type StoredProgram, type WexRow, type WorkoutRow,
  loadProfile, loadProgram, loadWorkout, must, selectAll,
} from '../../supabase/functions/_shared/queries.ts';
import { currentUserId, db } from './client';
import type { DayPreview, FinishSummary, Today, Workout, WorkoutListItem } from './types';

// ---------------------------------------------------------------------------
// Profile

export const getProfile = () => loadProfile(db());

function profileColumns(p: FullProfile) {
  return {
    name: p.name, units: p.units, experience: p.experience, goal: p.goal, days_per_week: p.daysPerWeek,
    session_minutes: p.sessionMinutes, equipment: p.equipment, limitations: p.limitations,
    limitation_notes: p.limitationNotes, bodyweight: p.bodyweight, onboarded: p.onboarded,
  };
}

export async function saveProfile(p: FullProfile): Promise<FullProfile> {
  const prev = await getProfile();
  const uid = await currentUserId();
  if (prev.onboarded && prev.units !== p.units) await convertUserUnits(prev.units, p.units);
  // convert_units rescales the stored bodyweight; keep the caller's value unless it was untouched.
  const bodyweight = prev.units !== p.units && p.bodyweight === prev.bodyweight && p.bodyweight != null
    ? Math.round(convertWeight(p.bodyweight, prev.units, p.units) * 10) / 10
    : p.bodyweight;
  must(await db().from('profiles').update(profileColumns({ ...p, bodyweight })).eq('user_id', uid));
  return getProfile();
}

async function convertUserUnits(from: Units, to: Units) {
  must(await db().rpc('convert_units', { factor: to === 'lb' ? 2.20462 : 1 / 2.20462 }));
  const states = must(await db().from('lift_states').select('exercise_id, tier, data')) as
    Array<{ exercise_id: string; tier: Tier; data: LiftState }>;
  const rows = states.flatMap((s) => {
    const ex = EXERCISE_MAP.get(s.exercise_id);
    return ex ? [{ exercise_id: s.exercise_id, tier: s.tier, data: convertState(s.data, ex, from, to) }] : [];
  });
  if (rows.length) must(await db().from('lift_states').upsert(rows, { onConflict: 'user_id,exercise_id,tier' }));
  const sp = await getProgram();
  if (sp) {
    const five: FiveRMs = { ...sp.fiveRMs };
    for (const k of Object.keys(five) as Array<keyof FiveRMs>) {
      const v = five[k];
      if (v) five[k] = Math.round(convertWeight(v, from, to));
    }
    await saveProgram({ ...sp, fiveRMs: five });
  }
}

// ---------------------------------------------------------------------------
// Program

export const getProgram = () => loadProgram(db());

export async function saveProgram(sp: StoredProgram) {
  must(await db().from('programs').upsert({
    data: sp.program, next_day: sp.nextDay % Math.max(1, sp.program.days.length),
    five_rms: sp.fiveRMs, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }));
}

export async function regenerateProgram() {
  const profile = await getProfile();
  const existing = await getProgram();
  // Fold the health profile in: strongly sensitive joints count as limitations, and avoided exercises are steered around.
  const { getHealthSummary } = await import('./health');
  const health = await getHealthSummary(profile);
  const limitations = [...new Set([...profile.limitations,
    ...(Object.entries(health.joints) as Array<[typeof profile.limitations[number], number]>).filter(([, s]) => s >= 2).map(([j]) => j)])];
  const avoid = new Set([...health.avoid.keys(), ...health.dislike]);
  await saveProgram({ program: generateProgram({ ...profile, limitations }, avoid), nextDay: existing?.nextDay ?? 0, fiveRMs: existing?.fiveRMs ?? {} });
}

export async function setSlotExercise(slotId: string, exerciseId: string) {
  if (!EXERCISE_MAP.has(exerciseId)) throw new Error('Unknown exercise');
  const sp = await getProgram();
  if (!sp) throw new Error('No program');
  const slot = sp.program.days.flatMap((d) => d.slots).find((s) => s.id === slotId);
  if (!slot) throw new Error('Unknown program slot');
  slot.exerciseId = exerciseId;
  await saveProgram(sp);
}

export async function setNextDay(dayIndex: number) {
  const sp = await getProgram();
  if (!sp) throw new Error('No program');
  await saveProgram({ ...sp, nextDay: dayIndex });
}

export async function completeOnboarding(profile: FullProfile, fiveRMs: FiveRMs) {
  await saveProfile({ ...profile, onboarded: true });
  const uid = await currentUserId();
  must(await db().from('lift_states').delete().eq('user_id', uid));
  await saveProgram({ program: generateProgram(profile), nextDay: 0, fiveRMs });
}

// ---------------------------------------------------------------------------
// Lift state

interface Ctx { profile: FullProfile; program: StoredProgram | null; states: Map<string, LiftState> }

async function loadCtx(): Promise<Ctx> {
  const [profile, program, rows] = await Promise.all([
    getProfile(), getProgram(),
    db().from('lift_states').select('exercise_id, tier, data').then(must) as Promise<Array<{ exercise_id: string; tier: Tier; data: LiftState }>>,
  ]);
  return { profile, program, states: new Map(rows.map((r) => [`${r.exercise_id}|${r.tier}`, r.data])) };
}

async function lastWorkingWeight(exerciseId: string): Promise<number | null> {
  const rows = must(await db().from('done_sets').select('actual_weight').eq('exercise_id', exerciseId)
    .eq('kind', 'working').not('actual_weight', 'is', null)
    .order('date', { ascending: false }).order('set_id', { ascending: false }).limit(1)) as Array<{ actual_weight: number }>;
  return rows[0]?.actual_weight ?? null;
}

/** Lift state, or a fresh one. With `useHistory`, an exercise we can't estimate starts from its last logged weight. */
async function liftState(ctx: Ctx, exerciseId: string, tier: Tier, useHistory = false): Promise<LiftState> {
  const key = `${exerciseId}|${tier}`;
  const known = ctx.states.get(key);
  if (known) return known;
  const s = initialState(getExercise(exerciseId), tier, ctx.profile, ctx.program?.fiveRMs ?? {});
  if (!useHistory) return s;
  if (s.weight == null) s.weight = await lastWorkingWeight(exerciseId);
  ctx.states.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Today / previews

async function preview(ctx: Ctx, dayIndex: number, date: string): Promise<DayPreview> {
  const days = ctx.program!.program.days;
  const idx = dayIndex % days.length;
  const day = days[idx];
  const exercises = await Promise.all(day.slots.map(async (slot) => {
    const ex = getExercise(slot.exerciseId);
    const p = prescribe(await liftState(ctx, ex.id, slot.tier), ex, ctx.profile.goal, ctx.profile.units, date);
    const work = p.sets.find((s) => s.kind === 'working');
    return {
      slotId: slot.id, exerciseId: ex.id, name: ex.name, tier: slot.tier, scheme: p.scheme.label,
      weight: work?.targetWeight ?? null, loadType: ex.loadType, perHand: !!ex.perHand, note: p.note,
    };
  }));
  return { dayIndex: idx, key: day.key, name: day.name, exercises };
}

export async function getProgramView(date: string) {
  const ctx = await loadCtx();
  if (!ctx.program) return null;
  const days = await Promise.all(ctx.program.program.days.map((_, i) => preview(ctx, i, date)));
  return { nextDay: ctx.program.nextDay, fiveRMs: ctx.program.fiveRMs, days };
}

export async function activeWorkoutId(): Promise<number | null> {
  const rows = must(await db().from('workouts').select('id').eq('status', 'in_progress')
    .order('id', { ascending: false }).limit(1)) as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

export async function getToday(date: string): Promise<Today> {
  const ctx = await loadCtx();
  const [active, last, days] = await Promise.all([
    activeWorkoutId(),
    db().from('workouts').select('date').eq('status', 'completed').order('date', { ascending: false }).limit(1).then(must),
    ctx.program ? Promise.all(ctx.program.program.days.map((_, i) => preview(ctx, i, date))) : Promise.resolve([]),
  ]);
  return {
    activeWorkoutId: active,
    next: ctx.program ? days[ctx.program.nextDay % days.length] : null,
    days,
    lastWorkoutDate: (last as Array<{ date: string }>)[0]?.date ?? null,
  };
}

// ---------------------------------------------------------------------------
// Workouts

async function insertExercise(
  ctx: Ctx, workoutId: number, exerciseId: string, tier: Tier, position: number,
  slotId: string | null, date: string, substitutedFrom: string | null = null,
): Promise<number> {
  const ex = getExercise(exerciseId);
  const p = prescribe(await liftState(ctx, exerciseId, tier, true), ex, ctx.profile.goal, ctx.profile.units, date);
  const row = must(await db().from('workout_exercises').insert({
    workout_id: workoutId, exercise_id: exerciseId, position, tier, slot_id: slotId, scheme_label: p.scheme.label,
    rest_seconds: p.scheme.rest, engine_note: p.note, substituted_from: substitutedFrom,
  }).select('id').single()) as { id: number };
  must(await db().from('sets').insert(p.sets.map((s, i) => ({
    workout_exercise_id: row.id, position: i, kind: s.kind, target_reps: s.targetReps, target_weight: s.targetWeight, amrap: s.amrap,
  }))));
  return row.id;
}

export async function startWorkout(opts: { date: string; dayIndex?: number; empty?: boolean; title?: string }): Promise<number> {
  const existing = await activeWorkoutId();
  if (existing) return existing;
  const ctx = await loadCtx();
  if (opts.empty) {
    const w = must(await db().from('workouts').insert({ date: opts.date, day_index: null, title: opts.title || 'Freestyle workout' })
      .select('id').single()) as { id: number };
    return w.id;
  }
  if (!ctx.program) throw new Error('Finish setup first');
  const days = ctx.program.program.days;
  const idx = (opts.dayIndex ?? ctx.program.nextDay) % days.length;
  const day = days[idx];
  const w = must(await db().from('workouts').insert({ date: opts.date, day_index: idx, title: day.name }).select('id').single()) as { id: number };
  try {
    for (let i = 0; i < day.slots.length; i++) {
      const slot = day.slots[i];
      await insertExercise(ctx, w.id, slot.exerciseId, slot.tier, i, slot.id, opts.date);
    }
  } catch (e) {
    await db().from('workouts').delete().eq('id', w.id);
    throw e;
  }
  return w.id;
}

function toDTOSet(s: SetRow) {
  return {
    id: s.id, position: s.position, kind: s.kind, targetReps: s.target_reps, targetWeight: s.target_weight,
    amrap: s.amrap, actualReps: s.actual_reps, actualWeight: s.actual_weight, rpe: s.rpe, done: s.done,
    skipped: !!s.skipped, skipReason: s.skip_reason ?? null,
  };
}

export async function getWorkout(id: number): Promise<Workout> {
  const { workout: w, exercises } = await loadWorkout(db(), id);
  const ids = [...new Set(exercises.map((e) => e.exercise_id))];
  // Previous performance and best e1RM come from other completed workouts.
  const history = ids.length
    ? await selectAll<DoneSetRow>(() => db().from('done_sets').select('*').in('exercise_id', ids).eq('kind', 'working')
      .neq('workout_id', id).order('date', { ascending: false }).order('workout_id', { ascending: false }).order('position'))
    : [];
  return {
    id: w.id, date: w.date, title: w.title, status: w.status, notes: w.notes, dayIndex: w.day_index,
    startedAt: w.started_at, finishedAt: w.finished_at, summary: (w.summary as FinishSummary | null) ?? null,
    exercises: exercises.map((we) => {
      const ex = EXERCISE_MAP.get(we.exercise_id);
      const mine = history.filter((h) => h.exercise_id === we.exercise_id);
      const lastWorkout = mine[0]?.workout_id;
      return {
        id: we.id, exerciseId: we.exercise_id, name: ex?.name ?? we.exercise_id, tier: we.tier, slotId: we.slot_id,
        schemeLabel: we.scheme_label, restSeconds: we.rest_seconds, notes: we.notes, engineNote: we.engine_note,
        substitutedFrom: we.substituted_from, loadType: ex?.loadType ?? 'weight', perHand: !!ex?.perHand,
        equipment: ex?.equipment ?? [], cues: ex?.cues ?? '', muscles: ex?.muscles ?? [],
        previous: mine.filter((h) => h.workout_id === lastWorkout).map((h) => ({ reps: h.actual_reps, weight: h.actual_weight })),
        bestE1rm: mine.reduce((m, h) => Math.max(m, e1rm(h.actual_weight ?? 0, h.actual_reps ?? 0)), 0),
        sets: we.sets.map(toDTOSet),
        tips: EXERCISE_TIPS[we.exercise_id] ?? [],
        videoUrl: videoUrl(ex?.name ?? we.exercise_id),
        skipped: !!we.skipped, skipReason: we.skip_reason ?? null,
      };
    }),
  };
}

export async function updateWorkout(id: number, patch: { notes?: string; title?: string; date?: string }) {
  must(await db().from('workouts').update(patch).eq('id', id));
}

export async function discardWorkout(id: number) {
  must(await db().from('workouts').delete().eq('id', id));
}

export interface SetPatch {
  actualReps?: number | null; actualWeight?: number | null; rpe?: number | null; done?: boolean;
  targetWeight?: number | null; kind?: 'warmup' | 'working';
}

export async function updateSet(id: number, patch: SetPatch) {
  const cur = must(await db().from('sets').select('*').eq('id', id).maybeSingle()) as SetRow | null;
  if (!cur) throw new Error('Set not found');
  const next: Partial<SetRow> = {};
  if (patch.actualReps !== undefined) next.actual_reps = patch.actualReps == null ? null : Math.round(patch.actualReps);
  if (patch.actualWeight !== undefined) next.actual_weight = patch.actualWeight;
  if (patch.rpe !== undefined) next.rpe = patch.rpe;
  if (patch.targetWeight !== undefined) next.target_weight = patch.targetWeight;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.done !== undefined) {
    next.done = patch.done;
    if (patch.done && !cur.done) {
      next.completed_at = new Date().toISOString();
      if ((next.actual_reps ?? cur.actual_reps) == null) next.actual_reps = cur.target_reps;
      if ((next.actual_weight ?? cur.actual_weight) == null) next.actual_weight = cur.target_weight;
    }
    if (!patch.done) next.completed_at = null;
  }
  must(await db().from('sets').update(next).eq('id', id));
}

export async function addSet(wexId: number, kind: 'warmup' | 'working' = 'working') {
  const sets = must(await db().from('sets').select('*').eq('workout_exercise_id', wexId).order('position')) as SetRow[];
  const last = [...sets].reverse().find((s) => s.kind === kind);
  must(await db().from('sets').insert({
    workout_exercise_id: wexId, position: sets.length ? Math.max(...sets.map((s) => s.position)) + 1 : 0, kind,
    target_reps: last?.actual_reps ?? last?.target_reps ?? 8, target_weight: last?.actual_weight ?? last?.target_weight ?? null,
  }));
}

export async function deleteSet(id: number) {
  must(await db().from('sets').delete().eq('id', id));
}

async function loadWex(wexId: number) {
  const we = must(await db().from('workout_exercises').select('*').eq('id', wexId).maybeSingle()) as WexRow | null;
  if (!we) throw new Error('Exercise not found');
  const w = must(await db().from('workouts').select('status, date').eq('id', we.workout_id).single()) as { status: string; date: string };
  return { ...we, status: w.status, date: w.date };
}

export async function updateWorkoutExercise(wexId: number, patch: { notes?: string; restSeconds?: number }) {
  const row: Record<string, unknown> = {};
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.restSeconds !== undefined) row.rest_seconds = patch.restSeconds;
  must(await db().from('workout_exercises').update(row).eq('id', wexId));
}

export async function removeWorkoutExercise(wexId: number) {
  must(await db().from('workout_exercises').delete().eq('id', wexId));
}

export async function swapExercise(wexId: number, newExerciseId: string, scope: 'today' | 'program') {
  if (!EXERCISE_MAP.has(newExerciseId)) throw new Error('Unknown exercise');
  const we = await loadWex(wexId);
  if (we.status !== 'in_progress') throw new Error('Workout is not in progress');
  const ctx = await loadCtx();
  await insertExercise(ctx, we.workout_id, newExerciseId, we.tier, we.position, we.slot_id, we.date, we.exercise_id);
  must(await db().from('workout_exercises').delete().eq('id', wexId));
  if (scope === 'program' && we.slot_id) await setSlotExercise(we.slot_id, newExerciseId);
}

export async function addExerciseToWorkout(workoutId: number, exerciseId: string, opts: {
  sets?: number; reps?: number; restSeconds?: number; note?: string;
} = {}) {
  if (!EXERCISE_MAP.has(exerciseId)) throw new Error('Unknown exercise');
  const w = must(await db().from('workouts').select('status, date').eq('id', workoutId).maybeSingle()) as { status: string; date: string } | null;
  if (!w) throw new Error('Workout not found');
  if (w.status !== 'in_progress') throw new Error('Workout is not in progress');
  const existing = must(await db().from('workout_exercises').select('position').eq('workout_id', workoutId)) as Array<{ position: number }>;
  const pos = existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0;
  const id = await insertExercise(await loadCtx(), workoutId, exerciseId, 'T3', pos, null, w.date);
  if (opts.sets || opts.reps) {
    const sets = must(await db().from('sets').select('*').eq('workout_exercise_id', id).eq('kind', 'working').order('position')) as SetRow[];
    const n = opts.sets ?? sets.length;
    const reps = opts.reps ?? sets[0]?.target_reps ?? 10;
    must(await db().from('sets').delete().eq('workout_exercise_id', id));
    must(await db().from('sets').insert(Array.from({ length: n }, (_, i) => ({
      workout_exercise_id: id, position: i, kind: 'working', target_reps: reps, target_weight: sets[0]?.target_weight ?? null,
    }))));
    must(await db().from('workout_exercises').update({ scheme_label: `${n}×${reps}` }).eq('id', id));
  }
  const extra: Record<string, unknown> = {};
  if (opts.restSeconds) extra.rest_seconds = opts.restSeconds;
  if (opts.note) extra.notes = opts.note;
  if (Object.keys(extra).length) must(await db().from('workout_exercises').update(extra).eq('id', id));
  return id;
}

export async function adjustLoad(wexId: number, percent: number) {
  const we = await loadWex(wexId);
  const ex = getExercise(we.exercise_id);
  const { units } = await getProfile();
  const sets = must(await db().from('sets').select('*').eq('workout_exercise_id', wexId).eq('done', false)) as SetRow[];
  for (const s of sets) {
    if (!s.target_weight) continue;
    must(await db().from('sets').update({ target_weight: roundWeight(s.target_weight * (1 + percent / 100), ex, units) }).eq('id', s.id));
  }
}

export async function finishWorkout(workoutId: number): Promise<FinishSummary> {
  const dto = await getWorkout(workoutId);
  if (dto.status !== 'in_progress') throw new Error('Workout already finished');
  const ctx = await loadCtx();
  const { profile } = ctx;
  const summary: FinishSummary = { results: [], prs: [], volume: 0, setsDone: 0, durationMin: null };
  const evaluated = new Set<string>();
  const newStates: LiftState[] = [];

  for (const we of dto.exercises) {
    const ex = getExercise(we.exerciseId);
    for (const s of we.sets) {
      if (!s.done || s.skipped || s.kind !== 'working') continue;
      summary.setsDone++;
      summary.volume += (s.actualWeight ?? 0) * (s.actualReps ?? 0);
    }
    // Personal record: best estimated 1RM this session beats every earlier session.
    const best = we.sets
      .filter((s) => s.done && s.kind === 'working' && (s.actualWeight ?? 0) > 0 && (s.actualReps ?? 0) > 0)
      .map((s) => ({ w: s.actualWeight!, r: s.actualReps!, e: e1rm(s.actualWeight!, s.actualReps!) }))
      .sort((a, b) => b.e - a.e)[0];
    if (best && we.bestE1rm > 0 && best.e > we.bestE1rm + 1e-9) {
      summary.prs.push({ exerciseId: ex.id, name: ex.name, weight: best.w, reps: best.r, e1rm: Math.round(best.e * 10) / 10 });
    }
    const key = `${we.exerciseId}|${we.tier}`;
    if (evaluated.has(key)) continue;
    evaluated.add(key);
    const performed: PerformedSet[] = we.sets.map((s) => ({
      kind: s.kind, targetReps: s.targetReps ?? 0, targetWeight: s.targetWeight,
      actualReps: s.actualReps, actualWeight: s.actualWeight, done: s.done && !s.skipped, skipped: s.skipped || we.skipped,
    }));
    const prev = await liftState(ctx, we.exerciseId, we.tier);
    const ev = evaluate(prev, ex, performed, profile.goal, profile.units, profile.experience, dto.date);
    if (ev.outcome !== 'none') newStates.push(ev.state);
    summary.results.push({ exerciseId: ex.id, name: ex.name, tier: we.tier, outcome: ev.outcome, message: ev.message });
  }

  const started = Date.parse(dto.startedAt);
  summary.durationMin = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 60000)) : null;

  // Mark complete first (guarded on status) so a double tap can't apply progression twice.
  const done = must(await db().from('workouts').update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', workoutId).eq('status', 'in_progress').select('id')) as Array<{ id: number }>;
  if (!done.length) throw new Error('Workout already finished');
  if (newStates.length) {
    must(await db().from('lift_states').upsert(
      newStates.map((s) => ({ exercise_id: s.exerciseId, tier: s.tier, data: s })),
      { onConflict: 'user_id,exercise_id,tier' },
    ));
  }
  if (dto.dayIndex != null && ctx.program) {
    await saveProgram({ ...ctx.program, nextDay: (dto.dayIndex + 1) % ctx.program.program.days.length });
  }
  return summary;
}

export async function listWorkouts(limit = 30): Promise<WorkoutListItem[]> {
  const rows = must(await db().from('workouts').select('id, date, title, summary').eq('status', 'completed')
    .order('date', { ascending: false }).order('id', { ascending: false }).limit(limit)) as Array<Pick<WorkoutRow, 'id' | 'date' | 'title' | 'summary'>>;
  if (!rows.length) return [];
  const wexes = must(await db().from('workout_exercises').select('workout_id, exercise_id, position')
    .in('workout_id', rows.map((r) => r.id)).order('position')) as Array<{ workout_id: number; exercise_id: string }>;
  return rows.map((r) => {
    const s = r.summary as FinishSummary | null;
    return {
      id: r.id, date: r.date, title: r.title, setsDone: s?.setsDone ?? 0, volume: s?.volume ?? 0,
      prs: s?.prs.length ?? 0, durationMin: s?.durationMin ?? null,
      exercises: wexes.filter((w) => w.workout_id === r.id).map((w) => EXERCISE_MAP.get(w.exercise_id)?.name ?? w.exercise_id),
    };
  });
}
