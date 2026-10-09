// Exercise catalog. Everything the programming engine and the AI coach can
// prescribe comes from this list, so logged history stays consistent.

export type Joint = 'elbow' | 'shoulder' | 'wrist' | 'knee' | 'lowBack' | 'hip';
export const JOINTS: Joint[] = ['elbow', 'shoulder', 'wrist', 'knee', 'lowBack', 'hip'];

export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'pullup_bar' | 'band';
export const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'pullup_bar', 'band'];

export type Muscle =
  | 'chest' | 'back' | 'shoulders' | 'rear_delts' | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'lower_back';

export type Category = 'main' | 'compound' | 'accessory' | 'mobility';
/** weight: load × reps. bodyweight: reps, optional added load. time: seconds held. */
export type LoadType = 'weight' | 'bodyweight' | 'time';
export type Family = 'squat' | 'bench' | 'deadlift' | 'ohp';

export interface Exercise {
  id: string;
  name: string;
  category: Category;
  muscles: Muscle[];
  equipment: Equipment[];
  loadType: LoadType;
  /** Lower-body lifts progress in bigger jumps. */
  lower: boolean;
  /** Joints this movement tends to load heavily. Used to filter for limitations. */
  stress: Joint[];
  /** For dumbbell work: weight is per hand. */
  perHand?: boolean;
  /** Relationship to a main lift, used to estimate a starting weight for substitutes. */
  family?: Family;
  ratio?: number;
  cues: string;
}

const E = (e: Exercise) => e;

export const EXERCISES: Exercise[] = [
  // ---- Main lifts ----
  E({ id: 'squat', name: 'Back Squat', category: 'main', muscles: ['quads', 'glutes'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['knee', 'lowBack', 'hip'], family: 'squat', ratio: 1, cues: 'Brace hard, break at hips and knees together, knees track over toes, hit depth, drive up through mid-foot.' }),
  E({ id: 'bench', name: 'Bench Press', category: 'main', muscles: ['chest', 'triceps', 'shoulders'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['shoulder', 'elbow', 'wrist'], family: 'bench', ratio: 1, cues: 'Shoulder blades pinned back and down, slight arch, feet planted, touch low chest, press up and slightly back.' }),
  E({ id: 'deadlift', name: 'Deadlift', category: 'main', muscles: ['hamstrings', 'glutes', 'lower_back', 'back'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['lowBack', 'hip'], family: 'deadlift', ratio: 1, cues: 'Bar over mid-foot, take the slack out, chest up, push the floor away, lock out with glutes — not by leaning back.' }),
  E({ id: 'ohp', name: 'Overhead Press', category: 'main', muscles: ['shoulders', 'triceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['shoulder', 'elbow', 'lowBack'], family: 'ohp', ratio: 1, cues: 'Squeeze glutes, ribs down, press in a straight line moving your head out of the way, finish with biceps by ears.' }),

  // ---- Squat variants ----
  E({ id: 'front_squat', name: 'Front Squat', category: 'compound', muscles: ['quads', 'glutes', 'core'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['knee', 'wrist'], family: 'squat', ratio: 0.8, cues: 'Elbows high, upright torso, sit straight down between the hips.' }),
  E({ id: 'safety_bar_squat', name: 'Safety Bar Squat', category: 'compound', muscles: ['quads', 'glutes'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['knee', 'hip'], family: 'squat', ratio: 0.9, cues: 'Hands on the handles, push the pads up into your traps, stay upright. Very shoulder/elbow friendly.' }),
  E({ id: 'box_squat', name: 'Box Squat', category: 'compound', muscles: ['quads', 'glutes', 'hamstrings'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['lowBack', 'hip'], family: 'squat', ratio: 0.85, cues: 'Sit back to the box under control, pause briefly without relaxing, drive up.' }),
  E({ id: 'goblet_squat', name: 'Goblet Squat', category: 'compound', muscles: ['quads', 'glutes'], equipment: ['dumbbell'], loadType: 'weight', lower: true, stress: ['knee'], family: 'squat', ratio: 0.3, cues: 'Hold the dumbbell at your chest, elbows inside knees at the bottom, stay tall.' }),
  E({ id: 'leg_press', name: 'Leg Press', category: 'compound', muscles: ['quads', 'glutes'], equipment: ['machine'], loadType: 'weight', lower: true, stress: ['knee'], family: 'squat', ratio: 1.6, cues: 'Lower until hips are about to tuck, keep low back on the pad, do not lock knees hard.' }),
  E({ id: 'hack_squat', name: 'Hack Squat', category: 'compound', muscles: ['quads', 'glutes'], equipment: ['machine'], loadType: 'weight', lower: true, stress: ['knee'], family: 'squat', ratio: 1.0, cues: 'Feet mid-platform, control the descent, drive through the whole foot.' }),

  // ---- Bench variants ----
  E({ id: 'incline_bench', name: 'Incline Bench Press', category: 'compound', muscles: ['chest', 'shoulders', 'triceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['shoulder', 'elbow'], family: 'bench', ratio: 0.8, cues: '30–45° bench, touch upper chest, elbows slightly tucked.' }),
  E({ id: 'close_grip_bench', name: 'Close-Grip Bench Press', category: 'compound', muscles: ['triceps', 'chest'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['elbow', 'wrist'], family: 'bench', ratio: 0.88, cues: 'Hands about shoulder width, elbows tucked, touch lower chest.' }),
  E({ id: 'floor_press', name: 'Floor Press', category: 'compound', muscles: ['chest', 'triceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['elbow'], family: 'bench', ratio: 0.9, cues: 'Lie on the floor, pause when triceps touch, press. Limits shoulder range — often shoulder-friendly.' }),
  E({ id: 'db_bench', name: 'Dumbbell Bench Press', category: 'compound', muscles: ['chest', 'triceps', 'shoulders'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: ['shoulder'], perHand: true, family: 'bench', ratio: 0.38, cues: 'Lower with control to chest level, press up and slightly in.' }),
  E({ id: 'neutral_db_press', name: 'Neutral-Grip Dumbbell Press', category: 'compound', muscles: ['chest', 'triceps'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, family: 'bench', ratio: 0.34, cues: 'Palms facing each other, elbows ~30° from torso. Usually the friendliest press for cranky elbows and shoulders.' }),
  E({ id: 'db_incline_press', name: 'Incline Dumbbell Press', category: 'compound', muscles: ['chest', 'shoulders', 'triceps'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: ['shoulder'], perHand: true, family: 'bench', ratio: 0.32, cues: 'Low incline, control the stretch, press up over the upper chest.' }),
  E({ id: 'machine_chest_press', name: 'Machine Chest Press', category: 'compound', muscles: ['chest', 'triceps'], equipment: ['machine'], loadType: 'weight', lower: false, stress: [], family: 'bench', ratio: 0.8, cues: 'Seat so handles line up mid-chest, press smoothly, do not slam the stack.' }),
  E({ id: 'pushup', name: 'Push-Up', category: 'accessory', muscles: ['chest', 'triceps', 'core'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: ['wrist'], cues: 'Body in one line, elbows ~45°, chest to the floor.' }),

  // ---- Deadlift / hinge variants ----
  E({ id: 'rdl', name: 'Romanian Deadlift', category: 'compound', muscles: ['hamstrings', 'glutes'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['lowBack'], family: 'deadlift', ratio: 0.7, cues: 'Soft knees, push hips back, bar close to legs, stop when hamstrings are stretched.' }),
  E({ id: 'trap_bar_deadlift', name: 'Trap Bar Deadlift', category: 'compound', muscles: ['quads', 'glutes', 'hamstrings', 'back'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['hip'], family: 'deadlift', ratio: 1.05, cues: 'Stand in the center, chest up, push through the floor. Less low-back demand than straight bar.' }),
  E({ id: 'sumo_deadlift', name: 'Sumo Deadlift', category: 'compound', muscles: ['glutes', 'quads', 'hamstrings', 'back'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['hip'], family: 'deadlift', ratio: 0.95, cues: 'Wide stance, knees out, arms straight down inside the legs, wedge hips to the bar.' }),
  E({ id: 'db_rdl', name: 'Dumbbell Romanian Deadlift', category: 'accessory', muscles: ['hamstrings', 'glutes'], equipment: ['dumbbell'], loadType: 'weight', lower: true, stress: ['lowBack'], perHand: true, family: 'deadlift', ratio: 0.25, cues: 'Dumbbells slide down the thighs, hips back, flat back.' }),
  E({ id: 'hip_thrust', name: 'Barbell Hip Thrust', category: 'accessory', muscles: ['glutes', 'hamstrings'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: [], family: 'deadlift', ratio: 0.8, cues: 'Upper back on bench, chin tucked, drive hips to full lockout, pause.' }),
  E({ id: 'good_morning', name: 'Good Morning', category: 'accessory', muscles: ['hamstrings', 'lower_back', 'glutes'], equipment: ['barbell'], loadType: 'weight', lower: true, stress: ['lowBack'], family: 'deadlift', ratio: 0.35, cues: 'Bar on back, soft knees, hinge until torso near parallel, keep back neutral.' }),
  E({ id: 'back_extension', name: 'Back Extension', category: 'accessory', muscles: ['lower_back', 'glutes', 'hamstrings'], equipment: ['machine'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Hinge at the hips, squeeze glutes to come up, do not hyperextend.' }),

  // ---- Overhead variants ----
  E({ id: 'push_press', name: 'Push Press', category: 'compound', muscles: ['shoulders', 'triceps', 'quads'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['shoulder', 'wrist'], family: 'ohp', ratio: 1.15, cues: 'Short dip, explosive drive with legs, press through to lockout.' }),
  E({ id: 'db_shoulder_press', name: 'Seated Dumbbell Shoulder Press', category: 'compound', muscles: ['shoulders', 'triceps'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: ['shoulder'], perHand: true, family: 'ohp', ratio: 0.38, cues: 'Back against a near-upright bench, press up, lower to ear level.' }),
  E({ id: 'landmine_press', name: 'Landmine Press', category: 'compound', muscles: ['shoulders', 'chest', 'triceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: [], family: 'ohp', ratio: 0.6, cues: 'Press the bar end up and forward on an arc. Shoulder-friendly alternative to overhead pressing.' }),
  E({ id: 'machine_shoulder_press', name: 'Machine Shoulder Press', category: 'compound', muscles: ['shoulders', 'triceps'], equipment: ['machine'], loadType: 'weight', lower: false, stress: ['shoulder'], family: 'ohp', ratio: 0.8, cues: 'Handles at shoulder height, press without shrugging.' }),

  // ---- Back / pulling ----
  E({ id: 'lat_pulldown', name: 'Lat Pulldown', category: 'accessory', muscles: ['back', 'biceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Lean back slightly, pull elbows down to your sides, bar to upper chest.' }),
  E({ id: 'neutral_pulldown', name: 'Neutral-Grip Pulldown', category: 'accessory', muscles: ['back', 'biceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Palms facing in, elbows to ribs. Easier on elbows than straight-bar pulldowns.' }),
  E({ id: 'pullup', name: 'Pull-Up', category: 'accessory', muscles: ['back', 'biceps'], equipment: ['pullup_bar'], loadType: 'bodyweight', lower: false, stress: ['elbow', 'shoulder'], cues: 'Full hang, pull chest to the bar, control the way down.' }),
  E({ id: 'chinup', name: 'Chin-Up', category: 'accessory', muscles: ['back', 'biceps'], equipment: ['pullup_bar'], loadType: 'bodyweight', lower: false, stress: ['elbow'], cues: 'Palms facing you, shoulder-width, chin over the bar.' }),
  E({ id: 'barbell_row', name: 'Barbell Row', category: 'accessory', muscles: ['back', 'rear_delts', 'biceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['lowBack', 'elbow'], cues: 'Hinge to ~45°, pull to lower ribs, no hip bounce.' }),
  E({ id: 'db_row', name: 'One-Arm Dumbbell Row', category: 'accessory', muscles: ['back', 'biceps', 'rear_delts'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, cues: 'Hand and knee on bench, pull the dumbbell to your hip, avoid twisting.' }),
  E({ id: 'chest_supported_row', name: 'Chest-Supported Row', category: 'accessory', muscles: ['back', 'rear_delts'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, cues: 'Chest on an incline bench, row with elbows ~45°, squeeze shoulder blades. No low-back load.' }),
  E({ id: 'cable_row', name: 'Seated Cable Row', category: 'accessory', muscles: ['back', 'biceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Sit tall, pull to the stomach, let shoulder blades protract on the return.' }),
  E({ id: 'face_pull', name: 'Face Pull', category: 'accessory', muscles: ['rear_delts', 'back'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Rope at eye level, pull toward your face, thumbs back, finish in a "double biceps" pose.' }),
  E({ id: 'band_pull_apart', name: 'Band Pull-Apart', category: 'mobility', muscles: ['rear_delts', 'back'], equipment: ['band'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Arms straight at shoulder height, pull the band to your chest, squeeze shoulder blades.' }),
  E({ id: 'straight_arm_pulldown', name: 'Straight-Arm Pulldown', category: 'accessory', muscles: ['back'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Arms nearly straight, sweep the bar to your thighs using lats.' }),

  // ---- Shoulders ----
  E({ id: 'lateral_raise', name: 'Dumbbell Lateral Raise', category: 'accessory', muscles: ['shoulders'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, cues: 'Slight forward lean, raise to shoulder height leading with elbows, control down.' }),
  E({ id: 'cable_lateral_raise', name: 'Cable Lateral Raise', category: 'accessory', muscles: ['shoulders'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Cable from low pulley across body, raise to shoulder height.' }),
  E({ id: 'rear_delt_fly', name: 'Rear Delt Fly', category: 'accessory', muscles: ['rear_delts'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, cues: 'Hinge over, slight elbow bend, sweep arms out wide.' }),

  // ---- Arms ----
  E({ id: 'barbell_curl', name: 'Barbell Curl', category: 'accessory', muscles: ['biceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['elbow', 'wrist'], cues: 'Elbows pinned, curl without swinging, lower slowly.' }),
  E({ id: 'db_curl', name: 'Dumbbell Curl', category: 'accessory', muscles: ['biceps'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: ['elbow'], perHand: true, cues: 'Supinate as you curl, full range, no swinging.' }),
  E({ id: 'hammer_curl', name: 'Hammer Curl', category: 'accessory', muscles: ['biceps', 'forearms'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], perHand: true, cues: 'Neutral grip throughout. Often tolerated better by irritated elbows.' }),
  E({ id: 'triceps_pushdown', name: 'Triceps Pushdown', category: 'accessory', muscles: ['triceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: ['elbow'], cues: 'Elbows at your sides, extend fully, control the return.' }),
  E({ id: 'rope_pushdown', name: 'Rope Pushdown', category: 'accessory', muscles: ['triceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Rope attachment, spread the ends at the bottom. Neutral grip is gentler on elbows.' }),
  E({ id: 'overhead_triceps_ext', name: 'Overhead Triceps Extension', category: 'accessory', muscles: ['triceps'], equipment: ['cable'], loadType: 'weight', lower: false, stress: ['elbow', 'shoulder'], cues: 'Face away from the cable, elbows by your head, extend overhead.' }),
  E({ id: 'skull_crusher', name: 'Skull Crusher', category: 'accessory', muscles: ['triceps'], equipment: ['barbell'], loadType: 'weight', lower: false, stress: ['elbow'], cues: 'EZ bar, lower toward forehead or behind head, elbows steady.' }),
  E({ id: 'dips', name: 'Dips', category: 'accessory', muscles: ['chest', 'triceps'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: ['shoulder', 'elbow'], cues: 'Slight forward lean, descend until upper arm is parallel, press up.' }),

  // ---- Legs ----
  E({ id: 'leg_curl', name: 'Leg Curl', category: 'accessory', muscles: ['hamstrings'], equipment: ['machine'], loadType: 'weight', lower: true, stress: [], cues: 'Hips pressed down, curl fully, slow eccentric.' }),
  E({ id: 'leg_extension', name: 'Leg Extension', category: 'accessory', muscles: ['quads'], equipment: ['machine'], loadType: 'weight', lower: true, stress: ['knee'], cues: 'Knee lined up with the machine pivot, extend fully, squeeze.' }),
  E({ id: 'bulgarian_split_squat', name: 'Bulgarian Split Squat', category: 'accessory', muscles: ['quads', 'glutes'], equipment: ['dumbbell'], loadType: 'weight', lower: true, stress: ['knee'], perHand: true, cues: 'Rear foot on bench, drop the back knee straight down, front foot flat.' }),
  E({ id: 'walking_lunge', name: 'Walking Lunge', category: 'accessory', muscles: ['quads', 'glutes'], equipment: ['dumbbell'], loadType: 'weight', lower: true, stress: ['knee'], perHand: true, cues: 'Long stride, back knee kisses the floor, push through front heel. Reps are per leg.' }),
  E({ id: 'step_up', name: 'Dumbbell Step-Up', category: 'accessory', muscles: ['quads', 'glutes'], equipment: ['dumbbell'], loadType: 'weight', lower: true, stress: [], perHand: true, cues: 'Knee-height box, drive through the top foot, minimal push from the back leg.' }),
  E({ id: 'glute_bridge', name: 'Glute Bridge', category: 'accessory', muscles: ['glutes', 'hamstrings'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Heels close to glutes, drive hips up, squeeze at the top.' }),
  E({ id: 'calf_raise', name: 'Standing Calf Raise', category: 'accessory', muscles: ['calves'], equipment: ['machine'], loadType: 'weight', lower: true, stress: [], cues: 'Full stretch at bottom, pause, rise onto the big toe.' }),

  // ---- Core ----
  E({ id: 'plank', name: 'Plank', category: 'accessory', muscles: ['core'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Forearms under shoulders, squeeze glutes, ribs down, breathe.' }),
  E({ id: 'hanging_leg_raise', name: 'Hanging Leg Raise', category: 'accessory', muscles: ['core'], equipment: ['pullup_bar'], loadType: 'bodyweight', lower: false, stress: ['shoulder'], cues: 'Dead hang, curl pelvis up, avoid swinging.' }),
  E({ id: 'cable_crunch', name: 'Cable Crunch', category: 'accessory', muscles: ['core'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Kneel, rope by your head, crunch ribs toward hips.' }),
  E({ id: 'pallof_press', name: 'Pallof Press', category: 'accessory', muscles: ['core'], equipment: ['cable'], loadType: 'weight', lower: false, stress: [], cues: 'Stand side-on to cable, press straight out and resist rotation. Reps per side.' }),
  E({ id: 'dead_bug', name: 'Dead Bug', category: 'accessory', muscles: ['core'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Low back pressed to floor, extend opposite arm and leg slowly.' }),
  E({ id: 'ab_wheel', name: 'Ab Wheel Rollout', category: 'accessory', muscles: ['core'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: ['lowBack', 'shoulder'], cues: 'From knees, roll out with a hollow body, pull back with abs.' }),

  // ---- Mobility, stretches, rehab ----
  E({ id: 'wrist_flexor_stretch', name: 'Wrist Flexor Stretch', category: 'mobility', muscles: ['forearms'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Arm straight, palm up, gently pull fingers back. Good for inner-elbow (golfer\'s elbow) irritation.' }),
  E({ id: 'wrist_extensor_stretch', name: 'Wrist Extensor Stretch', category: 'mobility', muscles: ['forearms'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Arm straight, palm down, gently flex the wrist. Good for outer-elbow (tennis elbow) irritation.' }),
  E({ id: 'eccentric_wrist_ext', name: 'Eccentric Wrist Extension', category: 'mobility', muscles: ['forearms'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], cues: 'Forearm on knee, palm down, lift with the other hand, lower slowly over 3–5 s. Common tennis-elbow rehab.' }),
  E({ id: 'eccentric_wrist_flex', name: 'Eccentric Wrist Flexion', category: 'mobility', muscles: ['forearms'], equipment: ['dumbbell'], loadType: 'weight', lower: false, stress: [], cues: 'Forearm on knee, palm up, lower slowly over 3–5 s. Common golfer\'s-elbow rehab.' }),
  E({ id: 'doorway_pec_stretch', name: 'Doorway Pec Stretch', category: 'mobility', muscles: ['chest'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Forearm on door frame at 90°, step through gently until you feel the chest stretch.' }),
  E({ id: 'sleeper_stretch', name: 'Sleeper Stretch', category: 'mobility', muscles: ['shoulders'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Lie on your side, arm at 90°, gently press the forearm toward the floor.' }),
  E({ id: 'band_dislocate', name: 'Band Shoulder Dislocates', category: 'mobility', muscles: ['shoulders'], equipment: ['band'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Wide grip on a band, arms straight, move slowly overhead and behind.' }),
  E({ id: 'external_rotation', name: 'Band External Rotation', category: 'mobility', muscles: ['rear_delts'], equipment: ['band'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Elbow pinned to your side at 90°, rotate the forearm out. Rotator cuff health.' }),
  E({ id: 'thoracic_extension', name: 'Thoracic Extension on Foam Roller', category: 'mobility', muscles: ['back'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Roller across upper back, hands behind head, extend over it segment by segment.' }),
  E({ id: 'cat_cow', name: 'Cat-Cow', category: 'mobility', muscles: ['lower_back', 'core'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'On all fours, alternate rounding and arching slowly with your breath.' }),
  E({ id: 'couch_stretch', name: 'Couch Stretch', category: 'mobility', muscles: ['quads'], equipment: ['bodyweight'], loadType: 'time', lower: true, stress: [], cues: 'Back knee against a wall/couch, front foot forward, squeeze glute. Hip flexor and quad stretch.' }),
  E({ id: 'pigeon_stretch', name: 'Pigeon Stretch', category: 'mobility', muscles: ['glutes'], equipment: ['bodyweight'], loadType: 'time', lower: true, stress: [], cues: 'Front shin across the body, hips square, sink down gently.' }),
  E({ id: 'hamstring_stretch', name: 'Hamstring Stretch', category: 'mobility', muscles: ['hamstrings'], equipment: ['bodyweight'], loadType: 'time', lower: true, stress: [], cues: 'Heel on a low step, hinge forward with a flat back.' }),
  E({ id: 'worlds_greatest', name: 'World\'s Greatest Stretch', category: 'mobility', muscles: ['hamstrings', 'glutes', 'back'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Lunge, elbow to instep, rotate and reach to the ceiling. Reps per side.' }),
  E({ id: 'ankle_dorsiflexion', name: 'Knee-to-Wall Ankle Mobilization', category: 'mobility', muscles: ['calves'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Foot a few inches from wall, drive knee forward over toes keeping heel down.' }),
  E({ id: 'spanish_squat', name: 'Spanish Squat (isometric)', category: 'mobility', muscles: ['quads'], equipment: ['band'], loadType: 'time', lower: true, stress: [], cues: 'Heavy band behind knees anchored in front, sit back to a vertical shin and hold. Often used for cranky knees/patellar tendon.' }),
  E({ id: 'mcgill_curl_up', name: 'McGill Curl-Up', category: 'mobility', muscles: ['core'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'One knee bent, hands under low back, lift head and shoulders slightly and hold 8–10 s.' }),
  E({ id: 'bird_dog', name: 'Bird Dog', category: 'mobility', muscles: ['core', 'lower_back'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'On all fours, extend opposite arm and leg, hold, keep hips level. Reps per side.' }),
  E({ id: 'leg_swings', name: 'Leg Swings', category: 'mobility', muscles: ['hamstrings', 'glutes'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Hold a rack for balance and swing one leg forward/back, then side to side, gradually increasing range. Reps per leg.' }),
  E({ id: 'arm_circles', name: 'Arm Circles', category: 'mobility', muscles: ['shoulders'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: false, stress: [], cues: 'Arms out to the sides, make small circles growing into big ones, then reverse.' }),
  E({ id: 'hip_90_90', name: '90/90 Hip Switch', category: 'mobility', muscles: ['glutes'], equipment: ['bodyweight'], loadType: 'bodyweight', lower: true, stress: [], cues: 'Sit with both knees bent at 90°, one in front and one to the side, then rotate both knees to switch sides. Reps per side.' }),
  E({ id: 'lat_stretch', name: 'Lat Stretch', category: 'mobility', muscles: ['back'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Hold a rack or post at hip height, sit your hips back and let your arm and side lengthen.' }),
  E({ id: 'calf_stretch', name: 'Wall Calf Stretch', category: 'mobility', muscles: ['calves'], equipment: ['bodyweight'], loadType: 'time', lower: true, stress: [], cues: 'Hands on a wall, back leg straight with heel down, lean forward until you feel the calf.' }),
  E({ id: 'triceps_stretch', name: 'Overhead Triceps Stretch', category: 'mobility', muscles: ['triceps'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Reach one hand down your back and gently press the elbow with the other hand.' }),
  E({ id: 'quad_stretch', name: 'Standing Quad Stretch', category: 'mobility', muscles: ['quads'], equipment: ['bodyweight'], loadType: 'time', lower: true, stress: [], cues: 'Hold your ankle behind you, knees together, squeeze the glute of the bent leg.' }),
  E({ id: 'cross_body_shoulder', name: 'Cross-Body Shoulder Stretch', category: 'mobility', muscles: ['rear_delts'], equipment: ['bodyweight'], loadType: 'time', lower: false, stress: [], cues: 'Bring one arm across your chest and gently pull it in with the other arm at the elbow.' }),
];

export const EXERCISE_MAP: Map<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));
export const EXERCISE_IDS = EXERCISES.map((e) => e.id);

export function getExercise(id: string): Exercise {
  const ex = EXERCISE_MAP.get(id);
  if (!ex) throw new Error(`Unknown exercise: ${id}`);
  return ex;
}

/** Can this exercise be done with the user's equipment? Bodyweight is always available. */
export function hasEquipment(ex: Exercise, available: Equipment[]): boolean {
  return ex.equipment.every((eq) => eq === 'bodyweight' || available.includes(eq));
}

export function avoidsJoints(ex: Exercise, limitations: Joint[]): boolean {
  return !ex.stress.some((j) => limitations.includes(j));
}
