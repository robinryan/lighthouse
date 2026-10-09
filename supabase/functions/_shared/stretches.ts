// Which stretches and mobility drills to do before and after each exercise,
// how long to do them, and how important they are (1–10) with the reason.
//
// The general approach follows common evidence-based practice: dynamic
// mobility and short holds before lifting (long static holds of 60 s+ can
// briefly reduce strength), longer static stretches after.

import { EXERCISE_MAP, type Joint } from './exercises.ts';

export type StretchWhen = 'before' | 'after';

export interface Dose {
  sets: number;
  /** Reps, or seconds when `unit` is 's'. */
  reps: number;
  unit: 'reps' | 's';
  /** e.g. "2 × 30 s each side" */
  text: string;
}

const d = (sets: number, reps: number, unit: 'reps' | 's', extra = ''): Dose => ({
  sets, reps, unit, text: `${sets} × ${reps}${unit === 's' ? ' s' : ''}${extra ? ` ${extra}` : ''}`,
});

/** How much and how long, for every stretch / mobility drill in the catalog. */
export const STRETCH_DOSE: Record<string, Dose> = {
  ankle_dorsiflexion: d(2, 10, 'reps', 'each side'),
  hip_90_90: d(2, 6, 'reps', 'each side'),
  leg_swings: d(2, 10, 'reps', 'each leg, each direction'),
  arm_circles: d(2, 10, 'reps', 'each direction'),
  worlds_greatest: d(2, 5, 'reps', 'each side'),
  cat_cow: d(2, 8, 'reps'),
  bird_dog: d(2, 6, 'reps', 'each side, 2 s hold'),
  band_pull_apart: d(2, 15, 'reps'),
  band_dislocate: d(2, 10, 'reps'),
  external_rotation: d(2, 15, 'reps', 'each side'),
  thoracic_extension: d(2, 8, 'reps'),
  mcgill_curl_up: d(3, 10, 's', 'holds'),
  spanish_squat: d(3, 30, 's'),
  couch_stretch: d(2, 45, 's', 'each side'),
  pigeon_stretch: d(2, 45, 's', 'each side'),
  hamstring_stretch: d(2, 30, 's', 'each side'),
  doorway_pec_stretch: d(2, 30, 's', 'each side'),
  sleeper_stretch: d(2, 30, 's', 'each side'),
  lat_stretch: d(2, 30, 's', 'each side'),
  calf_stretch: d(2, 30, 's', 'each side'),
  triceps_stretch: d(2, 30, 's', 'each side'),
  quad_stretch: d(2, 30, 's', 'each side'),
  cross_body_shoulder: d(2, 30, 's', 'each side'),
  wrist_flexor_stretch: d(2, 30, 's', 'each side'),
  wrist_extensor_stretch: d(2, 30, 's', 'each side'),
  eccentric_wrist_ext: d(3, 15, 'reps', 'slow lowering'),
  eccentric_wrist_flex: d(3, 15, 'reps', 'slow lowering'),
};

/** Joints each stretch helps — used to raise its importance when that joint is sensitive. */
const HELPS: Record<string, Joint[]> = {
  ankle_dorsiflexion: ['knee'], hip_90_90: ['hip', 'lowBack'], leg_swings: ['hip'], cat_cow: ['lowBack'], bird_dog: ['lowBack'],
  band_pull_apart: ['shoulder'], external_rotation: ['shoulder'], thoracic_extension: ['shoulder', 'lowBack'],
  band_dislocate: ['shoulder'], doorway_pec_stretch: ['shoulder'], lat_stretch: ['shoulder'], couch_stretch: ['hip', 'knee'],
  pigeon_stretch: ['hip', 'lowBack'], hamstring_stretch: ['lowBack'], wrist_flexor_stretch: ['wrist', 'elbow'],
  wrist_extensor_stretch: ['wrist', 'elbow'], arm_circles: ['shoulder'], triceps_stretch: ['elbow', 'shoulder'],
  quad_stretch: ['knee'], cross_body_shoulder: ['shoulder'], worlds_greatest: ['hip'], calf_stretch: ['knee'],
};

interface Rule { stretchId: string; when: StretchWhen; why: string; importance: Record<string, number> }

// Shared explanations, with per-exercise importance.
const WHY = {
  ankles: 'Stiff ankles are the most common reason squats lose depth or heels lift. A few reps let your knees travel forward safely.',
  hips90: 'Opens hip rotation so you can sit between your hips with knees tracking your toes, instead of your pelvis tucking at the bottom.',
  legSwingsSquat: 'A dynamic hip and hamstring warm-up that raises range without the strength dip long static holds can cause.',
  couch: 'Squatting works the hip flexors and quads hard; a long hold afterwards helps keep hip extension, especially if you sit a lot.',
  quadAfter: 'Single-leg work leaves the front of the thigh tight; a short hold afterwards eases it.',
  catCow: 'Rehearses moving between a rounded and a neutral spine, so you can feel and lock in a flat back before loading it.',
  legSwingsHinge: 'Dynamic hamstring warm-up: helps you reach the bar with hips high and a flat back.',
  hips90Sumo: 'Sumo needs lots of hip rotation to open the knees and get the hips close to the bar.',
  birdDog: 'Switches on the trunk muscles that keep your spine stable under load.',
  hamsAfter: 'Hinging tightens the hamstrings; a gentle hold afterwards helps keep range for your next session.',
  pigeonAfter: 'Releases the glutes and hips after heavy hip work.',
  pullApart: 'Wakes up the upper back so you can pin your shoulder blades — a stable base that protects the shoulders.',
  cuff: 'Warms up the rotator cuff, which steadies the shoulder through the bottom of the press.',
  tspine: 'A mobile upper back makes it easier to keep your chest up and shoulders back.',
  pecAfter: 'Pressing shortens the chest; stretching it afterwards helps keep a neutral, comfortable shoulder position.',
  dislocates: 'Pressing overhead needs full shoulder range. Without it, your lower back arches to make up the difference.',
  tspineOverhead: 'Upper-back extension lets the bar finish over your mid-foot without leaning back.',
  latAfter: 'Tight lats pull the arms forward and limit overhead range; stretching them after helps next time.',
  armCircles: 'A gentle full-range shoulder warm-up before loading it.',
  pullApartPull: 'Gets the shoulder blades moving so your back, not your arms, does the pulling.',
  catCowRow: 'Bent-over rows load the lower back; this rehearses holding it neutral.',
  latAfterPull: 'Pulling shortens the lats; a hold afterwards keeps your overhead range.',
  wristFlex: 'Curls load the forearm flexors around the inner elbow; a light stretch eases tension there.',
  tricepsAfter: 'Eases the triceps and elbow after extension work.',
  armCirclesArms: 'Warms the shoulders before overhead arm work.',
  legSwingsCurl: 'Warms the hamstrings dynamically before loading them in a shortened position.',
  calfAfter: 'Long calf holds after calf work help ankle range for squatting.',
  catCowCore: 'Ab wheel rollouts demand control of the lower back; rehearse it first.',
} as const;

const SQUATS = ['squat', 'front_squat', 'safety_bar_squat', 'box_squat', 'goblet_squat', 'hack_squat', 'leg_press', 'bulgarian_split_squat', 'walking_lunge', 'step_up'];
const all = (ids: string[], v: number, over: Record<string, number> = {}) => Object.fromEntries(ids.map((id) => [id, over[id] ?? v]));

const RULES: Rule[] = [
  // Squat pattern
  { stretchId: 'ankle_dorsiflexion', when: 'before', why: WHY.ankles, importance: all(SQUATS, 6, { squat: 8, front_squat: 8, goblet_squat: 7, safety_bar_squat: 7, leg_press: 4 }) },
  { stretchId: 'hip_90_90', when: 'before', why: WHY.hips90, importance: all(SQUATS, 6, { squat: 7, front_squat: 7, box_squat: 7, safety_bar_squat: 7, leg_press: 4, hack_squat: 5 }) },
  { stretchId: 'leg_swings', when: 'before', why: WHY.legSwingsSquat, importance: all(['squat', 'front_squat', 'box_squat', 'safety_bar_squat', 'bulgarian_split_squat', 'walking_lunge'], 6) },
  { stretchId: 'couch_stretch', when: 'after', why: WHY.couch, importance: all(['squat', 'front_squat', 'box_squat', 'safety_bar_squat', 'goblet_squat', 'hack_squat', 'leg_press'], 6, { leg_press: 5, hack_squat: 5 }) },
  { stretchId: 'quad_stretch', when: 'after', why: WHY.quadAfter, importance: all(['bulgarian_split_squat', 'walking_lunge', 'step_up', 'leg_extension'], 5) },
  { stretchId: 'lat_stretch', when: 'before', why: 'Tight lats stop your elbows getting high in the front rack.', importance: { front_squat: 6 } },
  // Hinge pattern
  { stretchId: 'cat_cow', when: 'before', why: WHY.catCow, importance: { deadlift: 7, rdl: 6, good_morning: 8, trap_bar_deadlift: 6, sumo_deadlift: 6, db_rdl: 5, back_extension: 5 } },
  { stretchId: 'leg_swings', when: 'before', why: WHY.legSwingsHinge, importance: { deadlift: 7, rdl: 8, db_rdl: 7, good_morning: 7, sumo_deadlift: 6, trap_bar_deadlift: 5, hip_thrust: 4 } },
  { stretchId: 'hip_90_90', when: 'before', why: WHY.hips90Sumo, importance: { sumo_deadlift: 8, hip_thrust: 5 } },
  { stretchId: 'bird_dog', when: 'before', why: WHY.birdDog, importance: { deadlift: 5, trap_bar_deadlift: 5, good_morning: 5 } },
  { stretchId: 'hamstring_stretch', when: 'after', why: WHY.hamsAfter, importance: { deadlift: 5, rdl: 6, db_rdl: 6, good_morning: 6, sumo_deadlift: 5, leg_curl: 5 } },
  { stretchId: 'pigeon_stretch', when: 'after', why: WHY.pigeonAfter, importance: { sumo_deadlift: 6, hip_thrust: 6, trap_bar_deadlift: 5, deadlift: 4, glute_bridge: 4 } },
  // Horizontal pressing
  { stretchId: 'band_pull_apart', when: 'before', why: WHY.pullApart, importance: { bench: 7, incline_bench: 7, close_grip_bench: 6, floor_press: 6, db_bench: 6, db_incline_press: 6, neutral_db_press: 5, dips: 6, machine_chest_press: 4, pushup: 4 } },
  { stretchId: 'external_rotation', when: 'before', why: WHY.cuff, importance: { bench: 6, incline_bench: 6, db_bench: 6, db_incline_press: 6, dips: 7, close_grip_bench: 5, floor_press: 5, neutral_db_press: 5 } },
  { stretchId: 'thoracic_extension', when: 'before', why: WHY.tspine, importance: { bench: 5, incline_bench: 5 } },
  { stretchId: 'doorway_pec_stretch', when: 'after', why: WHY.pecAfter, importance: { bench: 6, incline_bench: 6, db_bench: 6, db_incline_press: 6, dips: 6, close_grip_bench: 5, floor_press: 5, neutral_db_press: 5, machine_chest_press: 5, pushup: 4 } },
  // Overhead pressing
  { stretchId: 'band_dislocate', when: 'before', why: WHY.dislocates, importance: { ohp: 8, push_press: 8, db_shoulder_press: 7, machine_shoulder_press: 6, landmine_press: 4, lateral_raise: 4, cable_lateral_raise: 4 } },
  { stretchId: 'thoracic_extension', when: 'before', why: WHY.tspineOverhead, importance: { ohp: 7, push_press: 7, db_shoulder_press: 6, machine_shoulder_press: 5, landmine_press: 4 } },
  { stretchId: 'external_rotation', when: 'before', why: WHY.cuff, importance: { ohp: 6, push_press: 6, db_shoulder_press: 6, lateral_raise: 5, cable_lateral_raise: 5 } },
  { stretchId: 'lat_stretch', when: 'after', why: WHY.latAfter, importance: { ohp: 6, push_press: 6, db_shoulder_press: 5, machine_shoulder_press: 5 } },
  // Pulling
  { stretchId: 'arm_circles', when: 'before', why: WHY.armCircles, importance: { pullup: 6, chinup: 6, lat_pulldown: 5, neutral_pulldown: 5, straight_arm_pulldown: 4, overhead_triceps_ext: 4, skull_crusher: 4, hanging_leg_raise: 4 } },
  { stretchId: 'band_pull_apart', when: 'before', why: WHY.pullApartPull, importance: { barbell_row: 5, db_row: 5, chest_supported_row: 5, cable_row: 5, face_pull: 4, rear_delt_fly: 4 } },
  { stretchId: 'cat_cow', when: 'before', why: WHY.catCowRow, importance: { barbell_row: 6 } },
  { stretchId: 'lat_stretch', when: 'after', why: WHY.latAfterPull, importance: { pullup: 6, chinup: 6, lat_pulldown: 6, neutral_pulldown: 6, straight_arm_pulldown: 5, barbell_row: 4, db_row: 4, cable_row: 4 } },
  { stretchId: 'cross_body_shoulder', when: 'after', why: 'Eases the back of the shoulder after rowing and rear-delt work.', importance: { face_pull: 4, rear_delt_fly: 4, chest_supported_row: 4 } },
  // Arms
  { stretchId: 'wrist_flexor_stretch', when: 'after', why: WHY.wristFlex, importance: { barbell_curl: 4, db_curl: 4, hammer_curl: 4, chinup: 4 } },
  { stretchId: 'triceps_stretch', when: 'after', why: WHY.tricepsAfter, importance: { triceps_pushdown: 4, rope_pushdown: 4, overhead_triceps_ext: 5, skull_crusher: 5, close_grip_bench: 4, dips: 4 } },
  // Legs (isolation) and core
  { stretchId: 'leg_swings', when: 'before', why: WHY.legSwingsCurl, importance: { leg_curl: 5 } },
  { stretchId: 'calf_stretch', when: 'after', why: WHY.calfAfter, importance: { calf_raise: 6 } },
  { stretchId: 'cat_cow', when: 'before', why: WHY.catCowCore, importance: { ab_wheel: 5 } },
];

export interface StretchRec {
  stretchId: string;
  name: string;
  when: StretchWhen;
  /** 1–10 */
  importance: number;
  why: string;
  dose: Dose | null;
}

const JOINT_LABEL: Record<Joint, string> = { elbow: 'elbows', shoulder: 'shoulders', wrist: 'wrists', knee: 'knees', lowBack: 'lower back', hip: 'hips' };

/**
 * Recommended stretches for an exercise, most important first. Pass the user's
 * joint sensitivities (0–3) to raise stretches that help a sensitive joint.
 */
export function stretchesFor(exerciseId: string, sensitive: Partial<Record<Joint, number>> = {}): StretchRec[] {
  const ex = EXERCISE_MAP.get(exerciseId);
  const out: StretchRec[] = [];
  for (const r of RULES) {
    const base = r.importance[exerciseId];
    if (!base) continue;
    const stretch = EXERCISE_MAP.get(r.stretchId)!;
    // Boost when the stretch helps a sensitive joint that this exercise loads (or any sensitive joint it helps).
    const helped = (HELPS[r.stretchId] ?? []).filter((j) => (sensitive[j] ?? 0) >= 1);
    const loaded = helped.filter((j) => ex?.stress.includes(j));
    const boost = loaded.length ? 2 : helped.length ? 1 : 0;
    const importance = Math.min(10, base + boost);
    const why = boost
      ? `${r.why} Rated higher because your ${(loaded.length ? loaded : helped).map((j) => JOINT_LABEL[j]).join(' and ')} ${(loaded.length ? loaded : helped).length > 1 ? 'are' : 'is'} sensitive.`
      : r.why;
    out.push({ stretchId: r.stretchId, name: stretch.name, when: r.when, importance, why, dose: STRETCH_DOSE[r.stretchId] ?? null });
  }
  return out.sort((a, b) => b.importance - a.importance || (a.when === 'before' ? -1 : 1));
}

/** Importance at or above which a stretch is added to workouts automatically. */
export const AUTO_ADD_THRESHOLD = { before: 7, after: 6 } as const;
