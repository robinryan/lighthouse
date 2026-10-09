// Ranks exercises for "Add exercise" and for replacing a skipped exercise,
// using recent training volume, the health profile, and the reason for a skip.

import { EXERCISES, EXERCISE_MAP, type Equipment, type Exercise, type Joint, type Muscle, hasEquipment } from './exercises.ts';
import { type HealthSummary, JOINT_NAMES, type SkipFeedback } from './health.ts';

export interface Suggestion { exerciseId: string; name: string; score: number; reasons: string[] }

export interface RecContext {
  equipment: Equipment[];
  goal: 'strength' | 'hypertrophy' | 'general';
  health: HealthSummary;
  /** Completed hard sets per muscle over the last 7 days. */
  muscleSets: Partial<Record<string, number>>;
  /** Exercises already in today's workout (and not skipped). */
  inWorkout: Set<string>;
  /** Planned working sets per muscle in today's workout. */
  todayMuscleSets?: Partial<Record<string, number>>;
  /** Exercises the user has logged before. */
  history: Set<string>;
}

const MUSCLE_NAMES: Record<string, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', rear_delts: 'Rear delts', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', core: 'Core', lower_back: 'Lower back',
};

/** Mobility and rehab work that helps a sensitive joint. */
export const JOINT_CARE: Record<Joint, string[]> = {
  elbow: ['eccentric_wrist_ext', 'wrist_extensor_stretch', 'eccentric_wrist_flex', 'wrist_flexor_stretch'],
  wrist: ['wrist_flexor_stretch', 'wrist_extensor_stretch', 'eccentric_wrist_flex'],
  shoulder: ['external_rotation', 'band_pull_apart', 'face_pull', 'sleeper_stretch', 'doorway_pec_stretch', 'band_dislocate'],
  knee: ['spanish_squat', 'ankle_dorsiflexion', 'couch_stretch'],
  lowBack: ['mcgill_curl_up', 'bird_dog', 'dead_bug', 'cat_cow'],
  hip: ['couch_stretch', 'pigeon_stretch', 'worlds_greatest'],
};

function joinNames(js: Joint[]) { return js.map((j) => JOINT_NAMES[j]).join(' and '); }

/** Penalties and notes shared by both modes. Returns null to exclude the exercise. */
function healthScore(ex: Exercise, ctx: RecContext, reasons: string[]): number | null {
  if (ctx.health.avoid.has(ex.id)) return null;
  let score = 0;
  const sensitive = (Object.entries(ctx.health.joints) as Array<[Joint, number]>).filter(([, s]) => s > 0);
  const hits = sensitive.filter(([j]) => ex.stress.includes(j));
  for (const [, s] of hits) score -= 15 * s;
  if (hits.some(([, s]) => s >= 3)) return null;
  if (sensitive.length && !hits.length && ex.category !== 'mobility') {
    reasons.push(`Easy on your ${joinNames(sensitive.map(([j]) => j))}`);
    score += 4;
  } else if (hits.length) {
    reasons.push(`Loads your ${joinNames(hits.map(([j]) => j))} — go light`);
  }
  if (ctx.health.prefer.has(ex.id)) { score += 15; reasons.push('Works well for you'); }
  if (ctx.health.dislike.has(ex.id)) { score -= 25; reasons.push('You\'ve said you don\'t enjoy this'); }
  if (ctx.history.has(ex.id)) score += 3;
  return score;
}

/** Weekly hard-set targets. Lower back and forearms get plenty of indirect work, so they have none. */
function weeklyTarget(m: string, goal: RecContext['goal']): number {
  if (m === 'lower_back' || m === 'forearms') return 0;
  if (m === 'core' || m === 'calves') return 6;
  return goal === 'hypertrophy' ? 12 : 10;
}

function volumeScore(ex: Exercise, ctx: RecContext, reasons: string[]): number {
  const sets = (m: string) => (ctx.muscleSets[m] ?? 0) + (ctx.todayMuscleSets?.[m] ?? 0);
  const deficit = (m: string) => {
    const t = weeklyTarget(m, ctx.goal);
    return t ? Math.max(0, t - sets(m)) / t : 0;
  };
  // The main muscle counts fully; secondary muscles add a little.
  const [primary, ...others] = ex.muscles;
  const bestOther = others.reduce<Muscle | null>((best, m) => (best == null || deficit(m) > deficit(best) ? m : best), null);
  const score = deficit(primary) + 0.4 * (bestOther ? deficit(bestOther) : 0);
  const why = deficit(primary) >= 0.3 ? primary : bestOther && deficit(bestOther) >= 0.5 ? bestOther : null;
  if (why) reasons.unshift(`${MUSCLE_NAMES[why] ?? why} is under-trained this week (${sets(why)}/${weeklyTarget(why, ctx.goal)} sets)`);
  // Already plenty of work for the main muscle today.
  const heavyToday = (ctx.todayMuscleSets?.[primary] ?? 0) >= 5;
  return (40 * score) / 1.4 - (heavyToday ? 12 : 0);
}

function finish(list: Suggestion[], limit: number) {
  return list.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => ({ ...s, score: Math.round(s.score * 10) / 10 }));
}

/** Most beneficial exercises to add to today's workout. */
export function recommendAdd(ctx: RecContext, limit = 8): Suggestion[] {
  const careJoints = (Object.entries(ctx.health.joints) as Array<[Joint, number]>).filter(([, s]) => s >= 1).map(([j]) => j);
  const care = new Map<string, Joint>();
  for (const j of careJoints) for (const id of JOINT_CARE[j]) if (!care.has(id)) care.set(id, j);

  // Movement patterns already done today (e.g. no front squats on squat day), and joints already worked hard.
  const familiesToday = new Set([...ctx.inWorkout].map((id) => EXERCISE_MAP.get(id)?.family).filter(Boolean));
  const jointsToday = new Set([...ctx.inWorkout].flatMap((id) => {
    const e = EXERCISE_MAP.get(id);
    return e && (e.category === 'main' || e.category === 'compound') ? e.stress : [];
  }));

  const out: Suggestion[] = [];
  for (const ex of EXERCISES) {
    if (ctx.inWorkout.has(ex.id) || !hasEquipment(ex, ctx.equipment)) continue;
    const reasons: string[] = [];
    const h = healthScore(ex, ctx, reasons);
    if (h == null) continue;
    let score = h;
    if (ex.family && familiesToday.has(ex.family)) score -= 25;
    if (ex.category === 'compound') score -= 4; // add-ons are usually accessories
    score -= 6 * ex.stress.filter((j) => jointsToday.has(j)).length;
    if (ex.category === 'mobility') {
      const j = care.get(ex.id);
      if (!j) continue;
      score += 22;
      reasons.unshift(`Helps your ${JOINT_NAMES[j]}`);
    } else {
      score += volumeScore(ex, ctx, reasons);
      if (ex.category === 'main') score -= 8; // heavy main lifts are programmed elsewhere
    }
    out.push({ exerciseId: ex.id, name: ex.name, score, reasons: reasons.slice(0, 3) });
  }
  const ranked = finish(out, out.length);
  // Variety: at most two suggestions per main muscle.
  const perMuscle = new Map<string, number>();
  const top: Suggestion[] = [];
  for (const sug of ranked) {
    if (top.length >= limit) break;
    const m = EXERCISE_MAP.get(sug.exerciseId)!.muscles[0];
    if ((perMuscle.get(m) ?? 0) >= 2) continue;
    perMuscle.set(m, (perMuscle.get(m) ?? 0) + 1);
    top.push(sug);
  }
  // With a sensitive joint on record, always keep one care/rehab option in view.
  if (care.size && !top.some((s) => care.has(s.exerciseId))) {
    const bestCare = ranked.find((s) => care.has(s.exerciseId));
    if (bestCare && top.length) top[top.length - 1] = bestCare;
  }
  return top;
}

/** Replacements for an exercise the user skipped, shaped by why they skipped it. */
export function recommendReplacement(ctx: RecContext, baseId: string, feedback: SkipFeedback | null, limit = 5): Suggestion[] {
  const base = EXERCISE_MAP.get(baseId);
  if (!base) return [];
  const reason = feedback?.reason;
  const painJoints: Joint[] = reason === 'pain' ? (feedback!.joints.length ? feedback!.joints : base.stress) : [];

  const out: Suggestion[] = [];
  for (const ex of EXERCISES) {
    if (ex.id === baseId || ctx.inWorkout.has(ex.id) || !hasEquipment(ex, ctx.equipment)) continue;
    if (ex.category === 'mobility' && reason !== 'pain') continue;
    if (painJoints.some((j) => ex.stress.includes(j))) continue;
    const reasons: string[] = [];
    const h = healthScore(ex, ctx, reasons);
    if (h == null) continue;
    let score = h;

    if (ex.category === 'mobility') {
      const helps = painJoints.find((j) => JOINT_CARE[j].includes(ex.id));
      if (!helps) continue;
      score += 18;
      reasons.unshift(`Rehab/mobility for your ${JOINT_NAMES[helps]}`);
    } else {
      const shared = ex.muscles.filter((m) => base.muscles.includes(m));
      if (!shared.length) continue;
      score += 20 * shared.length + (ex.muscles[0] === base.muscles[0] ? 15 : 0);
      if (base.family && ex.family === base.family) { score += 25; reasons.unshift('Same movement pattern'); }
      else reasons.unshift(`Works ${shared.map((m) => MUSCLE_NAMES[m] ?? m).join(', ').toLowerCase()}`);
      if (ex.category === base.category) score += 5;
    }

    if (painJoints.length && ex.category !== 'mobility') reasons.splice(1, 0, `Avoids loading your ${joinNames(painJoints)}`);
    const sameGear = ex.equipment.some((e) => base.equipment.includes(e) && e !== 'bodyweight');
    if (reason === 'equipment') {
      if (sameGear) score -= 30; else reasons.push('Uses different equipment');
    }
    const easyToScale = ex.equipment.some((e) => e === 'machine' || e === 'cable' || e === 'dumbbell') && ex.category !== 'main';
    if (reason === 'too_hard' || reason === 'tired') {
      if (easyToScale) { score += 12; reasons.push('Easier to scale the load'); }
      if (ex.category === 'main' || (ex.equipment.includes('barbell') && ex.category === 'compound')) score -= 12;
    }
    if (reason === 'time' && easyToScale) { score += 6; reasons.push('Quick to set up'); }
    if (reason === 'too_easy' && (ex.category === 'compound' || ex.category === 'main')) { score += 12; reasons.push('More challenging'); }
    if (reason === 'dislike' && base.family && ex.family === base.family) score -= 10;

    // "Avoids loading your X" already says it; drop the generic "Easy on your X".
    const deduped = painJoints.length ? reasons.filter((r) => !r.startsWith('Easy on your')) : reasons;
    out.push({ exerciseId: ex.id, name: ex.name, score, reasons: [...new Set(deduped)].slice(0, 3) });
  }
  return finish(out, limit);
}
