import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, type InsightSet, type InsightWorkout } from '../supabase/functions/_shared/insights.ts';

const today = '2026-10-31';
const day = (ago: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ago); return d.toISOString().slice(0, 10); };

/**
 * 120 days of history: 3 days a week, then 4 a week for the last 60 days, an 11-day holiday,
 * squat and deadlift climbing, heavy bench stuck for the last ~40 days, leg curl reps rising,
 * nothing for calves, rear delts or core, and far more pushing than pulling.
 */
function history(startAgo = 120) {
  const sets: InsightSet[] = [];
  const workouts: InsightWorkout[] = [];
  let id = 0;
  for (let ago = startAgo; ago >= 1; ago--) {
    if (!(ago > 60 ? [0, 2, 4] : [0, 1, 3, 5]).includes(ago % 7) || (ago > 40 && ago < 52)) continue;
    id++;
    const n = 120 - ago;
    const add = (ex: string, tier: InsightSet['tier'], w: number, reps: number, k: number) => {
      for (let i = 0; i < k; i++) sets.push({ date: day(ago), workoutId: id, exerciseId: ex, tier, weight: w, reps });
    };
    if (id % 2) {
      add('squat', 'T1', 80 + Math.floor(n / 4) * 2.5, 3, 5); add('bench', 'T2', 50, 10, 3);
      add('leg_curl', 'T3', 30, 10 + Math.min(5, Math.floor(n / 20)), 3); add('triceps_pushdown', 'T3', 20, 12, 3);
    } else {
      add('bench', 'T1', 70 + (n < 80 ? Math.floor(n / 6) * 2.5 : 32.5), 3, 5); add('deadlift', 'T2', 90 + Math.floor(n / 5) * 2.5, 10, 3);
      add('lateral_raise', 'T3', 6, 12, 3); add('db_curl', 'T3', 10, 12, 2);
    }
    workouts.push({ id, date: day(ago), minutes: 55 });
  }
  return { sets, workouts };
}

test('30 and 90 day summaries: regularity, strength, conditioning and balance', () => {
  const { sets, workouts } = history();
  const r = buildInsights({ today, sets, workouts, firstWorkout: day(120), plannedPerWeek: 4, goal: 'strength', units: 'kg' });
  assert.deepEqual(r.periods.map((p) => p.days), [30, 90]);
  const [p30, p90] = r.periods.map((p) => p.paragraphs.join('\n'));
  // Regularity, with the period before for comparison.
  assert.match(p30, /You trained 17 times in the last 30 days, about 4 sessions a week, right on your plan of 4\./);
  assert.match(p30, /4 of the last 4 weeks, with no break longer than a week\. That's up from 11 in the 30 days before\./);
  assert.match(p90, /short of your plan of 4.*longest break was 11 days/);
  assert.doesNotMatch(p90, /90 days before/, 'no comparison with a period before the user started');
  // Strength: heavy lifts only (bench volume work at 50 kg isn't mixed with heavy bench), and the plateau.
  assert.match(p30, /Back Squat from 135 to 152\.5 kg \(\+13%\) and Deadlift from 135 to 147\.5 kg \(\+9%\)\. Bench Press hasn't gone up in the last 8 sessions\./);
  assert.match(p90, /Bench Press from 82\.5 to 102\.5 kg/);
  assert.doesNotMatch(p30 + p90, /from 50 to/);
  // Conditioning and balance.
  assert.match(p30, /On Leg Curl you're doing more reps at the same weight/);
  assert.match(p30, /Workouts averaged 55 minutes/);
  assert.match(p30, /You haven't trained your rear delts, calves or core directly\./);
  assert.match(p30, /more pushing \(\d+ sets a week\) than pulling \(\d+\)/);
  // Focus: the three most important, most important first.
  assert.deepEqual(r.focus.map((f) => f.title), ['Train more consistently', 'Get Bench Press moving again', 'More work for your rear delts and calves']);
  assert.match(r.focus[0].detail, /3\.1 sessions a week against a plan of 4, with an 11-day break/);
  assert.match(r.focus[1].detail, /102\.5 kg for the last 8 sessions/);
});

test('a new account gets one summary, and no workouts or a perfect record still read sensibly', () => {
  const { sets, workouts } = history(20);
  const r = buildInsights({ today, sets, workouts, firstWorkout: workouts[0].date, plannedPerWeek: 3, goal: 'hypertrophy', units: 'lb' });
  assert.deepEqual(r.periods.map((p) => p.days), [30]);
  assert.match(r.periods[0].paragraphs[0], /since you started \d+ days ago/);
  assert.ok(r.focus.length >= 1 && r.focus.length <= 3);

  const empty = buildInsights({ today, sets: [], workouts: [], firstWorkout: null, plannedPerWeek: 3, goal: 'general', units: 'kg' });
  assert.match(empty.periods[0].paragraphs[0], /nothing logged/);
  assert.equal(empty.focus[0].title, 'Train more consistently');

  // Balanced, regular and progressing: one encouraging focus.
  const good: InsightSet[] = [];
  const goodW: InsightWorkout[] = [];
  const program = [['squat', 'quads'], ['bench', 'chest'], ['cable_row', 'back'], ['leg_curl', ''], ['face_pull', ''], ['calf_raise', ''], ['plank', ''], ['db_curl', ''], ['lat_pulldown', '']];
  let id = 0;
  for (let ago = 60; ago >= 1; ago -= 2) {
    id++;
    for (const [ex] of program) for (let i = 0; i < 4; i++) good.push({ date: day(ago), workoutId: id, exerciseId: ex, tier: ex === 'squat' || ex === 'bench' ? 'T1' : 'T3', weight: 50 + (60 - ago), reps: 8 });
    goodW.push({ id, date: day(ago), minutes: 60 });
  }
  const g = buildInsights({ today, sets: good, workouts: goodW, firstWorkout: day(60), plannedPerWeek: 3, goal: 'strength', units: 'kg' });
  assert.equal(g.focus.length, 1);
  assert.equal(g.focus[0].title, 'Keep the momentum');
});
