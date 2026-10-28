import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProgram, type Profile } from '../supabase/functions/_shared/engine.ts';
import { EXERCISE_MAP } from '../supabase/functions/_shared/exercises.ts';
import { type AdaptContext, adaptSession, type DoneSet, trainingFrequency, VARIETY_NOTE } from '../supabase/functions/_shared/frequency.ts';

const profile: Profile = {
  units: 'lb', experience: 'intermediate', goal: 'hypertrophy', daysPerWeek: 3, sessionMinutes: 60,
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'band'], limitations: [], bodyweight: 180,
};
const program = generateProgram(profile);
const day = (key: string) => program.days.find((d) => d.key === key)!;
const sets = (date: string, slots: Array<{ exerciseId: string; tier: DoneSet['tier'] }>, n = 3): DoneSet[] =>
  slots.flatMap((s) => Array.from({ length: n }, () => ({ date, exerciseId: s.exerciseId, tier: s.tier })));
const ctx = (recent: DoneSet[], extra: Partial<AdaptContext> = {}): AdaptContext => ({
  today: '2026-10-20', recent, equipment: profile.equipment, goal: profile.goal, limitations: [], avoid: new Set(),
  generated: program, streak: 1, ...extra,
});

test('training frequency: sessions per week, back-to-back days, streak and a suggestion', () => {
  const dates = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18', '2026-10-19'];
  const f = trainingFrequency(dates, '2026-10-20', 3);
  assert.equal(f.sessions, 10);
  assert.equal(f.windowDays, 15);
  assert.equal(f.perWeek, 4.7);
  assert.equal(f.backToBack, 6);
  assert.equal(f.streak, 3);
  assert.equal(f.suggest, 5);
  // On plan: no suggestion. Too little data: no suggestion.
  assert.equal(trainingFrequency(dates, '2026-10-20', 5).suggest, null);
  assert.equal(trainingFrequency(['2026-10-18', '2026-10-19'], '2026-10-20', 2).suggest, null);
  assert.equal(trainingFrequency([], '2026-10-20', 3).perWeek, 0);
});

test('the same accessory on consecutive days becomes a different exercise for the same muscle', () => {
  const yesterday = sets('2026-10-19', day('A1').slots);
  const a2 = day('A2');
  // The standard rotation, trained daily, doesn't repeat an accessory: nothing changes.
  assert.ok(adaptSession(a2.slots, ctx(yesterday)).every((p) => p.kind === 'keep'));
  // Triceps pushdown added to every day (by the coach): it changes, even though it was chosen.
  const withPushdown = [...a2.slots, { id: 'A2-xab0', tier: 'T3' as const, exerciseId: 'rope_pushdown' }];
  const plans = adaptSession(withPushdown, ctx(yesterday));
  const p = plans.at(-1)!;
  assert.equal(p.kind, 'swap');
  if (p.kind !== 'swap') return;
  const to = EXERCISE_MAP.get(p.exerciseId)!;
  assert.equal(to.muscles[0], 'triceps', `${p.exerciseId} still trains the triceps`);
  assert.ok(!yesterday.some((s) => s.exerciseId === p.exerciseId) && !a2.slots.some((s) => s.exerciseId === p.exerciseId));
  assert.ok(p.note.startsWith(VARIETY_NOTE) && /Pushdown in the last day\. Same muscles, different exercise/.test(p.note), p.note);
  assert.ok(plans.slice(0, -1).every((x) => x.kind === 'keep'));
  // Lat pulldown on a day that already has a row: no second back exercise, something else instead.
  const withPulldown = [...a2.slots, { id: 'A2-xab1', tier: 'T3' as const, exerciseId: 'lat_pulldown' }];
  const q = adaptSession(withPulldown, ctx(yesterday)).at(-1)!;
  assert.equal(q.kind, 'swap');
  if (q.kind !== 'swap') return;
  const m = EXERCISE_MAP.get(q.exerciseId)!.muscles[0];
  assert.ok(!a2.slots.some((s) => EXERCISE_MAP.get(s.exerciseId)!.muscles[0] === m), `${q.exerciseId} trains something new today`);
  assert.match(q.note, /today already works your back/);
});

test('a muscle worked very hard yesterday gets a day off: its accessory trains something else', () => {
  // 6+ back sets yesterday.
  const yesterday = sets('2026-10-19', [{ exerciseId: 'lat_pulldown', tier: 'T3' }, { exerciseId: 'cable_row', tier: 'T3' }]);
  const a2 = day('A2');
  const plans = adaptSession(a2.slots, ctx(yesterday));
  const i = a2.slots.findIndex((s) => EXERCISE_MAP.get(s.exerciseId)!.muscles[0] === 'back' && s.tier === 'T3');
  const p = plans[i];
  assert.equal(p.kind, 'swap');
  if (p.kind !== 'swap') return;
  const m = EXERCISE_MAP.get(p.exerciseId)!.muscles[0];
  assert.notEqual(m, 'back');
  const others = a2.slots.filter((_, j) => j !== i).map((s) => EXERCISE_MAP.get(s.exerciseId)!.muscles[0]);
  assert.ok(!others.includes(m), `${p.exerciseId} isn't already trained today`);
  assert.match(p.note, /back worked hard in the last day/);
  // Two days ago is fine.
  assert.ok(adaptSession(a2.slots, ctx(sets('2026-10-18', yesterday))).every((x) => x.kind === 'keep'));
});

test('chosen slots, equipment, joints and the avoid list are respected', () => {
  const a2 = day('A2');
  const heavyBack = sets('2026-10-19', [{ exerciseId: 'lat_pulldown', tier: 'T3' }, { exerciseId: 'cable_row', tier: 'T3' }]);
  // A slot the user or coach chose (different from the generated one) only changes for an exact repeat.
  const custom = a2.slots.map((s) => (s.tier === 'T3' && EXERCISE_MAP.get(s.exerciseId)!.muscles[0] === 'back' ? { ...s, exerciseId: 'db_row' } : s));
  assert.ok(adaptSession(custom, ctx(heavyBack)).every((p) => p.kind === 'keep'), 'chosen slot kept');
  // Replacements use available equipment, avoid protected joints and avoided exercises.
  const avoid = new Set(['rear_delt_fly', 'face_pull', 'db_row']);
  const withPulldown = [...a2.slots, { id: 'A2-xab0', tier: 'T3' as const, exerciseId: 'lat_pulldown' }];
  for (const extra of [{ limitations: ['shoulder' as const], avoid, equipment: ['dumbbell' as const, 'cable' as const] }, { equipment: ['dumbbell' as const] }]) {
    for (const p of adaptSession(withPulldown, ctx(sets('2026-10-19', day('A1').slots), extra))) {
      if (p.kind !== 'swap') continue;
      const ex = EXERCISE_MAP.get(p.exerciseId)!;
      assert.ok(!(extra.avoid?.has(ex.id)) && !(extra.limitations ?? []).some((j) => ex.stress.includes(j)));
      assert.ok(ex.equipment.every((e) => e === 'bodyweight' || extra.equipment.includes(e as never)), `${ex.id} equipment`);
    }
  }
});

test('after several days in a row, a lower-body volume lift drops a set; main heavy lifts never change', () => {
  const recent = sets('2026-10-19', day('A1').slots);
  const a2 = day('A2'); // T1 overhead press, T2 deadlift
  assert.equal(adaptSession(a2.slots, ctx(recent, { streak: 1 }))[1].kind, 'keep');
  const eased = adaptSession(a2.slots, ctx(recent, { streak: 2 }));
  assert.equal(eased[0].kind, 'keep');
  assert.deepEqual({ kind: eased[1].kind, drop: (eased[1] as { dropSets?: number }).dropSets }, { kind: 'ease', drop: 1 });
  // Upper-body volume lift isn't eased.
  const b2 = day('B2'); // T1 deadlift, T2 overhead press
  assert.equal(adaptSession(b2.slots, ctx(sets('2026-10-19', day('B1').slots), { streak: 3 }))[1].kind, 'keep');
});
