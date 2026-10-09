// The programming engine: pure functions, no I/O.
//
// Structure is based on GZCLP (a widely used linear-progression program):
// every training day has two main lifts — a heavy T1 lift and a volume T2
// lift — followed by T3 accessories. The four main lifts each get one heavy
// day and one volume day per rotation:
//
//   A1: Squat (T1) + Bench (T2)      A2: OHP (T1) + Deadlift (T2)
//   B1: Bench (T1) + Squat (T2)      B2: Deadlift (T1) + OHP (T2)
//
// Progression:
//  - T1/T2 add weight every successful session. A failed session moves the
//    lift to the next rep stage at the same weight (e.g. 5x3 → 6x2 → 10x1).
//    Failing the last stage resets the lift to a lighter weight.
//  - T3 uses double progression: add reps within a range, then add weight.

import {
  type Equipment, type Exercise, type Family, type Joint,
  avoidsJoints, getExercise, hasEquipment, EXERCISE_MAP,
} from './exercises.ts';

export type Goal = 'strength' | 'hypertrophy' | 'general';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Units = 'kg' | 'lb';
export type Tier = 'T1' | 'T2' | 'T3';

export interface Profile {
  units: Units;
  experience: Experience;
  goal: Goal;
  daysPerWeek: number;
  sessionMinutes: number;
  equipment: Equipment[];
  limitations: Joint[];
  bodyweight: number | null;
}

export interface ProgramSlot { id: string; tier: Tier; exerciseId: string }
export interface ProgramDay { key: string; name: string; slots: ProgramSlot[] }
export interface Program { days: ProgramDay[] }

export interface LiftState {
  exerciseId: string;
  tier: Tier;
  weight: number | null;
  stage: number;
  /** T2: the weight last used at stage 0 (e.g. 3x10), used for resets. */
  stage0Weight: number | null;
  /** T3: consecutive sessions below the bottom of the rep range. */
  fails: number;
  /** T3: per-set rep targets for next session. */
  repTargets: number[] | null;
  lastPerformed: string | null;
}

export interface Scheme {
  sets: number;
  reps: number;
  /** For double progression: [min, max]. */
  range?: [number, number];
  amrapLast: boolean;
  rest: number;
  label: string;
}

export interface PrescribedSet {
  kind: 'warmup' | 'working';
  targetReps: number;
  targetWeight: number | null;
  amrap: boolean;
}

export interface Prescription {
  scheme: Scheme;
  sets: PrescribedSet[];
  note: string | null;
}

// ---------------------------------------------------------------------------
// Schemes

const T1_STAGES: Record<Goal, Array<[number, number]>> = {
  strength: [[5, 3], [6, 2], [10, 1]],
  general: [[4, 5], [5, 3], [6, 2]],
  hypertrophy: [[4, 6], [5, 4], [6, 3]],
};
const T2_STAGES: Record<Goal, Array<[number, number]>> = {
  strength: [[3, 10], [3, 8], [3, 6]],
  general: [[3, 10], [3, 8], [3, 6]],
  hypertrophy: [[3, 12], [3, 10], [3, 8]],
};
const REST: Record<Goal, Record<Tier, number>> = {
  strength: { T1: 180, T2: 120, T3: 75 },
  general: { T1: 150, T2: 120, T3: 75 },
  hypertrophy: { T1: 150, T2: 105, T3: 75 },
};

export function stageCount(tier: Tier): number {
  return tier === 'T3' ? 1 : 3;
}

export function getScheme(goal: Goal, tier: Tier, stage: number, ex: Exercise): Scheme {
  if (tier === 'T1' || tier === 'T2') {
    const stages = tier === 'T1' ? T1_STAGES[goal] : T2_STAGES[goal];
    const [sets, reps] = stages[Math.min(stage, stages.length - 1)];
    const amrapLast = tier === 'T1';
    return { sets, reps, amrapLast, rest: REST[goal][tier], label: `${sets}×${reps}${amrapLast ? '+' : ''}` };
  }
  if (ex.category === 'mobility') {
    const range: [number, number] = ex.loadType === 'time' ? [30, 45] : [8, 12];
    return { sets: 2, reps: range[0], range, amrapLast: false, rest: 30, label: `2×${range[0]}–${range[1]}${ex.loadType === 'time' ? 's' : ''}` };
  }
  const range: [number, number] = ex.loadType === 'time' ? [30, 60] : [10, 15];
  const sets = goal === 'hypertrophy' ? 4 : 3;
  return { sets, reps: range[0], range, amrapLast: false, rest: REST[goal].T3, label: `${sets}×${range[0]}–${range[1]}${ex.loadType === 'time' ? 's' : ''}` };
}

// ---------------------------------------------------------------------------
// Weights, rounding, increments

export function barWeight(units: Units): number {
  return units === 'kg' ? 20 : 45;
}

export function roundingStep(ex: Exercise, units: Units): number {
  return units === 'kg' ? 2.5 : 5;
}

export function roundWeight(w: number, ex: Exercise, units: Units, mode: 'nearest' | 'down' = 'nearest'): number {
  const step = roundingStep(ex, units);
  const rounded = (mode === 'down' ? Math.floor(w / step + 1e-9) : Math.round(w / step)) * step;
  if (ex.equipment.includes('barbell')) return Math.max(rounded, barWeight(units));
  return Math.max(rounded, 0);
}

export function increment(ex: Exercise, tier: Tier, units: Units, experience: Experience): number {
  const kg = units === 'kg';
  if (ex.equipment.includes('barbell') && ex.lower && tier !== 'T3' && experience === 'beginner') {
    return kg ? 5 : 10;
  }
  return kg ? 2.5 : 5;
}

/** Epley estimated one-rep max. */
export function e1rm(weight: number, reps: number): number {
  if (!weight || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function convertWeight(w: number, from: Units, to: Units): number {
  if (from === to) return w;
  return from === 'kg' ? w * 2.20462 : w / 2.20462;
}

// ---------------------------------------------------------------------------
// Program generation

const MAIN_CANDIDATES: Record<Family, string[]> = {
  squat: ['squat', 'safety_bar_squat', 'box_squat', 'hack_squat', 'leg_press', 'goblet_squat'],
  bench: ['bench', 'neutral_db_press', 'db_bench', 'machine_chest_press', 'floor_press', 'pushup'],
  deadlift: ['deadlift', 'trap_bar_deadlift', 'hip_thrust', 'db_rdl', 'glute_bridge'],
  ohp: ['ohp', 'db_shoulder_press', 'landmine_press', 'machine_shoulder_press', 'pushup'],
};

interface DayTemplate { key: string; name: string; t1: Family; t2: Family; accessories: string[][] }

const DAY_TEMPLATES: DayTemplate[] = [
  {
    key: 'A1', name: 'Squat & Bench', t1: 'squat', t2: 'bench',
    accessories: [
      ['lat_pulldown', 'neutral_pulldown', 'pullup', 'chinup', 'straight_arm_pulldown'],
      ['leg_curl', 'db_rdl', 'glute_bridge'],
      ['rope_pushdown', 'triceps_pushdown', 'overhead_triceps_ext'],
      ['face_pull', 'rear_delt_fly', 'band_pull_apart'],
      ['calf_raise'],
    ],
  },
  {
    key: 'A2', name: 'Overhead Press & Deadlift', t1: 'ohp', t2: 'deadlift',
    accessories: [
      ['chest_supported_row', 'cable_row', 'db_row', 'barbell_row'],
      ['lateral_raise', 'cable_lateral_raise'],
      ['db_curl', 'hammer_curl', 'barbell_curl'],
      ['plank', 'dead_bug', 'cable_crunch'],
      ['step_up', 'bulgarian_split_squat', 'walking_lunge'],
    ],
  },
  {
    key: 'B1', name: 'Bench & Squat', t1: 'bench', t2: 'squat',
    accessories: [
      ['pullup', 'lat_pulldown', 'neutral_pulldown', 'chinup'],
      ['bulgarian_split_squat', 'walking_lunge', 'step_up', 'glute_bridge'],
      ['face_pull', 'band_pull_apart', 'rear_delt_fly'],
      ['overhead_triceps_ext', 'rope_pushdown', 'skull_crusher'],
      ['pallof_press', 'dead_bug', 'plank'],
    ],
  },
  {
    key: 'B2', name: 'Deadlift & Overhead Press', t1: 'deadlift', t2: 'ohp',
    accessories: [
      ['db_row', 'cable_row', 'chest_supported_row', 'barbell_row'],
      ['leg_extension', 'leg_press', 'goblet_squat'],
      ['hammer_curl', 'db_curl'],
      ['cable_lateral_raise', 'lateral_raise'],
      ['hanging_leg_raise', 'cable_crunch', 'dead_bug', 'plank'],
    ],
  },
];

export function accessoryCount(profile: Pick<Profile, 'sessionMinutes' | 'goal'>): number {
  const base = profile.sessionMinutes <= 45 ? 2 : profile.sessionMinutes <= 60 ? 3 : 4;
  return Math.min(5, base + (profile.goal === 'hypertrophy' ? 1 : 0));
}

function pick(candidates: string[], profile: Profile, exclude: Set<string>, strictJoints: boolean, avoid: Set<string>): string | null {
  const ok = candidates.filter((id) => {
    const ex = EXERCISE_MAP.get(id);
    return ex && !exclude.has(id) && hasEquipment(ex, profile.equipment);
  });
  const preferred = ok.filter((id) => !avoid.has(id));
  if (preferred.length) ok.splice(0, ok.length, ...preferred);
  const safe = ok.find((id) => avoidsJoints(getExercise(id), profile.limitations));
  if (safe) return safe;
  return strictJoints ? null : ok[0] ?? null;
}

/** `avoid`: exercises from the health profile to steer away from when there's an alternative. */
export function generateProgram(profile: Profile, avoid: Set<string> = new Set()): Program {
  const nAcc = accessoryCount(profile);
  const days = DAY_TEMPLATES.map((t): ProgramDay => {
    const used = new Set<string>();
    const slots: ProgramSlot[] = [];
    const t1 = pick(MAIN_CANDIDATES[t.t1], profile, used, false, avoid) ?? MAIN_CANDIDATES[t.t1][0];
    used.add(t1);
    slots.push({ id: `${t.key}-t1`, tier: 'T1', exerciseId: t1 });
    const t2 = pick(MAIN_CANDIDATES[t.t2], profile, used, false, avoid) ?? MAIN_CANDIDATES[t.t2][0];
    used.add(t2);
    slots.push({ id: `${t.key}-t2`, tier: 'T2', exerciseId: t2 });
    for (let i = 0; i < t.accessories.length && slots.length < 2 + nAcc; i++) {
      const id = pick(t.accessories[i], profile, used, true, avoid);
      if (!id) continue;
      used.add(id);
      slots.push({ id: `${t.key}-t3-${i}`, tier: 'T3', exerciseId: id });
    }
    return { key: t.key, name: t.name, slots };
  });
  return { days };
}

// ---------------------------------------------------------------------------
// Starting weights

export type FiveRMs = Partial<Record<Family, number | null>>;

const DEFAULT_5RM_BW_RATIO: Record<Family, number> = { squat: 0.8, bench: 0.6, deadlift: 1.0, ohp: 0.4 };
const EXPERIENCE_SCALE: Record<Experience, number> = { beginner: 1, intermediate: 1.3, advanced: 1.6 };

export function estimateFiveRM(family: Family, profile: Profile, given: FiveRMs): number {
  const v = given[family];
  if (v && v > 0) return v;
  const bw = profile.bodyweight ?? (profile.units === 'kg' ? 75 : 165);
  return bw * DEFAULT_5RM_BW_RATIO[family] * EXPERIENCE_SCALE[profile.experience];
}

const TIER_START_PCT: Record<Tier, number> = { T1: 0.85, T2: 0.65, T3: 0.5 };

/** A sensible starting weight, or null if we have no basis to guess (user enters it). */
export function startingWeight(ex: Exercise, tier: Tier, profile: Profile, given: FiveRMs): number | null {
  if (ex.loadType === 'time') return null;
  if (ex.loadType === 'bodyweight') return 0;
  if (!ex.family || !ex.ratio) return null;
  const five = estimateFiveRM(ex.family, profile, given) * ex.ratio;
  return roundWeight(five * TIER_START_PCT[tier], ex, profile.units);
}

export function initialState(ex: Exercise, tier: Tier, profile: Profile, given: FiveRMs): LiftState {
  const weight = startingWeight(ex, tier, profile, given);
  return {
    exerciseId: ex.id, tier, weight, stage: 0,
    stage0Weight: tier === 'T2' ? weight : null,
    fails: 0, repTargets: null, lastPerformed: null,
  };
}

// ---------------------------------------------------------------------------
// Prescribing a session

export function warmupSets(work: number, ex: Exercise, units: Units): PrescribedSet[] {
  if (ex.loadType !== 'weight' || !work) return [];
  const isBar = ex.equipment.includes('barbell');
  const bar = barWeight(units);
  const plan: Array<[number, number]> = isBar
    ? [[0, 10], [0.4, 5], [0.6, 3], [0.8, 2]]
    : [[0.5, 8], [0.75, 3]];
  const out: PrescribedSet[] = [];
  const seen = new Set<number>();
  for (const [pct, reps] of plan) {
    const w = pct === 0 ? bar : roundWeight(work * pct, ex, units);
    if (w >= work || seen.has(w) || (isBar && w < bar) || w <= 0) continue;
    seen.add(w);
    out.push({ kind: 'warmup', targetReps: reps, targetWeight: w, amrap: false });
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function prescribe(state: LiftState, ex: Exercise, goal: Goal, units: Units, today: string): Prescription {
  const scheme = getScheme(goal, state.tier, state.stage, ex);
  let weight = state.weight;
  let note: string | null = null;
  if (weight && state.lastPerformed && daysBetween(state.lastPerformed, today) > 14 && ex.loadType === 'weight') {
    weight = roundWeight(weight * 0.9, ex, units, 'down');
    note = 'It has been over two weeks since you last did this — weight reduced 10% to ease back in.';
  }
  const sets: PrescribedSet[] = [];
  if (state.tier === 'T1' && weight) sets.push(...warmupSets(weight, ex, units));
  for (let i = 0; i < scheme.sets; i++) {
    const targetReps = scheme.range
      ? Math.max(scheme.range[0], Math.min(scheme.range[1], state.repTargets?.[i] ?? scheme.range[0]))
      : scheme.reps;
    sets.push({
      kind: 'working',
      targetReps,
      targetWeight: ex.loadType === 'time' ? null : weight,
      amrap: scheme.amrapLast && i === scheme.sets - 1,
    });
  }
  return { scheme, sets, note };
}

// ---------------------------------------------------------------------------
// Evaluating a finished session

export interface PerformedSet {
  kind: 'warmup' | 'working';
  targetReps: number;
  targetWeight: number | null;
  actualReps: number | null;
  actualWeight: number | null;
  done: boolean;
  /** The user chose to skip this set (with a reason) — not a failed set. */
  skipped?: boolean;
}

export type Outcome = 'progress' | 'repeat' | 'stage_down' | 'reset' | 'deload' | 'none';

export interface Evaluation {
  state: LiftState;
  outcome: Outcome;
  message: string;
}

function fmt(w: number | null, units: Units): string {
  return w == null ? '—' : `${+w.toFixed(2)} ${units}`;
}

export function evaluate(
  prev: LiftState, ex: Exercise, sets: PerformedSet[], goal: Goal, units: Units,
  experience: Experience, date: string,
): Evaluation {
  const working = sets.filter((s) => s.kind === 'working');
  const done = working.filter((s) => s.done && (s.actualReps ?? 0) > 0);
  const state: LiftState = { ...prev, repTargets: prev.repTargets ? [...prev.repTargets] : null };
  if (done.length === 0) return { state: prev, outcome: 'none', message: `${ex.name}: not performed — no change.` };
  state.lastPerformed = date;

  const inc = increment(ex, prev.tier, units, experience);
  const usedWeight = Math.min(...done.map((s) => s.actualWeight ?? 0));
  const prescribed = working[0]?.targetWeight ?? null;

  // Skipped sets (pain, time, equipment…) aren't failures: hold the prescription.
  if (working.some((s) => s.skipped)) {
    return { state, outcome: 'repeat', message: `${ex.name}: some sets skipped — same plan next time.` };
  }

  if (prev.tier === 'T3') return evaluateDoubleProgression(state, ex, working, goal, units, inc, usedWeight);

  // A lift that was performed lighter than prescribed (e.g. working around pain)
  // is neither a pass nor a fail. Keep the prescription.
  if (ex.loadType === 'weight' && prescribed != null && usedWeight < prescribed) {
    return { state, outcome: 'repeat', message: `${ex.name}: done lighter than planned — staying at ${fmt(prescribed, units)}.` };
  }

  const success = working.every((s) => s.done && (s.actualReps ?? 0) >= s.targetReps);
  const scheme = getScheme(goal, prev.tier, prev.stage, ex);
  const base = ex.loadType === 'weight' ? Math.max(usedWeight, prescribed ?? 0) : (prev.weight ?? 0);

  if (success) {
    const amrap = working[working.length - 1];
    const bonus = prev.tier === 'T1' && experience === 'beginner' && (amrap.actualReps ?? 0) >= amrap.targetReps + 5;
    const next = ex.loadType === 'weight' ? roundWeight(base + inc * (bonus ? 2 : 1), ex, units) : base;
    state.weight = next;
    if (prev.tier === 'T2' && prev.stage === 0) state.stage0Weight = next;
    return {
      state, outcome: 'progress',
      message: `${ex.name}: hit ${scheme.label} — next time ${fmt(next, units)}${bonus ? ' (big AMRAP, double jump)' : ''}.`,
    };
  }

  if (prev.stage < stageCount(prev.tier) - 1) {
    state.stage = prev.stage + 1;
    state.weight = base;
    const nextScheme = getScheme(goal, prev.tier, state.stage, ex);
    return { state, outcome: 'stage_down', message: `${ex.name}: missed ${scheme.label} — moving to ${nextScheme.label} at ${fmt(base, units)}.` };
  }

  // Failed the final stage: reset.
  state.stage = 0;
  if (prev.tier === 'T1') {
    const best = Math.max(...done.map((s) => e1rm(s.actualWeight ?? 0, s.actualReps ?? 0)));
    const est5 = best / (1 + 5 / 30);
    state.weight = roundWeight(Math.min(est5 * 0.85, base * 0.9), ex, units, 'down');
  } else {
    const anchor = prev.stage0Weight ?? base * 0.85;
    state.weight = roundWeight(Math.min(anchor + inc, base * 0.9), ex, units, 'down');
    state.stage0Weight = state.weight;
  }
  const s0 = getScheme(goal, prev.tier, 0, ex);
  return { state, outcome: 'reset', message: `${ex.name}: stalled at the last stage — resetting to ${s0.label} at ${fmt(state.weight, units)} to build back up.` };
}

function evaluateDoubleProgression(
  state: LiftState, ex: Exercise, working: PerformedSet[], goal: Goal, units: Units, inc: number, usedWeight: number,
): Evaluation {
  const scheme = getScheme(goal, 'T3', 0, ex);
  const [lo, hi] = scheme.range!;
  const reps = working.map((s) => (s.done ? s.actualReps ?? 0 : 0));
  if (ex.loadType === 'weight' && usedWeight > 0) state.weight = usedWeight;

  if (reps.every((r) => r >= hi)) {
    state.fails = 0;
    state.repTargets = null;
    if (ex.loadType === 'weight') {
      state.weight = roundWeight((state.weight ?? 0) + inc, ex, units);
      return { state, outcome: 'progress', message: `${ex.name}: top of the range on every set — next time ${fmt(state.weight, units)} for ${lo}+.` };
    }
    state.repTargets = working.map(() => hi);
    const what = ex.loadType === 'time' ? 'holds' : 'reps';
    return { state, outcome: 'progress', message: `${ex.name}: maxed the ${what} range — add load or a harder variation when ready.` };
  }
  if (reps.some((r) => r < lo)) {
    state.fails = state.fails + 1;
    if (state.fails >= 3 && ex.loadType === 'weight' && state.weight) {
      state.weight = roundWeight(state.weight * 0.9, ex, units, 'down');
      state.fails = 0;
      state.repTargets = null;
      return { state, outcome: 'deload', message: `${ex.name}: below ${lo} reps three sessions running — weight down 10% to ${fmt(state.weight, units)}.` };
    }
    state.repTargets = reps.map((r) => Math.max(lo, r));
    return { state, outcome: 'repeat', message: `${ex.name}: below the rep range — same weight next time.` };
  }
  state.fails = 0;
  const step = ex.loadType === 'time' ? 5 : 1;
  state.repTargets = reps.map((r) => Math.min(hi, r + step));
  return { state, outcome: 'repeat', message: `${ex.name}: in range — aim for ${state.repTargets.join('/')} next time.` };
}

// ---------------------------------------------------------------------------
// Unit conversion of state

export function convertState(s: LiftState, ex: Exercise, from: Units, to: Units): LiftState {
  const conv = (w: number | null) => (w == null || w === 0 ? w : roundWeight(convertWeight(w, from, to), ex, to));
  return { ...s, weight: conv(s.weight), stage0Weight: conv(s.stage0Weight) };
}
