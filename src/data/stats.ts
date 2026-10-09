import { EXERCISE_MAP } from '../../supabase/functions/_shared/exercises.ts';
import { e1rm } from '../../supabase/functions/_shared/engine.ts';
import { type DoneSetRow, must, selectAll } from '../../supabase/functions/_shared/queries.ts';
import { currentUserId, db } from './client';
import type { ExerciseHistory, FinishSummary, Summary } from './types';

const doneSets = (filter: (q: ReturnType<typeof base>) => ReturnType<typeof base> = (q) => q) =>
  selectAll<DoneSetRow>(() => filter(base()).order('date').order('workout_id').order('exercise_position').order('position'));
const base = () => db().from('done_sets').select('*').eq('kind', 'working');

function sessionsOf(rows: DoneSetRow[]) {
  const byWorkout = new Map<number, { date: string; sets: Array<{ weight: number | null; reps: number | null; rpe: number | null }> }>();
  for (const s of rows) {
    const entry = byWorkout.get(s.workout_id) ?? { date: s.date, sets: [] };
    entry.sets.push({ weight: s.actual_weight, reps: s.actual_reps, rpe: s.rpe });
    byWorkout.set(s.workout_id, entry);
  }
  return [...byWorkout.entries()].map(([workoutId, v]) => {
    const top = [...v.sets].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    return {
      workoutId, date: v.date, sets: v.sets,
      topWeight: top?.weight ?? 0, topReps: top?.reps ?? 0,
      e1rm: Math.round(Math.max(0, ...v.sets.map((s) => e1rm(s.weight ?? 0, s.reps ?? 0))) * 10) / 10,
      volume: v.sets.reduce((a, s) => a + (s.weight ?? 0) * (s.reps ?? 0), 0),
      totalReps: v.sets.reduce((a, s) => a + (s.reps ?? 0), 0),
    };
  });
}

function historyFrom(exerciseId: string, rows: DoneSetRow[]): ExerciseHistory {
  const sessions = sessionsOf(rows);
  // Rep records: heaviest weight lifted for each rep count.
  const repPRs = new Map<number, { weight: number; date: string }>();
  for (const s of sessions) for (const set of s.sets) {
    if (!set.reps || !set.weight) continue;
    const cur = repPRs.get(set.reps);
    if (!cur || set.weight > cur.weight) repPRs.set(set.reps, { weight: set.weight, date: s.date });
  }
  return {
    exerciseId,
    name: EXERCISE_MAP.get(exerciseId)?.name ?? exerciseId,
    sessions,
    bestE1rm: Math.max(0, ...sessions.map((s) => s.e1rm)),
    repPRs: [...repPRs.entries()].sort((a, b) => a[0] - b[0]).map(([reps, v]) => ({ reps, ...v })),
  };
}

export async function exerciseHistory(exerciseId: string): Promise<ExerciseHistory> {
  return historyFrom(exerciseId, await doneSets((q) => q.eq('exercise_id', exerciseId)));
}

export async function trainedExercises() {
  const rows = await selectAll<{ exercise_id: string; workout_id: number; date: string }>(
    () => db().from('done_sets').select('exercise_id, workout_id, date').order('set_id'));
  const by = new Map<string, { sessions: Set<number>; last: string }>();
  for (const r of rows) {
    const e = by.get(r.exercise_id) ?? { sessions: new Set<number>(), last: r.date };
    e.sessions.add(r.workout_id);
    if (r.date > e.last) e.last = r.date;
    by.set(r.exercise_id, e);
  }
  return [...by.entries()]
    .map(([id, v]) => ({ id, name: EXERCISE_MAP.get(id)?.name ?? id, sessions: v.sessions.size, last: v.last }))
    .sort((a, b) => b.sessions - a.sessions);
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDate(d);
}

export async function summary(today: string): Promise<Summary> {
  const workouts = must(await db().from('workouts').select('id, date, summary').eq('status', 'completed')
    .order('date', { ascending: false }).limit(1000)) as Array<{ id: number; date: string; summary: FinishSummary | null }>;

  // Week streak: consecutive weeks (ending this or last week) with at least one workout.
  const weeks = new Set(workouts.map((w) => mondayOf(w.date)));
  let streak = 0;
  const cursor = new Date(mondayOf(today) + 'T00:00:00Z');
  if (!weeks.has(isoDate(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 7);
  while (weeks.has(isoDate(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 7); }

  const weekStart = mondayOf(today);
  const since = new Date(today + 'T00:00:00Z');
  since.setUTCDate(since.getUTCDate() - 6);

  // Hard sets per muscle over the last 7 days (primary muscles only).
  const muscleSets: Record<string, number> = {};
  for (const s of await doneSets((q) => q.gte('date', isoDate(since)))) {
    const ex = EXERCISE_MAP.get(s.exercise_id);
    if (!ex || ex.category === 'mobility') continue;
    for (const m of ex.muscles) muscleSets[m] = (muscleSets[m] ?? 0) + 1;
  }

  const recentPRs = workouts.slice(0, 30).flatMap((w) => (w.summary?.prs ?? []).map((p) => ({ ...p, date: w.date }))).slice(0, 8);

  const mainIds = ['squat', 'bench', 'deadlift', 'ohp'];
  const mainRows = await doneSets((q) => q.in('exercise_id', mainIds));
  const mains = mainIds.map((id) => {
    const h = historyFrom(id, mainRows.filter((r) => r.exercise_id === id));
    return {
      exerciseId: id, name: h.name, bestE1rm: h.bestE1rm, sessions: h.sessions.length,
      trend: h.sessions.slice(-12).map((s) => ({ date: s.date, e1rm: s.e1rm })),
    };
  });

  return {
    totalWorkouts: workouts.length,
    thisWeek: workouts.filter((w) => w.date >= weekStart).length,
    streakWeeks: streak, muscleSets, recentPRs, mains,
    days: workouts.slice(0, 120).map((w) => w.date),
  };
}

export async function exportCsv(units: string): Promise<string> {
  const rows = await selectAll<DoneSetRow>(() => db().from('done_sets').select('*')
    .order('date').order('workout_id').order('exercise_position').order('position'));
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Date', 'Workout', 'Exercise', 'Set', 'Type', `Weight (${units})`, 'Reps', 'RPE', 'Notes'];
  const counters = new Map<string, number>();
  const lines = rows.map((r) => {
    const key = `${r.workout_exercise_id}`;
    const setNo = (counters.get(key) ?? 0) + 1;
    counters.set(key, setNo);
    return [r.date, r.title, EXERCISE_MAP.get(r.exercise_id)?.name ?? r.exercise_id, setNo, r.kind,
      r.actual_weight, r.actual_reps, r.rpe, r.exercise_notes].map(esc).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}

export async function listBodyweight() {
  return must(await db().from('bodyweights').select('date, weight').order('date')) as Array<{ date: string; weight: number }>;
}

export async function logBodyweight(date: string, weight: number) {
  must(await db().from('bodyweights').upsert({ date, weight }, { onConflict: 'user_id,date' }));
  must(await db().from('profiles').update({ bodyweight: weight }).eq('user_id', await currentUserId()));
}
