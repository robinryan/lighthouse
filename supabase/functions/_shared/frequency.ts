// Training more often than planned. The program rotates A1 → A2 → B1 → B2 with its accessories
// picked for the days per week from setup; when someone trains more often, the same accessory or
// muscle can come round on back-to-back days. This works out how often they really train, and
// adjusts each new session around what they did in the last day or two. Main-lift progression is
// left alone: the T1/T2 rotation and its weights never change here.

import { daysBetween, type Program, type ProgramSlot, type Tier } from './engine.ts';
import { EXERCISES, EXERCISE_MAP, type Equipment, type Exercise, type Joint, avoidsJoints, hasEquipment } from './exercises.ts';
import { weeklyTarget } from './recommend.ts';

export interface DoneSet { date: string; exerciseId: string; tier: Tier }

export interface Frequency {
  /** Sessions per week over the window. */
  perWeek: number;
  sessions: number;
  windowDays: number;
  /** Pairs of training days in a row in the window. */
  backToBack: number;
  /** Days in a row trained up to yesterday (0 if not yesterday). */
  streak: number;
  /** Rounded days per week to suggest, when clearly more than planned. */
  suggest: number | null;
}

const WINDOW = 21;

/** How often the user has actually trained, from the dates of finished workouts. */
export function trainingFrequency(dates: string[], today: string, planned: number): Frequency {
  const days = [...new Set(dates)].filter((d) => {
    const ago = daysBetween(d, today);
    return ago >= 0 && ago < WINDOW;
  }).sort();
  const windowDays = days.length ? Math.min(WINDOW, Math.max(7, daysBetween(days[0], today) + 1)) : WINDOW;
  const perWeek = Math.round((days.length * 7 / windowDays) * 10) / 10;
  let backToBack = 0;
  for (let i = 1; i < days.length; i++) if (daysBetween(days[i - 1], days[i]) === 1) backToBack++;
  const set = new Set(days);
  let streak = 0;
  for (let d = 1; d < WINDOW; d++) {
    if (!set.has(shift(today, -d))) break;
    streak++;
  }
  const more = days.length >= 4 && perWeek >= planned + 1;
  return { perWeek, sessions: days.length, windowDays, backToBack, streak, suggest: more ? Math.min(6, Math.round(perWeek)) : null };
}

function shift(date: string, by: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** One line for the coach. */
export function describeFrequency(f: Frequency, planned: number): string {
  if (!f.sessions) return `Actual training: no finished workouts in the last ${WINDOW} days (plan: ${planned} days/week).`;
  return `Actual training: ~${f.perWeek} sessions/week over the last ${f.windowDays} days (plan: ${planned} days/week), `
    + `${f.backToBack} back-to-back day${f.backToBack === 1 ? '' : 's'}${f.streak ? `, trained ${f.streak} day${f.streak === 1 ? '' : 's'} in a row up to yesterday` : ''}.`
    + (f.suggest ? ' Training more often than planned: sessions are adjusted so accessories and muscles aren\'t repeated on consecutive days.' : '');
}

// ---------------------------------------------------------------------------
// Adjusting a session

export const VARIETY_NOTE = 'Changed for variety:';

export interface AdaptContext {
  today: string;
  /** Finished working sets from the last week or so. */
  recent: DoneSet[];
  equipment: Equipment[];
  goal: 'strength' | 'hypertrophy' | 'general';
  limitations: Joint[];
  /** Exercises never to pick (health profile avoid list and dislikes). */
  avoid: Set<string>;
  prefer?: Set<string>;
  /** Exercises the user has done before (a small preference, so picks feel familiar). */
  history?: Set<string>;
  /** The program as generated: a slot that differs from it was chosen deliberately and is kept. */
  generated?: Program | null;
  /** Days in a row trained up to yesterday. */
  streak: number;
}

export type SlotPlan =
  | { kind: 'keep' }
  | { kind: 'swap'; exerciseId: string; note: string }
  | { kind: 'ease'; dropSets: number; note: string };

/** Hard sets per muscle in the last day (yesterday or earlier today), primary muscles only. */
function lastDay(ctx: AdaptContext) {
  const exercises = new Set<string>();
  const muscles: Record<string, number> = {};
  const mains: Exercise[] = [];
  for (const s of ctx.recent) {
    const ago = daysBetween(s.date, ctx.today);
    if (ago < 0 || ago > 1) continue;
    const ex = EXERCISE_MAP.get(s.exerciseId);
    if (!ex || ex.category === 'mobility') continue;
    exercises.add(ex.id);
    muscles[ex.muscles[0]] = (muscles[ex.muscles[0]] ?? 0) + 1;
    if (s.tier !== 'T3' && !mains.includes(ex)) mains.push(ex);
  }
  return { exercises, muscles, mains };
}

function weekSets(ctx: AdaptContext) {
  const out: Record<string, number> = {};
  for (const s of ctx.recent) {
    const ago = daysBetween(s.date, ctx.today);
    if (ago < 0 || ago > 6) continue;
    const ex = EXERCISE_MAP.get(s.exerciseId);
    if (!ex || ex.category === 'mobility') continue;
    for (const m of ex.muscles) out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

const MUSCLE_WORDS: Record<string, string> = {
  chest: 'chest', back: 'back', shoulders: 'shoulders', rear_delts: 'rear delts', biceps: 'biceps', triceps: 'triceps',
  forearms: 'forearms', quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves', core: 'core', lower_back: 'lower back',
};

/** Sets for a muscle in the last day that mean it needs a day off. */
const HEAVY_SETS = 6;

/**
 * What to do with each slot of today's session.
 * - An accessory done in the last day is swapped for a different exercise for the same muscle
 *   (a pulldown yesterday becomes a row today), or for another muscle if today already trains
 *   that one. This applies to slots the user or coach added too, since repeating the exact
 *   exercise is the problem; the app offers the original back.
 * - An accessory whose main muscle was worked very hard in the last day is swapped for one
 *   that trains something else, favouring muscles behind for the week. Chosen slots are kept.
 * - After two or more training days in a row, a lower-body volume lift drops a set.
 */
export function adaptSession(slots: ProgramSlot[], ctx: AdaptContext): SlotPlan[] {
  const recent = lastDay(ctx);
  if (!recent.exercises.size) return slots.map(() => ({ kind: 'keep' }));
  const week = weekSets(ctx);
  const generated = new Map((ctx.generated?.days ?? []).flatMap((d) => d.slots).map((s) => [s.id, s.exerciseId]));
  const today = new Set(slots.map((s) => s.exerciseId));
  // Main muscle of each slot as it will be done today (updated as slots are swapped).
  const muscleOf = slots.map((s) => EXERCISE_MAP.get(s.exerciseId)?.muscles[0] ?? '');
  const deficit = (m: string) => {
    const t = weeklyTarget(m, ctx.goal);
    return t ? Math.max(0, t - (week[m] ?? 0)) / t : 0;
  };
  const rested = (m: string) => (recent.muscles[m] ?? 0) < HEAVY_SETS;

  return slots.map((slot, index): SlotPlan => {
    const ex = EXERCISE_MAP.get(slot.exerciseId);
    if (!ex) return { kind: 'keep' };

    if (slot.tier === 'T2') {
      const loweredToday = ex.lower && recent.mains.some((m) => m.lower);
      if (ctx.streak >= 2 && loweredToday && ex.loadType === 'weight') {
        return { kind: 'ease', dropSets: 1, note: `${VARIETY_NOTE} one set fewer today. This is your ${ctx.streak + 1}${ordinal(ctx.streak + 1)} training day in a row and your legs and lower back worked hard yesterday. Your weight progression is unaffected.` };
      }
      return { kind: 'keep' };
    }
    if (slot.tier !== 'T3') return { kind: 'keep' };
    const chosen = slot.id.includes('-x') || (!!ctx.generated && generated.get(slot.id) !== slot.exerciseId);
    const repeat = recent.exercises.has(ex.id);
    const muscle = ex.muscles[0];
    // Chosen by the user or coach: only an exact repeat of yesterday changes it.
    if (!repeat && (chosen || rested(muscle))) return { kind: 'keep' };
    const others = new Set(muscleOf.filter((_, i) => i !== index));
    // Same muscle, different exercise, unless the muscle needs rest or today already trains it.
    const sameMuscle = repeat && rested(muscle) && !others.has(muscle);

    let best: { ex: Exercise; score: number } | null = null;
    for (const c of EXERCISES) {
      if (c.category !== 'accessory' || today.has(c.id) || ctx.avoid.has(c.id) || recent.exercises.has(c.id)) continue;
      if (!hasEquipment(c, ctx.equipment) || !avoidsJoints(c, ctx.limitations)) continue;
      const m = c.muscles[0];
      if (sameMuscle ? m !== muscle : !rested(m) || m === muscle) continue;
      if (!sameMuscle && others.has(m)) continue; // already trained in this session
      let score = 40 * deficit(m) + 8 * deficit(c.muscles[1] ?? '');
      if (c.lower === ex.lower) score += 10; // keep the session's upper/lower balance
      if (c.loadType === ex.loadType) score += 3;
      if (ctx.prefer?.has(c.id)) score += 12;
      if (ctx.history?.has(c.id)) score += 3;
      if (!best || score > best.score) best = { ex: c, score };
    }
    if (!best) return { kind: 'keep' };
    today.add(best.ex.id);
    muscleOf[index] = best.ex.muscles[0];
    const word = (m: string) => MUSCLE_WORDS[m] ?? m;
    const why = repeat
      ? sameMuscle
        ? `you did ${ex.name} in the last day. Same muscles, different exercise`
        : `you did ${ex.name} in the last day${rested(muscle) ? ` and today already works your ${word(muscle)}` : ` and your ${word(muscle)} worked hard`}`
      : `your ${word(muscle)} worked hard in the last day`;
    const w = word(best.ex.muscles[0]);
    const behind = !sameMuscle && deficit(best.ex.muscles[0]) >= 0.3 ? `. Your ${w} ${w.endsWith('s') ? 'need' : 'needs'} more work this week` : '';
    return { kind: 'swap', exerciseId: best.ex.id, note: `${VARIETY_NOTE} ${best.ex.name} instead of ${ex.name}, because ${why}${behind}.` };
  });
}

function ordinal(n: number) {
  return n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
}
