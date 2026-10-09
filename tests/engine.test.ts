import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type LiftState, type PerformedSet, type Profile, e1rm, evaluate, generateProgram, initialState, prescribe, warmupSets,
} from '../supabase/functions/_shared/engine.ts';
import { getExercise } from '../supabase/functions/_shared/exercises.ts';

const profile: Profile = {
  units: 'kg', experience: 'beginner', goal: 'strength', daysPerWeek: 4, sessionMinutes: 60,
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'band'], limitations: [], bodyweight: 80,
};

const squat = getExercise('squat');
const bench = getExercise('bench');

function perform(p: ReturnType<typeof prescribe>, reps: (target: number, i: number) => number): PerformedSet[] {
  let i = 0;
  return p.sets.map((s) => ({
    kind: s.kind, targetReps: s.targetReps, targetWeight: s.targetWeight,
    actualReps: s.kind === 'working' ? reps(s.targetReps, i++) : s.targetReps,
    actualWeight: s.targetWeight, done: true,
  }));
}

test('program has 4 days, two main lifts each, plus accessories', () => {
  const prog = generateProgram(profile);
  assert.equal(prog.days.length, 4);
  for (const d of prog.days) {
    assert.equal(d.slots[0].tier, 'T1');
    assert.equal(d.slots[1].tier, 'T2');
    assert.equal(d.slots.filter((s) => s.tier === 'T3').length, 3);
    assert.equal(new Set(d.slots.map((s) => s.exerciseId)).size, d.slots.length, 'no duplicate exercises in a day');
  }
  assert.deepEqual(prog.days.map((d) => d.slots[0].exerciseId), ['squat', 'ohp', 'bench', 'deadlift']);
});

test('limitations steer exercise selection away from stressed joints', () => {
  const prog = generateProgram({ ...profile, limitations: ['elbow'] });
  const ids = prog.days.flatMap((d) => d.slots.filter((s) => s.tier === 'T3').map((s) => s.exerciseId));
  for (const id of ids) assert.ok(!getExercise(id).stress.includes('elbow'), `${id} stresses elbow`);
  // Bench is replaced by an elbow-friendly press.
  assert.equal(prog.days[2].slots[0].exerciseId, 'neutral_db_press');
});

test('dumbbell-only equipment picks dumbbell variants for main lifts', () => {
  const prog = generateProgram({ ...profile, equipment: ['dumbbell'] });
  assert.deepEqual(prog.days.map((d) => d.slots[0].exerciseId), ['goblet_squat', 'db_shoulder_press', 'neutral_db_press', 'db_rdl']);
});

test('starting weights come from 5RM estimates and round to plates', () => {
  const s = initialState(squat, 'T1', profile, { squat: 100 });
  assert.equal(s.weight, 85);
  const t2 = initialState(bench, 'T2', profile, { bench: 70 });
  assert.equal(t2.weight, 45); // 70 * .65 = 45.5 → 45
});

test('T1 prescription has warmups and an AMRAP last set', () => {
  const s = initialState(squat, 'T1', profile, { squat: 100 });
  const p = prescribe(s, squat, 'strength', 'kg', '2026-10-09');
  const warm = p.sets.filter((x) => x.kind === 'warmup');
  const work = p.sets.filter((x) => x.kind === 'working');
  assert.equal(work.length, 5);
  assert.ok(work.every((x) => x.targetReps === 3 && x.targetWeight === 85));
  assert.equal(work.at(-1)!.amrap, true);
  assert.deepEqual(warm.map((w) => w.targetWeight), [20, 35, 50, 67.5]);
});

test('T1 success adds weight; big AMRAP doubles the jump for beginners', () => {
  const s = initialState(squat, 'T1', profile, { squat: 100 });
  const p = prescribe(s, squat, 'strength', 'kg', '2026-10-09');
  const ok = evaluate(s, squat, perform(p, (t) => t), 'strength', 'kg', 'beginner', '2026-10-09');
  assert.equal(ok.outcome, 'progress');
  assert.equal(ok.state.weight, 90);
  const big = evaluate(s, squat, perform(p, (t, i) => (i === 4 ? 9 : t)), 'strength', 'kg', 'beginner', '2026-10-09');
  assert.equal(big.state.weight, 95);
});

test('T1 failure walks through stages then resets', () => {
  let s: LiftState = { ...initialState(squat, 'T1', profile, { squat: 100 }), weight: 120 };
  const fail = (st: LiftState) => {
    const p = prescribe(st, squat, 'strength', 'kg', '2026-10-09');
    return evaluate(st, squat, perform(p, (t, i) => (i === 0 ? 0 : t)), 'strength', 'kg', 'beginner', '2026-10-09');
  };
  let r = fail(s); assert.equal(r.outcome, 'stage_down'); assert.equal(r.state.stage, 1); assert.equal(r.state.weight, 120);
  s = r.state;
  r = fail(s); assert.equal(r.outcome, 'stage_down'); assert.equal(r.state.stage, 2);
  s = r.state;
  r = fail(s); assert.equal(r.outcome, 'reset'); assert.equal(r.state.stage, 0);
  assert.ok(r.state.weight! < 120 && r.state.weight! >= 85, `reset weight ${r.state.weight}`);
});

test('lifting lighter than prescribed (e.g. pain) is neither pass nor fail', () => {
  const s = initialState(squat, 'T1', profile, { squat: 100 });
  const p = prescribe(s, squat, 'strength', 'kg', '2026-10-09');
  const sets = perform(p, () => 1).map((x) => ({ ...x, actualWeight: 60 }));
  const r = evaluate(s, squat, sets, 'strength', 'kg', 'beginner', '2026-10-09');
  assert.equal(r.outcome, 'repeat');
  assert.equal(r.state.weight, 85);
  assert.equal(r.state.stage, 0);
});

test('T3 double progression: reps then weight, deload after 3 misses', () => {
  const curl = getExercise('db_curl');
  let s: LiftState = { ...initialState(curl, 'T3', profile, {}), weight: 10 };
  const run = (st: LiftState, reps: number[]) => {
    const p = prescribe(st, curl, 'strength', 'kg', '2026-10-09');
    return evaluate(st, curl, perform(p, (_t, i) => reps[i]), 'strength', 'kg', 'beginner', '2026-10-09');
  };
  let r = run(s, [12, 11, 10]);
  assert.deepEqual(r.state.repTargets, [13, 12, 11]);
  r = run(r.state, [15, 15, 15]);
  assert.equal(r.outcome, 'progress');
  assert.equal(r.state.weight, 12.5);
  s = r.state;
  for (let i = 0; i < 2; i++) { s = run(s, [8, 7, 6]).state; }
  r = run(s, [8, 7, 6]);
  assert.equal(r.outcome, 'deload');
  assert.equal(r.state.weight, 10);
});

test('returning after a long break reduces the prescription by 10%', () => {
  const s = { ...initialState(squat, 'T1', profile, { squat: 100 }), weight: 100, lastPerformed: '2026-09-01' };
  const p = prescribe(s, squat, 'strength', 'kg', '2026-10-09');
  assert.equal(p.sets.find((x) => x.kind === 'working')!.targetWeight, 90);
  assert.ok(p.note);
});

test('warmups for light weights skip anything at or above working weight', () => {
  assert.deepEqual(warmupSets(20, squat, 'kg'), []);
  assert.equal(e1rm(100, 1), 100);
  assert.ok(Math.abs(e1rm(100, 5) - 116.67) < 0.01);
});
