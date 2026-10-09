import { db } from './db.js';
import { EXERCISE_MAP, type Muscle } from './exercises.js';
import { e1rm } from './engine.js';
import type { FinishSummary } from './training.js';

interface DoneSet { workout_id: number; date: string; exercise_id: string; w: number | null; r: number | null; rpe: number | null }

function doneSets(userId: number, exerciseId?: string, sinceDate?: string): DoneSet[] {
  return db.prepare(`SELECT w.id AS workout_id, w.date, we.exercise_id, s.actual_weight AS w, s.actual_reps AS r, s.rpe
    FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND w.status = 'completed' AND s.done = 1 AND s.kind = 'working'
      AND (? IS NULL OR we.exercise_id = ?) AND (? IS NULL OR w.date >= ?)
    ORDER BY w.date, w.id, s.position`).all(userId, exerciseId ?? null, exerciseId ?? null, sinceDate ?? null, sinceDate ?? null) as DoneSet[];
}

export function exerciseHistory(userId: number, exerciseId: string) {
  const byWorkout = new Map<number, { date: string; sets: Array<{ weight: number | null; reps: number | null; rpe: number | null }> }>();
  for (const s of doneSets(userId, exerciseId)) {
    const entry = byWorkout.get(s.workout_id) ?? { date: s.date, sets: [] };
    entry.sets.push({ weight: s.w, reps: s.r, rpe: s.rpe });
    byWorkout.set(s.workout_id, entry);
  }
  const sessions = [...byWorkout.entries()].map(([workoutId, v]) => {
    const top = [...v.sets].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    return {
      workoutId, date: v.date, sets: v.sets,
      topWeight: top?.weight ?? 0, topReps: top?.reps ?? 0,
      e1rm: Math.round(Math.max(0, ...v.sets.map((s) => e1rm(s.weight ?? 0, s.reps ?? 0))) * 10) / 10,
      volume: v.sets.reduce((a, s) => a + (s.weight ?? 0) * (s.reps ?? 0), 0),
      totalReps: v.sets.reduce((a, s) => a + (s.reps ?? 0), 0),
    };
  });
  // Rep PRs: heaviest weight lifted for each rep count.
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

export function trainedExercises(userId: number) {
  const rows = db.prepare(`SELECT we.exercise_id AS id, COUNT(DISTINCT w.id) AS sessions, MAX(w.date) AS last
    FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND w.status = 'completed'
      AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id AND s.done = 1)
    GROUP BY we.exercise_id ORDER BY sessions DESC`).all(userId) as Array<{ id: string; sessions: number; last: string }>;
  return rows.map((r) => ({ ...r, name: EXERCISE_MAP.get(r.id)?.name ?? r.id }));
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDate(d);
}

export function summary(userId: number, today: string) {
  const workouts = db.prepare(`SELECT id, date, summary FROM workouts WHERE user_id = ? AND status = 'completed' ORDER BY date DESC`)
    .all(userId) as Array<{ id: number; date: string; summary: string | null }>;

  // Week streak: consecutive weeks (ending this or last week) with at least one workout.
  const weeks = new Set(workouts.map((w) => mondayOf(w.date)));
  let streak = 0;
  const cursor = new Date(mondayOf(today) + 'T00:00:00Z');
  if (!weeks.has(isoDate(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 7);
  while (weeks.has(isoDate(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 7); }

  const weekStart = mondayOf(today);
  const thisWeek = workouts.filter((w) => w.date >= weekStart).length;

  // Hard sets per muscle over the last 7 days (primary muscles only).
  const since = new Date(today + 'T00:00:00Z');
  since.setUTCDate(since.getUTCDate() - 6);
  const muscleSets: Partial<Record<Muscle, number>> = {};
  for (const s of doneSets(userId, undefined, isoDate(since))) {
    const ex = EXERCISE_MAP.get(s.exercise_id);
    if (!ex || ex.category === 'mobility') continue;
    for (const m of ex.muscles) muscleSets[m] = (muscleSets[m] ?? 0) + 1;
  }

  const recentPRs = workouts.slice(0, 30).flatMap((w) => {
    const s = w.summary ? (JSON.parse(w.summary) as FinishSummary) : null;
    return (s?.prs ?? []).map((p) => ({ ...p, date: w.date }));
  }).slice(0, 8);

  const mains = ['squat', 'bench', 'deadlift', 'ohp'].map((id) => {
    const h = exerciseHistory(userId, id);
    return { exerciseId: id, name: h.name, bestE1rm: h.bestE1rm, sessions: h.sessions.length,
      trend: h.sessions.slice(-12).map((s) => ({ date: s.date, e1rm: s.e1rm })) };
  });

  const days = workouts.slice(0, 120).map((w) => w.date);
  return { totalWorkouts: workouts.length, thisWeek, streakWeeks: streak, muscleSets, recentPRs, mains, days };
}

export function exportCsv(userId: number): string {
  const rows = db.prepare(`SELECT w.date, w.title, we.exercise_id, s.position, s.kind, s.actual_weight, s.actual_reps, s.rpe, we.notes
    FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
    WHERE w.user_id = ? AND w.status = 'completed' AND s.done = 1 ORDER BY w.date, w.id, we.position, s.position`)
    .all(userId) as Array<{ date: string; title: string; exercise_id: string; position: number; kind: string;
      actual_weight: number | null; actual_reps: number | null; rpe: number | null; notes: string }>;
  const { units } = db.prepare('SELECT units FROM profiles WHERE user_id = ?').get(userId) as { units: string };
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Date', 'Workout', 'Exercise', 'Set', 'Type', `Weight (${units})`, 'Reps', 'RPE', 'Notes'];
  const counters = new Map<string, number>();
  const lines = rows.map((r) => {
    const key = `${r.date}|${r.title}|${r.exercise_id}`;
    const setNo = (counters.get(key) ?? 0) + 1;
    counters.set(key, setNo);
    return [r.date, r.title, EXERCISE_MAP.get(r.exercise_id)?.name ?? r.exercise_id, setNo, r.kind,
      r.actual_weight, r.actual_reps, r.rpe, r.notes].map(esc).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}
