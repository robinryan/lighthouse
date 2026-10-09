// Database helpers shared by the web app and the `coach` edge function.
// `db` is a supabase-js client (typed loosely so this file works under both Node/Vite and Deno).

import type { Equipment, Joint } from './exercises.ts';
import type { FiveRMs, Profile, Program, Tier, Units } from './engine.ts';

// deno-lint-ignore no-explicit-any
export type Db = any;

export class NetworkError extends Error {
  constructor() { super('You appear to be offline.'); }
}

/** Unwrap a supabase-js result, throwing on error. Status 0 means the request never reached the server. */
export function must<T>(res: { data: T; error: { message: string } | null; status?: number }): T {
  if (res.error) {
    if (res.status === 0) throw new NetworkError();
    throw new Error(res.error.message);
  }
  return res.data;
}

export interface FullProfile extends Profile { name: string; onboarded: boolean; limitationNotes: string }

export interface ProfileRow {
  user_id: string; name: string; units: Units; experience: Profile['experience']; goal: Profile['goal'];
  days_per_week: number; session_minutes: number; equipment: Equipment[]; limitations: Joint[];
  limitation_notes: string; bodyweight: number | null; onboarded: boolean;
}

export function profileFromRow(r: ProfileRow): FullProfile {
  return {
    name: r.name, units: r.units, experience: r.experience, goal: r.goal, daysPerWeek: r.days_per_week,
    sessionMinutes: r.session_minutes, equipment: r.equipment ?? [], limitations: r.limitations ?? [],
    limitationNotes: r.limitation_notes ?? '', bodyweight: r.bodyweight, onboarded: r.onboarded,
  };
}

export async function loadProfile(db: Db): Promise<FullProfile> {
  const row = must(await db.from('profiles').select('*').maybeSingle()) as ProfileRow | null;
  if (!row) throw new Error('Profile not found');
  return profileFromRow(row);
}

export interface StoredProgram { program: Program; nextDay: number; fiveRMs: FiveRMs }

export async function loadProgram(db: Db): Promise<StoredProgram | null> {
  const row = must(await db.from('programs').select('data, next_day, five_rms').maybeSingle()) as
    { data: Program; next_day: number; five_rms: FiveRMs } | null;
  return row ? { program: row.data, nextDay: row.next_day, fiveRMs: row.five_rms ?? {} } : null;
}

export interface WorkoutRow {
  id: number; date: string; day_index: number | null; title: string; status: 'in_progress' | 'completed';
  started_at: string; finished_at: string | null; notes: string; summary: unknown;
}
export interface WexRow {
  id: number; workout_id: number; exercise_id: string; position: number; tier: Tier; slot_id: string | null;
  scheme_label: string; rest_seconds: number; notes: string; engine_note: string | null; substituted_from: string | null;
  skipped: boolean; skip_reason: string | null;
  stretch_for: string | null; stretch_when: 'before' | 'after' | null;
}
export interface SetRow {
  id: number; workout_exercise_id: number; position: number; kind: 'warmup' | 'working'; target_reps: number | null;
  target_weight: number | null; amrap: boolean; actual_reps: number | null; actual_weight: number | null;
  rpe: number | null; done: boolean; completed_at: string | null; skipped: boolean; skip_reason: string | null;
}
export interface LoadedWorkout { workout: WorkoutRow; exercises: Array<WexRow & { sets: SetRow[] }> }

export async function loadWorkout(db: Db, id: number): Promise<LoadedWorkout> {
  const workout = must(await db.from('workouts').select('*').eq('id', id).maybeSingle()) as WorkoutRow | null;
  if (!workout) throw new Error('Workout not found');
  const wexes = must(await db.from('workout_exercises').select('*').eq('workout_id', id)
    .order('position').order('id')) as WexRow[];
  const sets = wexes.length
    ? must(await db.from('sets').select('*').in('workout_exercise_id', wexes.map((w) => w.id))
      .order('position').order('id')) as SetRow[]
    : [];
  return {
    workout,
    exercises: wexes.map((w) => ({ ...w, sets: sets.filter((s) => s.workout_exercise_id === w.id) })),
  };
}

export interface DoneSetRow {
  set_id: number; workout_id: number; date: string; title: string; workout_exercise_id: number; exercise_id: string;
  tier: Tier; exercise_position: number; exercise_notes: string; position: number; kind: 'warmup' | 'working';
  actual_weight: number | null; actual_reps: number | null; rpe: number | null;
}

/** Read every page of a query (Supabase caps responses at 1000 rows). `build` must return a fresh query. */
export async function selectAll<T>(build: () => Db, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = must(await build().range(from, from + pageSize - 1)) as T[];
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}
