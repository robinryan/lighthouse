// End-to-end tests of the app's data layer and the coach core against real Postgres
// with the Supabase migration applied. Needs TEST_DATABASE_URL (a Postgres superuser
// connection); skipped otherwise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { fakeSupabase } from './fakeSupabase.ts';
import { setDb } from '../src/data/client.ts';
import * as T from '../src/data/training.ts';
import * as S from '../src/data/stats.ts';
import { applyAction, listMessages } from '../src/data/coach.ts';
import { runCoach } from '../supabase/functions/_shared/coach.ts';
import type { FullProfile } from '../supabase/functions/_shared/queries.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const dbName = `lh_test_${process.pid}`;
let admin: pg.Pool;
let pool: pg.Pool;
const A = { id: '11111111-1111-4111-8111-111111111111', email: 'robin@example.com' };
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' };
let asA: ReturnType<typeof fakeSupabase>;
let asB: ReturnType<typeof fakeSupabase>;

before(async () => {
  if (!ADMIN_URL) return;
  admin = new pg.Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  pool = new pg.Pool({ connectionString: url.toString() });
  await pool.query(fs.readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
  for (const f of fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()) {
    await pool.query(fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
  await pool.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{"name":"Robin Ryan"}'), ($3, $4, '{}')`,
    [A.id, A.email, B.id, B.email]);
  asA = fakeSupabase(pool, A);
  asB = fakeSupabase(pool, B);
});

after(async () => {
  if (!ADMIN_URL) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
});

const profile = (p: Partial<FullProfile> = {}): FullProfile => ({
  name: 'Robin Ryan', units: 'kg', experience: 'beginner', goal: 'strength', daysPerWeek: 4, sessionMinutes: 60,
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar'], limitations: [], limitationNotes: '', bodyweight: 80,
  onboarded: false, ...p,
});

const squatOf = (w: { exercises: Array<{ exerciseId: string }> }) => w.exercises.find((e) => e.exerciseId === 'squat')! as any;

async function completeAll(workoutId: number, repsFor: (tier: string, target: number) => number = (_t, n) => n) {
  const w = await T.getWorkout(workoutId);
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      await T.updateSet(s.id, {
        done: true,
        actualReps: repsFor(ex.tier, s.targetReps ?? 0),
        actualWeight: s.targetWeight ?? (ex.loadType === 'weight' ? 10 : null),
      });
    }
  }
}

test('training flow on Supabase: onboard, train, progress, history, stats', { skip: !ADMIN_URL && 'TEST_DATABASE_URL not set' }, async () => {
  setDb(asA);
  // Profile row comes from the sign-up trigger.
  assert.equal((await T.getProfile()).name, 'Robin Ryan');

  await T.completeOnboarding(profile(), { squat: 100, bench: 70, deadlift: 120, ohp: 45 });
  let today = await T.getToday('2026-10-09');
  assert.equal(today.activeWorkoutId, null);
  assert.equal(today.next!.name, 'Squat & Bench');
  assert.equal(today.next!.exercises[0].weight, 85);

  const id = await T.startWorkout({ date: '2026-10-09' });
  assert.equal(await T.startWorkout({ date: '2026-10-09' }), id, 'only one workout in progress');
  let w = await T.getWorkout(id);
  assert.ok(squatOf(w));
  assert.deepEqual(squatOf(w).sets.filter((s) => s.kind === 'warmup').map((s) => s.targetWeight), [20, 35, 50, 67.5]);

  // Ticking a set without typing fills in the targets.
  const first = squatOf(w).sets[0];
  await T.updateSet(first.id, { done: true });
  w = await T.getWorkout(id);
  assert.equal(squatOf(w).sets[0].actualWeight, 20);
  assert.equal(squatOf(w).sets[0].actualReps, 10);

  await completeAll(id, (tier, n) => (tier === 'T3' ? 15 : n));
  const summary = await T.finishWorkout(id);
  assert.equal(summary.results.find((r) => r.exerciseId === 'squat')!.outcome, 'progress');
  await assert.rejects(T.finishWorkout(id), /already finished/);

  today = await T.getToday('2026-10-11');
  assert.equal(today.next!.name, 'Overhead Press & Deadlift');
  const prog = await T.getProgramView('2026-10-11');
  assert.equal(prog!.days[0].exercises[0].weight, 90);

  // Next squat day: previous performance shows, and a heavier set is a PR.
  const id2 = await T.startWorkout({ date: '2026-10-13', dayIndex: 0 });
  w = await T.getWorkout(id2);
  const sq = w.exercises.find((e) => e.exerciseId === 'squat')!;
  assert.equal(sq.previous.length, 5);
  assert.deepEqual(sq.previous[0], { reps: 3, weight: 85 });
  assert.ok(sq.bestE1rm > 90);

  // Swap bench for an elbow-friendly press, today only.
  const bench = w.exercises.find((e) => e.exerciseId === 'bench')!;
  const benchIndex = w.exercises.indexOf(bench);
  await T.swapExercise(bench.id, 'neutral_db_press', 'today');
  w = await T.getWorkout(id2);
  const swapped = w.exercises.find((e) => e.exerciseId === 'neutral_db_press')!;
  assert.equal(swapped.substitutedFrom, 'bench');
  assert.equal(w.exercises[benchIndex].id, swapped.id, 'swap keeps the slot position');
  assert.equal((await T.getProgram())!.program.days[0].slots[1].exerciseId, 'bench', 'program unchanged');

  await completeAll(id2, (tier, n) => (tier === 'T1' ? n + 2 : tier === 'T3' ? 15 : n));
  const s2 = await T.finishWorkout(id2);
  assert.ok(s2.prs.some((p) => p.exerciseId === 'squat'), 'squat PR detected');

  const list = await T.listWorkouts();
  assert.equal(list.length, 2);
  assert.ok(list[0].exercises.includes('Neutral-Grip Dumbbell Press'));

  const hist = await S.exerciseHistory('squat');
  assert.equal(hist.sessions.length, 2);
  assert.equal(hist.repPRs.find((r) => r.reps === 5)!.weight, 90);
  const sum = await S.summary('2026-10-14');
  assert.equal(sum.totalWorkouts, 2);
  assert.equal(sum.thisWeek, 1);
  assert.equal(sum.streakWeeks, 2);
  assert.ok((sum.muscleSets.quads ?? 0) >= 5);
  const csv = await S.exportCsv('kg');
  assert.match(csv, /2026-10-09,Squat & Bench,Back Squat,1,warmup,20,10/);

  // Bodyweight log updates the profile.
  await S.logBodyweight('2026-10-14', 81.5);
  assert.equal((await T.getProfile()).bodyweight, 81.5);

  // Another user sees none of this, and can't touch it.
  setDb(asB);
  assert.equal((await T.listWorkouts()).length, 0);
  await assert.rejects(T.getWorkout(id), /not found/i);
  await T.updateSet(first.id, { actualReps: 99 }).catch(() => {});
  setDb(asA);
  assert.equal(squatOf(await T.getWorkout(id)).sets[0].actualReps, 10, 'other user could not edit');

  // Switching to lb converts history, lift states, and the program preview.
  const p = await T.getProfile();
  await T.saveProfile({ ...p, units: 'lb' });
  const afterSwitch = await T.getProgramView('2026-10-15');
  assert.equal(afterSwitch!.days[0].exercises[0].weight, 210); // 95 kg ≈ 209 lb → 210
  assert.equal((await T.getProfile()).bodyweight, 179.7);
  assert.equal(squatOf(await T.getWorkout(id)).sets[0].actualWeight, 44.1);
});

test('coach core: proposals are validated, stored, and applied by the app', { skip: !ADMIN_URL && 'TEST_DATABASE_URL not set' }, async () => {
  setDb(asB);
  await T.completeOnboarding(profile({ name: 'B' }), { squat: 100, bench: 70, deadlift: 120, ohp: 45 });
  const id = await T.startWorkout({ date: '2026-10-09' });
  const w = await T.getWorkout(id);
  const bench = w.exercises.find((e) => e.exerciseId === 'bench')!;

  const script = [
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Take the strain off your elbow.', citations: [{ type: 'web_search_result_location', url: 'https://example.org/elbow', title: 'Elbow study' }] },
        { type: 'tool_use', id: 't1', name: 'propose_swap', input: { workout_exercise_id: bench.id, new_exercise_id: 'neutral_db_press', scope: 'program', reason: 'Neutral grip.' } },
        { type: 'tool_use', id: 't2', name: 'propose_add_exercise', input: { exercise_id: 'wrist_extensor_stretch', sets: 2, reps: 30, rest_seconds: 15, note: 'Gentle.' } },
        { type: 'tool_use', id: 't3', name: 'propose_load_change', input: { workout_exercise_id: 123456, percent_change: -20, reason: 'x' } },
        { type: 'tool_use', id: 't4', name: 'propose_limitations', input: { add: ['elbow'], remove: [], note: 'Outer elbow pain on bench' } },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '- Swap to neutral grip\n- Stretch wrist extensors' }] },
  ];
  const requests: any[] = [];
  const anthropic = {
    beta: { messages: { stream: (req: any) => { requests.push(structuredClone(req)); const m = script.shift(); return { finalMessage: async () => m }; } } },
  };

  const reply = await runCoach({ db: asB, anthropic, workoutId: id, text: 'My elbow hurts on bench', today: '2026-10-09' });
  assert.equal(reply.role, 'assistant');
  assert.match(reply.content, /neutral grip/);
  assert.deepEqual(reply.actions.map((a) => a.type), ['swap', 'add', 'limitations'], 'bad workout_exercise_id rejected');
  assert.deepEqual(reply.sources, [{ url: 'https://example.org/elbow', title: 'Elbow study' }]);

  // Request shape
  assert.equal(requests[0].model, 'claude-opus-5-5');
  assert.equal(requests[0].fallbacks, 'default');
  assert.deepEqual(requests[0].betas, ['server-side-fallback-2026-07-01']);
  assert.ok(requests[0].tools.some((t: any) => t.type === 'web_search_20260209'));
  assert.match(requests[0].messages.at(-1).content[0].text, new RegExp(`workout_exercise_id=${bench.id}`));
  const results = requests[1].messages.at(-1).content;
  assert.equal(results.find((r: any) => r.tool_use_id === 't3').is_error, true);

  // The app applies / dismisses proposals.
  await applyAction(reply.id, 0, false);
  await applyAction(reply.id, 1, false);
  await applyAction(reply.id, 2, true);
  await assert.rejects(applyAction(reply.id, 0, false), /Already applied/);

  const after = await T.getWorkout(id);
  assert.ok(after.exercises.some((e) => e.exerciseId === 'neutral_db_press'));
  assert.ok(!after.exercises.some((e) => e.exerciseId === 'bench'));
  const stretch = after.exercises.find((e) => e.exerciseId === 'wrist_extensor_stretch')!;
  assert.equal(stretch.sets.length, 2);
  assert.equal(stretch.sets[0].targetReps, 30);
  assert.equal((await T.getProgram())!.program.days[0].slots[1].exerciseId, 'neutral_db_press', 'scope=program updated the slot');
  assert.deepEqual((await T.getProfile()).limitations, []);

  const msgs = await listMessages(id);
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[1].actions.map((a) => a.status), ['applied', 'applied', 'dismissed']);
  // General chat is separate from the workout chat.
  assert.equal((await listMessages(null)).length, 0);

  // User A can't read B's coach messages.
  setDb(asA);
  assert.equal((await listMessages(id)).length, 0);
});

test('skipping feeds the health profile, suggestions, progression and the coach', { skip: !ADMIN_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const H = await import('../src/data/health.ts');
  const C = { id: '33333333-3333-4333-8333-333333333333', email: 'c@example.com' };
  await pool.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{"name":"C"}')`, [C.id, C.email]);
  const asC = fakeSupabase(pool, C);
  setDb(asC);
  await T.completeOnboarding(profile({ name: 'C' }), { squat: 100, bench: 70, deadlift: 120, ohp: 45 });
  const id = await T.startWorkout({ date: '2026-10-09' });
  let w = await T.getWorkout(id);
  const bench = w.exercises.find((e) => e.exerciseId === 'bench')!;
  assert.equal(bench.tips.length, 3);
  assert.match(bench.videoUrl, /youtube\.com/);

  // Skip bench for elbow pain → health profile learns it.
  await H.skipExercise(bench.id, { reason: 'pain', joints: ['elbow'], note: 'outer elbow' });
  const notes = await H.listHealthNotes();
  assert.deepEqual(notes.map((n) => n.kind).sort(), ['avoid', 'joint']);
  assert.equal(notes.find((n) => n.kind === 'avoid')!.exercise_id, 'bench');

  // Replacements avoid the elbow and train the chest.
  const repl = await H.getReplacementSuggestions(bench.id);
  assert.ok(repl.length >= 3);
  const { getExercise } = await import('../supabase/functions/_shared/exercises.ts');
  for (const r of repl) assert.ok(!getExercise(r.exerciseId).stress.includes('elbow'), r.exerciseId);
  await H.replaceSkipped(bench.id, repl[0].exerciseId);
  w = await T.getWorkout(id);
  const swapped = w.exercises.find((e) => e.exerciseId === repl[0].exerciseId)!;
  assert.equal(swapped.substitutedFrom, 'bench');
  assert.equal(swapped.skipped, false);

  // Add-exercise suggestions skip what's already in the workout and avoided exercises.
  const adds = await H.getAddSuggestions(id);
  assert.ok(adds.length > 0);
  assert.ok(!adds.some((a) => a.exerciseId === 'bench' || w.exercises.some((e) => e.exerciseId === a.exerciseId)));

  // Skip the squat's last working set (equipment busy) → no failure on finish.
  const squat = w.exercises.find((e) => e.exerciseId === 'squat')!;
  const lastSet = squat.sets.filter((s) => s.kind === 'working').at(-1)!;
  await H.skipSet(lastSet.id, { reason: 'equipment', joints: [], note: '' });
  await completeAll(id, (tier, n) => (tier === 'T3' ? 15 : n));
  w = await T.getWorkout(id);
  assert.equal(w.exercises.find((e) => e.exerciseId === 'squat')!.sets.find((s) => s.id === lastSet.id)!.skipped, true);
  // completeAll ticked every set, including the skipped one; skipping again keeps it skipped and not done.
  await H.skipSet(lastSet.id, { reason: 'equipment', joints: [], note: '' });
  const summary = await T.finishWorkout(id);
  assert.equal(summary.results.find((r) => r.exerciseId === 'squat')!.outcome, 'repeat');

  // Rebuilding the program steers around the avoided bench and the sensitive elbow.
  await T.regenerateProgram();
  const prog = await T.getProgram();
  assert.notEqual(prog!.program.days[2].slots[0].exerciseId, 'bench');

  // Coach: records a health note directly; undo removes it.
  const script = [
    { stop_reason: 'tool_use', content: [
      { type: 'text', text: 'Noted — I\'ll keep that in mind.' },
      { type: 'tool_use', id: 'h1', name: 'record_health_note', input: { kind: 'prefer', joint: '', exercise_id: 'neutral_db_press', severity: 1, note: 'Neutral grip pressing feels great', expires_in_days: 0 } },
    ] },
    { stop_reason: 'end_turn', content: [] },
  ];
  const requests: any[] = [];
  const anthropic = { beta: { messages: { stream: (req: any) => { requests.push(structuredClone(req)); const m = script.shift(); return { finalMessage: async () => m }; } } } };
  const reply = await runCoach({ db: asC, anthropic, workoutId: null, text: 'Neutral grip DB press feels great on my elbow', today: '2026-10-10' });
  assert.match(requests[0].messages.at(-1).content[0].text, /Sensitive joints: elbows/);
  assert.match(requests[0].messages.at(-1).content[0].text, /Avoid: Bench Press \[bench\]/);
  assert.equal(reply.actions[0].type, 'health');
  assert.ok((await H.listHealthNotes()).some((n) => n.kind === 'prefer' && n.exercise_id === 'neutral_db_press' && n.source === 'coach'));
  await applyAction(reply.id, 0, true);
  assert.ok(!(await H.listHealthNotes()).some((n) => n.kind === 'prefer'));

  // Health notes are private.
  setDb(asA);
  assert.equal((await H.listHealthNotes()).length, 0);
});

test('stretches: auto-added before main lifts and as a cool-down; flags; never affect progression', { skip: !ADMIN_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const D = { id: '44444444-4444-4444-8444-444444444444', email: 'd@example.com' };
  await pool.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{"name":"D"}')`, [D.id, D.email]);
  setDb(fakeSupabase(pool, D));
  await T.completeOnboarding(profile({ name: 'D' }), { squat: 100, bench: 70, deadlift: 120, ohp: 45 });

  const id = await T.startWorkout({ date: '2026-10-09' });
  let w = await T.getWorkout(id);
  const order = w.exercises.map((e) => `${e.exerciseId}${e.stretch ? `(${e.stretch.when})` : ''}`);
  // Prep for squat (8 and 7 /10) before it; bench prep before bench; cool-down at the end.
  assert.deepEqual(order.slice(0, 5), ['ankle_dorsiflexion(before)', 'hip_90_90(before)', 'squat', 'band_pull_apart(before)', 'bench']);
  assert.deepEqual(order.slice(-2).sort(), ['couch_stretch(after)', 'doorway_pec_stretch(after)']);
  const ankle = w.exercises[0];
  assert.equal(ankle.stretch!.forExerciseId, 'squat');
  assert.equal(ankle.stretch!.importance, 8);
  assert.equal(ankle.stretch!.dose, '2 × 10 each side');
  assert.equal(ankle.sets.length, 2);
  assert.equal(ankle.sets[0].targetReps, 10);
  assert.equal(ankle.tips.length, 3);
  assert.equal(ankle.restSeconds, 0);

  // Flags on the squat card: what's already in, and what can be added.
  const squat = squatOf(w);
  assert.ok(squat.stretchRecs.find((r: any) => r.stretchId === 'ankle_dorsiflexion').inWorkout);
  const swings = squat.stretchRecs.find((r: any) => r.stretchId === 'leg_swings');
  assert.equal(swings.inWorkout, false);
  await T.addStretch(id, squat.id, 'leg_swings', 'before');
  w = await T.getWorkout(id);
  const idx = w.exercises.findIndex((e) => e.exerciseId === 'squat');
  assert.equal(w.exercises[idx - 1].exerciseId, 'leg_swings', 'added right before squat');
  assert.equal(new Set(w.exercises.map((e) => e.id)).size, w.exercises.length);

  // Finishing: stretches don't create lift states or count as sets.
  await completeAll(id, (tier, n) => (tier === 'T3' ? 15 : n));
  const summary = await T.finishWorkout(id);
  assert.ok(!summary.results.some((r) => ['ankle_dorsiflexion', 'hip_90_90', 'leg_swings', 'couch_stretch'].includes(r.exerciseId)));
  const states = (await pool.query(`SELECT exercise_id FROM lift_states WHERE user_id = $1`, [D.id])).rows.map((r) => r.exercise_id);
  assert.ok(!states.includes('ankle_dorsiflexion'));

  // Turning auto-add off.
  const id2 = await T.startWorkout({ date: '2026-10-11', autoStretches: false });
  assert.ok(!(await T.getWorkout(id2)).exercises.some((e) => e.stretch));
});
