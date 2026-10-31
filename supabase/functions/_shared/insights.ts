// A plain-language look back over the last 30 and 90 days: how regularly the user trained,
// what got stronger, how their work capacity and muscle balance changed, and one to three
// things to focus on next. Rule-based (no AI), so it's free to show every time.

import { daysBetween, type Tier } from './engine.ts';
import { EXERCISE_MAP } from './exercises.ts';
import { weeklyTarget } from './recommend.ts';

export interface InsightSet { date: string; workoutId: number; exerciseId: string; tier: Tier; weight: number | null; reps: number | null }
export interface InsightWorkout { id: number; date: string; minutes: number | null }

export interface InsightInput {
  today: string;
  /** Done working sets from at least the last 180 days. */
  sets: InsightSet[];
  /** Completed workouts from at least the last 180 days. */
  workouts: InsightWorkout[];
  /** Date of the user's first ever completed workout. */
  firstWorkout: string | null;
  plannedPerWeek: number;
  goal: 'strength' | 'hypertrophy' | 'general';
  units: string;
}

export interface PeriodInsight { days: 30 | 90; headline: string; paragraphs: string[] }
export interface Focus { title: string; detail: string }
export interface Insights { periods: PeriodInsight[]; focus: Focus[] }

const MUSCLES: Record<string, string> = {
  chest: 'chest', back: 'back', shoulders: 'shoulders', rear_delts: 'rear delts', biceps: 'biceps', triceps: 'triceps',
  quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves', core: 'core',
};
const PUSH = ['chest', 'shoulders', 'triceps'];
const PULL = ['back', 'rear_delts', 'biceps'];
const LEGS = ['quads', 'hamstrings', 'glutes', 'calves'];
const MAIN_LIFTS = ['squat', 'bench', 'deadlift', 'ohp'];

const nameOf = (id: string) => EXERCISE_MAP.get(id)?.name ?? id;
const num = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

interface Window { sets: InsightSet[]; workouts: InsightWorkout[]; days: number }

/** Sets and workouts from `from` to `to` days ago (from inclusive, to exclusive). */
function slice(input: InsightInput, from: number, to: number): Window {
  const inside = (date: string) => { const ago = daysBetween(date, input.today); return ago >= from && ago < to; };
  return { sets: input.sets.filter((s) => inside(s.date)), workouts: input.workouts.filter((w) => inside(w.date)), days: to - from };
}

interface Lift {
  id: string; first: number; best: number; firstReps: number; lastReps: number; sessions: number; firstDate: string; tier: Tier;
  /** Sessions since the top weight last went up (including the session it did). */
  flat: number;
}

/** Per exercise: top working weight in the first session of the window and the best of the last two. */
function lifts(w: Window): Lift[] {
  // Heavy (T1) and volume (T2) work on the same lift are tracked separately; the heavy one is reported.
  const by = new Map<string, Map<number, InsightSet[]>>();
  for (const s of w.sets) {
    if (!s.reps) continue;
    const key = `${s.exerciseId}|${s.tier}`;
    const sessions = by.get(key) ?? new Map<number, InsightSet[]>();
    sessions.set(s.workoutId, [...(sessions.get(s.workoutId) ?? []), s]);
    by.set(key, sessions);
  }
  const out: Lift[] = [];
  for (const [key, sessions] of by) {
    const [id, tier] = key.split('|');
    if (tier === 'T2' && by.has(`${id}|T1`)) continue;
    const ex = EXERCISE_MAP.get(id);
    if (!ex || ex.category === 'mobility' || ex.loadType !== 'weight') continue;
    const ordered = [...sessions.values()].sort((a, b) => a[0].date.localeCompare(b[0].date) || a[0].workoutId - b[0].workoutId);
    const top = (xs: InsightSet[]) => Math.max(0, ...xs.map((s) => s.weight ?? 0));
    const repsAt = (xs: InsightSet[], wt: number) => xs.filter((s) => (s.weight ?? 0) === wt).reduce((a, s) => a + (s.reps ?? 0), 0);
    const first = ordered[0];
    const last = ordered.at(-1)!;
    const tops = ordered.map(top);
    let lastRise = 0;
    for (let i = 1; i < tops.length; i++) if (tops[i] > Math.max(...tops.slice(0, i))) lastRise = i;
    out.push({
      flat: tops.length - lastRise,
      id, first: top(first), best: Math.max(...ordered.slice(-2).map(top)), sessions: ordered.length, firstDate: first[0].date,
      firstReps: repsAt(first, top(first)), lastReps: repsAt(last, top(first)), tier: first[0].tier,
    });
  }
  return out;
}

function muscleWeekly(w: Window): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of w.sets) {
    const ex = EXERCISE_MAP.get(s.exerciseId);
    if (!ex || ex.category === 'mobility') continue;
    for (const m of ex.muscles) out[m] = (out[m] ?? 0) + 1;
  }
  for (const m of Object.keys(out)) out[m] = (out[m] * 7) / w.days;
  return out;
}

function tonnage(w: Window) { return w.sets.reduce((a, s) => a + (s.weight ?? 0) * (s.reps ?? 0), 0); }

function longestGap(dates: string[], today: string): number {
  const days = [...new Set(dates)].sort();
  let gap = 0;
  for (let i = 1; i < days.length; i++) gap = Math.max(gap, daysBetween(days[i - 1], days[i]) - 1);
  return days.length ? Math.max(gap, daysBetween(days.at(-1)!, today) - 1) : 0;
}

/** Days of the window the account has existed for (so a new user isn't marked down for weeks before they joined). */
function activeDays(input: InsightInput, days: number) {
  if (!input.firstWorkout) return days;
  return Math.max(7, Math.min(days, daysBetween(input.firstWorkout, input.today) + 1));
}

interface Analysis {
  days: 30 | 90; span: number; age: number; sessions: number; perWeek: number; prevSessions: number | null; weeksTrained: number; weeks: number; gap: number;
  gains: Lift[]; stalled: Lift[]; reps: Lift[]; muscles: Record<string, number>; lagging: string[]; strong: string[];
  push: number; pull: number; legs: number; total: number;
  setsPerSession: [number, number] | null; minutes: number | null; tonnageChange: number | null;
}

function analyse(input: InsightInput, days: 30 | 90): Analysis {
  const span = activeDays(input, days);
  const w = slice(input, 0, span);
  // Compare with the period before only if the user was training for all of it.
  const fullPrior = !!input.firstWorkout && daysBetween(input.firstWorkout, input.today) >= days * 2 - 1;
  const prior = span === days && fullPrior ? slice(input, days, days * 2) : null;
  const dates = [...new Set(w.workouts.map((x) => x.date))];
  const weeks = Math.max(1, Math.floor(span / 7));
  const weeksTrained = new Set(dates.map((d) => Math.floor(daysBetween(d, input.today) / 7)).filter((b) => b < weeks)).size;
  const all = lifts(w);
  const gains = all.filter((l) => l.sessions >= 2 && l.best > l.first).sort((a, b) =>
    Number(MAIN_LIFTS.includes(b.id)) - Number(MAIN_LIFTS.includes(a.id)) || (b.best - b.first) / b.first - (a.best - a.first) / a.first);
  const stalled = all.filter((l) => MAIN_LIFTS.includes(l.id) && l.tier === 'T1' && l.flat >= 4);
  const reps = all.filter((l) => l.tier === 'T3' && l.sessions >= 2 && l.best === l.first && l.lastReps > l.firstReps);
  const muscles = muscleWeekly({ ...w, days: span });
  const trained = Object.keys(MUSCLES);
  const lagging = trained.filter((m) => weeklyTarget(m, input.goal) && (muscles[m] ?? 0) < weeklyTarget(m, input.goal) * 0.5)
    .sort((a, b) => (muscles[a] ?? 0) / weeklyTarget(a, input.goal) - (muscles[b] ?? 0) / weeklyTarget(b, input.goal));
  const strong = trained.filter((m) => (muscles[m] ?? 0) >= weeklyTarget(m, input.goal)).sort((a, b) => (muscles[b] ?? 0) - (muscles[a] ?? 0));
  // Push/pull/legs balance counts each set once, for its main muscle.
  const primary: Record<string, number> = {};
  for (const s of w.sets) {
    const ex = EXERCISE_MAP.get(s.exerciseId);
    if (ex && ex.category !== 'mobility') primary[ex.muscles[0]] = (primary[ex.muscles[0]] ?? 0) + 7 / span;
  }
  const sum = (ms: string[]) => ms.reduce((a, m) => a + (primary[m] ?? 0), 0);

  // Work capacity: hard sets per session, first half of the window vs second half.
  const perSession = (from: number, to: number) => {
    const ws = slice(input, from, to);
    const n = new Set(ws.sets.map((s) => s.workoutId)).size;
    return n ? ws.sets.length / n : null;
  };
  const early = perSession(Math.ceil(span / 2), span);
  const late = perSession(0, Math.ceil(span / 2));
  const timed = w.workouts.map((x) => x.minutes).filter((m): m is number => m != null && m > 5 && m < 240);
  const priorTonnage = prior ? tonnage(prior) : 0;
  return {
    days, span, age: input.firstWorkout ? daysBetween(input.firstWorkout, input.today) + 1 : days, sessions: dates.length, perWeek: (dates.length * 7) / span,
    prevSessions: prior && prior.workouts.length ? new Set(prior.workouts.map((x) => x.date)).size : null,
    weeksTrained, weeks, gap: longestGap(dates, input.today),
    gains, stalled, reps, muscles, lagging, strong,
    push: sum(PUSH), pull: sum(PULL), legs: sum(LEGS), total: sum(trained),
    setsPerSession: early != null && late != null ? [early, late] : null,
    minutes: timed.length >= 2 ? timed.reduce((a, m) => a + m, 0) / timed.length : null,
    tonnageChange: prior && priorTonnage > 0 ? pct(tonnage(w), priorTonnage) : null,
  };
}

function describe(a: Analysis, input: InsightInput): PeriodInsight {
  const u = input.units;
  const label = a.span < a.days ? `since you started ${plural(a.age, 'day')} ago` : `in the last ${a.days} days`;
  if (a.sessions === 0) {
    return { days: a.days, headline: `No workouts ${label}`, paragraphs: [`There's nothing logged ${label}. Finish a workout and this summary will fill in.`] };
  }
  const paragraphs: string[] = [];

  // Regularity.
  const vsPlan = a.perWeek >= input.plannedPerWeek - 0.25
    ? a.perWeek > input.plannedPerWeek + 0.75 ? `more than the ${input.plannedPerWeek} your plan calls for` : `right on your plan of ${input.plannedPerWeek}`
    : `short of your plan of ${input.plannedPerWeek}`;
  let reg = `You trained ${plural(a.sessions, 'time')} ${label}, about ${num(Math.round(a.perWeek * 10) / 10)} sessions a week, ${vsPlan}.`;
  if (a.weeks >= 2) reg += ` You worked out in ${a.weeksTrained} of the last ${a.weeks} weeks`;
  reg += a.gap >= 7 ? `${a.weeks >= 2 ? ', and your' : ' Your'} longest break was ${a.gap} days.` : a.weeks >= 2 ? ', with no break longer than a week.' : '';
  if (a.prevSessions != null) {
    reg += a.sessions > a.prevSessions ? ` That's up from ${a.prevSessions} in the ${a.days} days before.`
      : a.sessions < a.prevSessions ? ` That's down from ${a.prevSessions} in the ${a.days} days before.`
      : ` The same as the ${a.days} days before.`;
  }
  paragraphs.push(reg);

  // Strength.
  const shown = a.gains.slice(0, 4);
  if (shown.length) {
    const parts = shown.map((l) => `${nameOf(l.id)} from ${num(l.first)} to ${num(l.best)} ${u} (+${pct(l.best, l.first)}%)`);
    let str = `Your top working weights went up: ${list(parts)}.`;
    const flatOnly = a.stalled.filter((l) => !shown.includes(l));
    if (flatOnly.length) str += ` ${list(flatOnly.map((l) => nameOf(l.id)))} ${flatOnly.length === 1 ? 'hasn\'t' : 'haven\'t'} gone up in ${flatOnly.length === 1 ? `the last ${flatOnly[0].flat} sessions` : 'several sessions'}.`;
    paragraphs.push(str);
  } else if (a.stalled.length) {
    paragraphs.push(`Your main lifts haven't moved up ${label}: ${list(a.stalled.map((l) => `${nameOf(l.id)} is still at ${num(l.best)} ${u}`))}.`);
  } else {
    paragraphs.push('There aren\'t enough repeat sessions of the same lifts yet to show a strength trend.');
  }

  // Conditioning: more reps at the same weight, more work per session, overall workload.
  const cond: string[] = [];
  if (a.reps.length) cond.push(`On ${list(a.reps.slice(0, 3).map((l) => nameOf(l.id)))} you're doing more reps at the same weight, a sign of better muscular endurance.`);
  if (a.setsPerSession) {
    const [e, l] = a.setsPerSession;
    if (l >= e + 2) cond.push(`You're getting through more work per session: about ${Math.round(l)} hard sets, up from ${Math.round(e)}.`);
    else if (l <= e - 2) cond.push(`Sessions have got a little lighter: about ${Math.round(l)} hard sets, down from ${Math.round(e)}.`);
  }
  if (a.minutes) cond.push(`Workouts averaged ${Math.round(a.minutes)} minutes.`);
  if (a.tonnageChange != null && Math.abs(a.tonnageChange) >= 10) {
    cond.push(`Total weight moved was ${a.tonnageChange > 0 ? 'up' : 'down'} ${Math.abs(a.tonnageChange)}% on the ${a.days} days before.`);
  }
  if (cond.length) paragraphs.push(cond.join(' '));

  // Muscle balance.
  const bal: string[] = [];
  if (a.strong.length) bal.push(`Your ${list(a.strong.slice(0, 3).map((m) => MUSCLES[m]))} ${a.strong.length === 1 && !a.strong[0].endsWith('s') ? 'gets' : 'get'} plenty of work, at least ${weeklyTarget(a.strong[0], input.goal)} hard sets a week.`);
  const untrained = a.lagging.filter((m) => (a.muscles[m] ?? 0) < 0.5).slice(0, 3);
  const light = a.lagging.filter((m) => (a.muscles[m] ?? 0) >= 0.5).slice(0, 3 - untrained.length);
  if (untrained.length) bal.push(`You haven't trained your ${orList(untrained.map((m) => MUSCLES[m]))} directly.`);
  if (light.length) bal.push(`${untrained.length ? 'And your' : 'Your'} ${list(light.map((m) => MUSCLES[m]))} ${light.length === 1 && !light[0].endsWith('s') ? 'gets' : 'get'} only ${list(light.map((m) => `${num(Math.round((a.muscles[m] ?? 0) * 10) / 10)}`))} hard sets a week${light.length > 1 ? ' respectively' : ''}.`);
  if (a.push > a.pull * 1.4 && a.push >= 6) bal.push(`You're doing noticeably more pushing (${Math.round(a.push)} sets a week) than pulling (${Math.round(a.pull)}).`);
  if (bal.length) paragraphs.push(bal.join(' '));

  const headline = a.gains.length
    ? `${plural(a.sessions, 'workout')}, ${a.gains.length} lift${a.gains.length === 1 ? '' : 's'} up`
    : `${plural(a.sessions, 'workout')} ${label}`;
  return { days: a.days, headline, paragraphs };
}

const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One to three things to work on over the next one to three months, most important first. */
function focus(a30: Analysis, a90: Analysis, input: InsightInput): Focus[] {
  const out: Array<Focus & { weight: number }> = [];
  const a = a90.sessions >= a30.sessions + 2 ? a90 : a30; // the steadier picture when there's more history
  if (a.perWeek < input.plannedPerWeek * 0.75 || a.gap >= 10) {
    out.push({
      weight: 3, title: 'Train more consistently',
      detail: `You're averaging ${num(Math.round(a.perWeek * 10) / 10)} sessions a week against a plan of ${input.plannedPerWeek}${a.gap >= 10 ? `, with ${/^(8|11|18)/.test(String(a.gap)) ? 'an' : 'a'} ${a.gap}-day break` : ''}. `
        + `Steady weeks are what make the weights keep climbing. Pick set days, and on busy ones do a short session of just the two main lifts rather than skipping.`,
    });
  }
  if (a30.stalled.length) {
    const l = a30.stalled[0];
    out.push({
      weight: 2.5, title: `Get ${nameOf(l.id)} moving again`,
      detail: `It's been at ${num(l.best)} ${input.units} for the last ${l.flat} sessions. The plan will switch to the next rep scheme when you miss, which usually breaks a plateau. `
        + 'Help it along by keeping every rep technically clean, resting the full time between heavy sets, and sleeping and eating enough to recover.',
    });
  }
  const lag = a.lagging.slice(0, 2);
  if (lag.length) {
    out.push({
      weight: 2, title: `More work for your ${list(lag.map((m) => MUSCLES[m]))}`,
      detail: `${lag.every((m) => (a.muscles[m] ?? 0) < 0.5) ? `They get almost no direct work` : `About ${list(lag.map((m) => `${num(Math.round((a.muscles[m] ?? 0) * 10) / 10)} hard sets a week for your ${MUSCLES[m]}`))}`}, against ${new Set(lag.map((m) => weeklyTarget(m, input.goal))).size > 1 ? `targets of about ${list(lag.map((m) => `${weeklyTarget(m, input.goal)} for ${MUSCLES[m]}`))}` : `a target of about ${weeklyTarget(lag[0], input.goal)}`}. `
        + 'Add 2–4 sets a week (Add exercise suggests the best options), or ask the coach to put an accessory for them into your program.',
    });
  }
  if (a.push > a.pull * 1.4 && a.push >= 6) {
    out.push({
      weight: 1.5, title: 'Balance pushing with pulling',
      detail: `About ${Math.round(a.push)} pushing sets a week to ${Math.round(a.pull)} pulling. Matching them, with rows, pulldowns and face pulls, keeps shoulders healthy and posture balanced.`,
    });
  }
  if (a.total > 0 && a.legs < a.total * 0.3 && !lag.some((m) => LEGS.includes(m))) {
    out.push({
      weight: 1.5, title: 'Don\'t skip legs',
      detail: `Only about ${Math.round((a.legs / a.total) * 100)}% of your hard sets are for legs. They're your biggest muscles, so they matter for strength and for metabolism.`,
    });
  }
  if (!out.length) {
    const next = a.gains.find((l) => MAIN_LIFTS.includes(l.id)) ?? a.gains[0];
    out.push(next
      ? { weight: 1, title: 'Keep the momentum', detail: `Everything is on track. Keep showing up and ${nameOf(next.id)} should pass ${num(next.best * 1.05)} ${input.units} within the next couple of months.` }
      : { weight: 1, title: 'Build the habit', detail: `Aim for ${input.plannedPerWeek} sessions a week for the next month. The app raises the weights for you each time you hit your reps.` });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 3).map(({ title, detail }) => ({ title, detail }));
}

export function buildInsights(input: InsightInput): Insights {
  const a30 = analyse(input, 30);
  const a90 = analyse(input, 90);
  // A newer account would get the same summary twice.
  const periods = a90.span > a30.span ? [describe(a30, input), describe(a90, input)] : [describe(a30, input)];
  return { periods, focus: focus(a30, a90, input) };
}
