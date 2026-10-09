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
