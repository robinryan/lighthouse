// Health profile, skipping, and exercise suggestions.

import { EXERCISE_MAP } from '../../supabase/functions/_shared/exercises.ts';
import {
  type HealthNote, type HealthSummary, type NewHealthNote, type SkipFeedback,
  healthNotesFromSkip, parseSkip, summarizeHealth,
} from '../../supabase/functions/_shared/health.ts';
import { type RecContext, type Suggestion, recommendAdd, recommendReplacement } from '../../supabase/functions/_shared/recommend.ts';
import { type FullProfile, type SetRow, type WexRow, loadWorkout, must } from '../../supabase/functions/_shared/queries.ts';
import { db } from './client';
import { getProfile, swapExercise } from './training';

// ---------------------------------------------------------------------------
// Health notes

export async function listHealthNotes(): Promise<HealthNote[]> {
  return must(await db().from('health_notes').select('*').order('created_at', { ascending: false })) as HealthNote[];
}

export async function addHealthNotes(notes: NewHealthNote[]) {
  if (notes.length) must(await db().from('health_notes').insert(notes));
}

export async function removeHealthNote(id: number) {
  must(await db().from('health_notes').delete().eq('id', id));
}

export async function getHealthSummary(profile?: FullProfile): Promise<HealthSummary> {
  const p = profile ?? await getProfile();
  return summarizeHealth(await listHealthNotes(), p.limitations);
}

// ---------------------------------------------------------------------------
// Skipping

export async function skipExercise(wexId: number, feedback: SkipFeedback) {
  const we = must(await db().from('workout_exercises').select('id, workout_id, exercise_id').eq('id', wexId).maybeSingle()) as
    Pick<WexRow, 'id' | 'workout_id' | 'exercise_id'> | null;
  if (!we) throw new Error('Exercise not found');
  must(await db().from('workout_exercises').update({ skipped: true, skip_reason: JSON.stringify(feedback) }).eq('id', wexId));
  await addHealthNotes(healthNotesFromSkip(feedback, we.exercise_id, true, we.workout_id));
}

export async function unskipExercise(wexId: number) {
  must(await db().from('workout_exercises').update({ skipped: false, skip_reason: null }).eq('id', wexId));
}

/** Skip one set (feedback given) or un-skip it (feedback null). */
export async function skipSet(setId: number, feedback: SkipFeedback | null) {
  const set = must(await db().from('sets').select('id, workout_exercise_id').eq('id', setId).maybeSingle()) as Pick<SetRow, 'id' | 'workout_exercise_id'> | null;
  if (!set) throw new Error('Set not found');
  if (!feedback) {
    must(await db().from('sets').update({ skipped: false, skip_reason: null }).eq('id', setId));
    return;
  }
  must(await db().from('sets').update({ skipped: true, done: false, completed_at: null, skip_reason: JSON.stringify(feedback) }).eq('id', setId));
  const we = must(await db().from('workout_exercises').select('workout_id, exercise_id').eq('id', set.workout_exercise_id).single()) as
    { workout_id: number; exercise_id: string };
  await addHealthNotes(healthNotesFromSkip(feedback, we.exercise_id, false, we.workout_id));
}

// ---------------------------------------------------------------------------
// Suggestions

async function recContext(workoutId: number | null): Promise<RecContext> {
  const profile = await getProfile();
  const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [health, recent, everDone, loaded] = await Promise.all([
    getHealthSummary(profile),
    db().from('done_sets').select('exercise_id').eq('kind', 'working').gte('date', since).limit(1000).then(must) as Promise<Array<{ exercise_id: string }>>,
    db().from('done_sets').select('exercise_id').eq('kind', 'working').order('set_id', { ascending: false }).limit(1000).then(must) as Promise<Array<{ exercise_id: string }>>,
    workoutId != null ? loadWorkout(db(), workoutId) : Promise.resolve(null),
  ]);
  const muscleSets: Record<string, number> = {};
  for (const r of recent) {
    const ex = EXERCISE_MAP.get(r.exercise_id);
    if (!ex || ex.category === 'mobility') continue;
    for (const m of ex.muscles) muscleSets[m] = (muscleSets[m] ?? 0) + 1;
  }
  const todayMuscleSets: Record<string, number> = {};
  const inWorkout = new Set<string>();
  for (const we of loaded?.exercises ?? []) {
    if (we.skipped) continue;
    inWorkout.add(we.exercise_id);
    const ex = EXERCISE_MAP.get(we.exercise_id);
    if (!ex || ex.category === 'mobility') continue;
    const sets = we.sets.filter((s) => s.kind === 'working' && !s.skipped).length;
    for (const m of ex.muscles) todayMuscleSets[m] = (todayMuscleSets[m] ?? 0) + sets;
  }
  return {
    equipment: profile.equipment, goal: profile.goal, health, muscleSets, todayMuscleSets, inWorkout,
    history: new Set(everDone.map((r) => r.exercise_id)),
  };
}

export async function getAddSuggestions(workoutId: number | null, limit = 8): Promise<Suggestion[]> {
  return recommendAdd(await recContext(workoutId), limit);
}

export async function getReplacementSuggestions(wexId: number, limit = 5): Promise<Suggestion[]> {
  const we = must(await db().from('workout_exercises').select('workout_id, exercise_id, skip_reason').eq('id', wexId).single()) as
    { workout_id: number; exercise_id: string; skip_reason: string | null };
  let feedback = parseSkip(we.skip_reason);
  if (!feedback) {
    // Set-level skip: use the most recent skipped set's reason.
    const sets = must(await db().from('sets').select('skip_reason').eq('workout_exercise_id', wexId).eq('skipped', true)
      .order('position', { ascending: false }).limit(1)) as Array<{ skip_reason: string | null }>;
    feedback = parseSkip(sets[0]?.skip_reason ?? null);
  }
  const ctx = await recContext(we.workout_id);
  ctx.inWorkout.delete(we.exercise_id);
  return recommendReplacement(ctx, we.exercise_id, feedback, limit);
}

/** Replace a skipped exercise for today: the skipped one is swapped out. */
export async function replaceSkipped(wexId: number, exerciseId: string) {
  await unskipExercise(wexId);
  await swapExercise(wexId, exerciseId, 'today');
}

export type { HealthNote, Suggestion };
