import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExercise, type Equipment } from '../supabase/functions/_shared/exercises.ts';
import { type HealthNote, healthNotesFromSkip, summarizeHealth } from '../supabase/functions/_shared/health.ts';
import { type RecContext, recommendAdd, recommendReplacement } from '../supabase/functions/_shared/recommend.ts';
import { EXERCISE_TIPS, videoUrl } from '../supabase/functions/_shared/exerciseTips.ts';
import { EXERCISES } from '../supabase/functions/_shared/exercises.ts';

const GYM: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'band'];
const note = (n: Partial<HealthNote>): HealthNote => ({
  id: 1, kind: 'note', joint: null, exercise_id: null, severity: 1, note: '', source: 'user', workout_id: null,
  created_at: '2026-10-01T00:00:00Z', expires_at: null, ...n,
});
const ctx = (over: Partial<RecContext> = {}): RecContext => ({
  equipment: GYM, goal: 'strength', health: summarizeHealth([]), muscleSets: {}, inWorkout: new Set(), history: new Set(), ...over,
});

test('every exercise has three form tips and a video link', () => {
  for (const e of EXERCISES) {
    assert.equal(EXERCISE_TIPS[e.id]?.length, 3, `${e.id} tips`);
    assert.match(videoUrl(e.name), /^https:\/\/www\.youtube\.com\/results\?search_query=/);
  }
});

test('pain skip records joint + avoid notes that fade; dislike is permanent', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const pain = healthNotesFromSkip({ reason: 'pain', joints: ['elbow'], note: 'outer elbow' }, 'bench', true, 5, now);
  assert.deepEqual(pain.map((n) => n.kind), ['joint', 'avoid']);
  assert.equal(pain[0].joint, 'elbow');
  assert.equal(pain[0].severity, 2);
  assert.ok(pain[0].expires_at! > now.toISOString());
  assert.equal(healthNotesFromSkip({ reason: 'dislike', joints: [], note: '' }, 'dips', true, 5)[0].expires_at, null);
  assert.equal(healthNotesFromSkip({ reason: 'time', joints: [], note: '' }, 'dips', true, 5).length, 0);
});

test('health summary: repeats raise sensitivity, expired notes drop out, declared joints count', () => {
  const h = summarizeHealth([
    note({ kind: 'joint', joint: 'elbow', severity: 1, source: 'skip' }),
    note({ kind: 'joint', joint: 'elbow', severity: 1, source: 'skip' }),
    note({ kind: 'joint', joint: 'knee', severity: 3, expires_at: '2026-01-01T00:00:00Z' }),
    note({ kind: 'avoid', exercise_id: 'skull_crusher' }),
  ], ['shoulder'], new Date('2026-10-09T00:00:00Z'));
  assert.equal(h.joints.elbow, 1.5);
  assert.equal(h.joints.knee, undefined);
  assert.equal(h.joints.shoulder, 2);
  assert.ok(h.avoid.has('skull_crusher'));
});

test('replacement after elbow pain on bench: same muscles, nothing that loads the elbow', () => {
  const recs = recommendReplacement(ctx(), 'bench', { reason: 'pain', joints: ['elbow'], note: '' });
  assert.ok(recs.length >= 3);
  for (const r of recs) assert.ok(!getExercise(r.exerciseId).stress.includes('elbow'), r.exerciseId);
  const top = getExercise(recs[0].exerciseId);
  assert.ok(top.muscles.includes('chest'), `top pick ${top.id} should train chest`);
  assert.ok(recs[0].reasons.some((x) => /elbow/.test(x)));
});

test('replacement when equipment is busy prefers different equipment', () => {
  const recs = recommendReplacement(ctx(), 'lat_pulldown', { reason: 'equipment', joints: [], note: '' });
  assert.ok(!getExercise(recs[0].exerciseId).equipment.includes('cable'), recs[0].exerciseId);
});

test('add suggestions favour under-trained muscles and respect the health profile', () => {
  const health = summarizeHealth([note({ kind: 'avoid', exercise_id: 'pullup' }), note({ kind: 'joint', joint: 'elbow', severity: 2 })]);
  const recs = recommendAdd(ctx({
    health,
    muscleSets: { chest: 14, triceps: 12, shoulders: 12, quads: 12, glutes: 12, hamstrings: 10 },
    inWorkout: new Set(['bench']),
  }));
  assert.ok(!recs.some((r) => r.exerciseId === 'pullup'), 'avoided exercise excluded');
  assert.ok(!recs.some((r) => r.exerciseId === 'bench'), 'already in workout');
  const top3 = recs.slice(0, 3).map((r) => getExercise(r.exerciseId));
  assert.ok(top3.some((e) => e.muscles.some((m) => ['back', 'biceps', 'rear_delts', 'calves', 'core'].includes(m))), top3.map((e) => e.id).join());
  assert.ok(recs.some((r) => getExercise(r.exerciseId).category === 'mobility' && r.reasons.some((x) => /elbows/.test(x))), 'elbow care suggested');
});
