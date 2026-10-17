import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, EXERCISE_MAP } from '../supabase/functions/_shared/exercises.ts';
import { EXERCISE_TIPS } from '../supabase/functions/_shared/exerciseTips.ts';
import { STRETCH_DOSE, stretchesFor } from '../supabase/functions/_shared/stretches.ts';

test('every stretch / mobility drill has a dose and three tips', () => {
  for (const e of EXERCISES.filter((x) => x.category === 'mobility')) {
    assert.ok(STRETCH_DOSE[e.id], `${e.id} dose`);
    assert.equal(EXERCISE_TIPS[e.id]?.length, 3, `${e.id} tips`);
  }
});

test('every main and compound lift has at least one recommended stretch, all valid', () => {
  for (const e of EXERCISES.filter((x) => x.category === 'main' || x.category === 'compound')) {
    const recs = stretchesFor(e.id);
    assert.ok(recs.length > 0, `${e.id} has stretches`);
    for (const r of recs) {
      assert.equal(EXERCISE_MAP.get(r.stretchId)?.category, 'mobility', r.stretchId);
      assert.ok(r.importance >= 1 && r.importance <= 10);
      assert.ok(r.why.length > 20);
    }
  }
});

test('squat: ankle mobility is the top "before" item; static holds come after', () => {
  const recs = stretchesFor('squat');
  assert.equal(recs[0].stretchId, 'ankle_dorsiflexion');
  assert.equal(recs[0].when, 'before');
  assert.equal(recs[0].importance, 8);
  assert.equal(recs[0].dose!.text, '2 × 10 each side');
  const after = recs.filter((r) => r.when === 'after');
  assert.ok(after.some((r) => r.stretchId === 'couch_stretch'));
  // Before-lift items are dynamic drills or short holds — no long static holds.
  for (const r of recs.filter((x) => x.when === 'before')) {
    const dose = STRETCH_DOSE[r.stretchId];
    assert.ok(dose.unit === 'reps' || dose.reps <= 30, `${r.stretchId} too long before lifting`);
  }
});

test('a sensitive joint raises the rating and explains why', () => {
  const plain = stretchesFor('ohp').find((r) => r.stretchId === 'band_dislocate')!;
  const sore = stretchesFor('ohp', { shoulder: 2 }).find((r) => r.stretchId === 'band_dislocate')!;
  assert.equal(sore.importance, Math.min(10, plain.importance + 2));
  assert.match(sore.why, /shoulders is sensitive|shoulders are sensitive/);
});

test('every exercise has an embeddable demo video id', async () => {
  const { EXERCISE_VIDEOS } = await import('../supabase/functions/_shared/exerciseVideos.ts');
  for (const e of EXERCISES) {
    assert.match(EXERCISE_VIDEOS[e.id]?.videoId ?? '', /^[A-Za-z0-9_-]{11}$/, e.id);
  }
});

test('coach request adapts to the model (Haiku: basic web search, no fallbacks)', async () => {
  const { requestOptionsFor } = await import('../supabase/functions/_shared/coach.ts');
  const opus = requestOptionsFor('claude-opus-5-5');
  assert.equal((opus.tools[0] as { type: string }).type, 'web_search_20260209');
  assert.deepEqual(opus.fallback, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const sonnet = requestOptionsFor('claude-sonnet-5-5');
  assert.equal((sonnet.tools[0] as { type: string }).type, 'web_search_20260209');
  const haiku = requestOptionsFor('claude-haiku-5-5');
  assert.equal((haiku.tools[0] as { type: string; max_uses: number }).type, 'web_search_20250305');
  assert.equal((haiku.tools[0] as { max_uses: number }).max_uses, 2);
  assert.deepEqual(haiku.fallback, {});
  assert.equal(haiku.tools.length, opus.tools.length);
});

test('intake: what Claude read becomes safe profile settings and health notes', async () => {
  const { toIntakeResult } = await import('../supabase/functions/_shared/intake.ts');
  const r = toIntakeResult({
    goal: 'general', experience: 'unknown', days_per_week: 9, session_minutes: 50,
    equipment: ['dumbbell', 'band', 'spaceship'],
    joints: [{ joint: 'knee', severity: 3, note: 'ACL repair 2023' }, { joint: 'shoulder', severity: 1, note: 'old tweak' }, { joint: 'nose', severity: 2, note: '' }],
    avoid_exercises: [{ exercise_id: 'squat', note: 'physio said no deep squats' }, { exercise_id: 'made_up', note: '' }],
    other_notes: ['desk job', ''],
    summary: 'Here\'s what I took from that: knee surgery, general fitness.',
  });
  assert.equal(r.goal, 'general');
  assert.equal(r.experience, undefined, 'unknown is left for the user');
  assert.equal(r.daysPerWeek, 6, 'clamped');
  assert.equal(r.sessionMinutes, 45, 'nearest option');
  assert.deepEqual(r.equipment, ['dumbbell', 'band']);
  assert.deepEqual(r.limitations, ['knee'], 'only joints that matter now are protected in the program');
  assert.deepEqual(r.healthNotes.map((n) => `${n.kind}:${n.joint ?? n.exercise_id ?? n.note}`), ['joint:knee', 'joint:shoulder', 'avoid:squat', 'note:desk job']);
  assert.match(r.limitationNotes, /ACL repair/);
  const empty = toIntakeResult({ goal: 'unknown', experience: 'unknown', days_per_week: 0, session_minutes: 0, equipment: [], joints: [], avoid_exercises: [], other_notes: [], summary: '' });
  assert.equal(empty.daysPerWeek, undefined);
  assert.equal(empty.equipment, undefined, 'no equipment mentioned keeps the user\'s choice');
});

test('plan explanation: ties the plan to the profile and names swaps for sore joints', async () => {
  const { generateProgram } = await import('../supabase/functions/_shared/engine.ts');
  const { basicPlanExplanation, healthSwaps, describeProgram } = await import('../supabase/functions/_shared/plan.ts');
  const profile = { units: 'kg' as const, experience: 'beginner' as const, goal: 'hypertrophy' as const, daysPerWeek: 3, sessionMinutes: 45,
    equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'band'] as any, limitations: ['knee'] as any, bodyweight: 80 };
  const program = generateProgram(profile);
  const swaps = healthSwaps(profile, program);
  assert.ok(swaps.length > 0, 'knee limitation changes something');
  const text = basicPlanExplanation(profile, program);
  assert.match(text, /building muscle/);
  assert.match(text, /3 days a week/);
  assert.match(text, /about every 9 days/);
  assert.match(text, /45 minutes/);
  assert.match(text, /fairly new/);
  assert.match(text, /knees/);
  assert.ok(text.includes(`${swaps[0].to} instead of ${swaps[0].from}`));
  assert.equal(healthSwaps({ ...profile, limitations: [] }, generateProgram({ ...profile, limitations: [] })).length, 0);
  assert.match(describeProgram(program), /^A1 /);
});

test('model routing: cheapest model that answers well, stronger models for safety', async () => {
  const { routeFor } = await import('../supabase/functions/_shared/coach.ts');
  const m = (tier: any, kind: any, research = false) => { const r = routeFor(tier, kind, research); return `${r.model.split('-')[1]}/${r.effort}${r.research ? '/search' : ''}`; };
  // Free: Haiku except pain/injury (Sonnet); no research.
  assert.equal(m('free', 'simple'), 'haiku/low');
  assert.equal(m('free', 'personal'), 'haiku/low');
  assert.equal(m('free', 'safety'), 'sonnet/medium');
  assert.equal(m('free', 'personal', true), 'haiku/low', 'research is a paid feature');
  assert.equal(m('free', 'safety', true), 'sonnet/medium');
  // Paid and admin: Haiku → Sonnet → Opus, research on Opus.
  for (const tier of ['paid', 'admin']) {
    assert.equal(m(tier, 'simple'), 'haiku/low');
    assert.equal(m(tier, 'personal'), 'sonnet/low');
    assert.equal(m(tier, 'safety'), 'opus/medium');
    assert.equal(m(tier, 'simple', true), 'opus/medium/search');
  }
});

test('injury words always count as safety, whatever the classifier says', async () => {
  const { checkTopic } = await import('../supabase/functions/_shared/topic.ts');
  const says = (kind: string) => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ on_topic: true, kind }) }], usage: {} }) } });
  assert.equal((await checkTopic(says('simple'), 'my knee hurts a bit, how long should I rest?')).kind, 'safety');
  assert.equal((await checkTopic(says('simple'), 'what is RPE?')).kind, 'simple');
  assert.equal((await checkTopic(says('personal'), 'should I add weight to squats?')).kind, 'personal');
  assert.equal((await checkTopic(says('bogus'), 'should I add weight?')).kind, 'personal', 'unknown kind → personal');
  const broken = { messages: { create: async () => { throw new Error('down'); } } };
  assert.equal((await checkTopic(broken, 'my shoulder is sore')).kind, 'safety', 'screen down → still safe');
  assert.equal((await checkTopic(broken, 'what is RPE?')).kind, 'personal');
});

test('pricing: 1-hour cache writes cost 2× input', async () => {
  const { addUsage, costUsd, emptyUsage } = await import('../supabase/functions/_shared/pricing.ts');
  const t = emptyUsage();
  addUsage(t, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 4000, cache_creation: { ephemeral_1h_input_tokens: 3000, ephemeral_5m_input_tokens: 1000 } });
  // Opus: 3000 × $8 + 1000 × $5 per MTok.
  assert.equal(costUsd('claude-opus-5-5', t), Math.round((3000 * 8 + 1000 * 5) / 1e6 * 1e4) / 1e4);
});
