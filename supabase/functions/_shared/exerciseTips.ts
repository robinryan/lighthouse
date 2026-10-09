// Three form & safety points per exercise, shown under the exercise name in the app.

export const EXERCISE_TIPS: Record<string, [string, string, string]> = {
  squat: [
    'Brace your core hard before each rep and keep the bar over mid-foot.',
    'Push knees out in line with your toes; descend to at least parallel.',
    'Set safety pins/arms just below your bottom position.',
  ],
  bench: [
    'Squeeze shoulder blades back and down; keep them pinned all set.',
    'Lower to the lower chest with forearms vertical, elbows ~45–70°.',
    'Use a spotter or safety arms, and never use a thumbless grip.',
  ],
  deadlift: [
    'Bar over mid-foot, shins near the bar, back flat before you pull.',
    'Pull the slack out of the bar first, then push the floor away.',
    'Lock out with your glutes — don\'t lean back or shrug at the top.',
  ],
  ohp: [
    'Squeeze glutes and brace so your lower back doesn\'t arch.',
    'Press in a straight line, moving your head back then through.',
    'Finish with the bar over mid-foot and biceps by your ears.',
  ],
  front_squat: [
    'Keep elbows high so the bar stays on your shoulders, not your hands.',
    'Stay upright and sit straight down between your hips.',
    'If wrists hurt, use straps or a cross-arm grip.',
  ],
  safety_bar_squat: [
    'Hold the handles and push the pads up into your traps.',
    'The bar pitches you forward — fight to keep your chest up.',
    'A good choice when shoulders or elbows dislike a straight bar.',
  ],
  box_squat: [
    'Sit back to the box under control; don\'t crash onto it.',
    'Pause briefly while staying braced, without relaxing your trunk.',
    'Drive up through mid-foot, knees pushed out.',
  ],
  goblet_squat: [
    'Hold the dumbbell tight to your chest with elbows down.',
    'Sit between your heels, elbows brushing inside the knees.',
    'Keep your whole foot planted and your chest tall.',
  ],
  leg_press: [
    'Lower until your hips are about to lift off the pad, no further.',
    'Keep your lower back pressed into the seat throughout.',
    'Don\'t snap the knees into hard lockout at the top.',
  ],
  hack_squat: [
    'Place feet mid-platform, about shoulder width.',
    'Control the descent; keep hips and back against the pad.',
    'Push through your whole foot and avoid locking the knees hard.',
  ],
  incline_bench: [
    'Use a 30–45° incline; steeper shifts work to the shoulders.',
    'Keep shoulder blades retracted and touch the upper chest.',
    'Same safety as flat bench: spotter or safety arms.',
  ],
  close_grip_bench: [
    'Grip about shoulder width — narrower strains the wrists.',
    'Tuck elbows close to your sides and touch the lower chest.',
    'Keep wrists stacked over elbows; skip if elbows ache.',
  ],
  floor_press: [
    'Lower until your triceps rest on the floor, then pause briefly.',
    'Keep elbows ~45° from your torso; don\'t bounce off the floor.',
    'The limited range often spares sensitive shoulders.',
  ],
  db_bench: [
    'Kick dumbbells up from your knees to get into position safely.',
    'Lower to chest level with control; stop where shoulders feel good.',
    'Press up and slightly in without clanging the bells together.',
  ],
  neutral_db_press: [
    'Palms face each other through the whole rep.',
    'Keep elbows about 30° from your torso.',
    'Often the most comfortable press for cranky elbows and shoulders.',
  ],
  db_incline_press: [
    'Set a low incline (15–30°) to keep tension on the upper chest.',
    'Control the stretch at the bottom; don\'t let elbows drop too low.',
    'Press up over the upper chest, keeping shoulder blades back.',
  ],
  machine_chest_press: [
    'Set the seat so handles line up with your mid-chest.',
    'Keep shoulder blades back against the pad.',
    'Control both directions — don\'t let the stack slam.',
  ],
  pushup: [
    'Keep a straight line from head to heels; squeeze your glutes.',
    'Elbows at roughly 45°, chest touches the floor.',
    'Elevate your hands to make it easier, feet to make it harder.',
  ],
  rdl: [
    'Keep a soft bend in the knees and push your hips back.',
    'Slide the bar close to your legs with a flat back.',
    'Stop when your hamstrings are fully stretched, not at the floor.',
  ],
  trap_bar_deadlift: [
    'Stand centred in the bar with handles in line with your ankles.',
    'Chest up, back flat, then push the floor away.',
    'Usually easier on the lower back than a straight-bar deadlift.',
  ],
  sumo_deadlift: [
    'Take a wide stance with toes pointed out and knees tracking them.',
    'Arms hang straight down inside your legs.',
    'Wedge your hips toward the bar before you pull.',
  ],
  db_rdl: [
    'Let the dumbbells slide down the front of your thighs.',
    'Hinge at the hips with soft knees and a flat back.',
    'Stand up by squeezing your glutes, not by leaning back.',
  ],
  hip_thrust: [
    'Upper back on the bench edge, bar padded across your hips.',
    'Tuck your chin and drive your hips to full lockout.',
    'Pause and squeeze at the top; don\'t over-arch your back.',
  ],
  good_morning: [
    'Start light — this loads the lower back a lot.',
    'Keep soft knees and hinge until your torso is near parallel.',
    'Keep a neutral spine the whole time.',
  ],
  back_extension: [
    'Set the pad just below your hip crease.',
    'Hinge at the hips and rise by squeezing your glutes.',
    'Stop at a straight body line — don\'t hyperextend.',
  ],
  push_press: [
    'Dip by bending your knees slightly, torso upright.',
    'Drive explosively with your legs, then press to lockout.',
    'Lower under control to your shoulders, absorbing with your knees.',
  ],
  db_shoulder_press: [
    'Use a near-upright bench with your back supported.',
    'Lower to ear level; don\'t let the elbows flare behind you.',
    'Press without shrugging your shoulders.',
  ],
  landmine_press: [
    'Press the bar up and forward on its natural arc.',
    'Brace your core and don\'t twist through the torso.',
    'A shoulder-friendly alternative to pressing overhead.',
  ],
  machine_shoulder_press: [
    'Adjust the seat so handles start at shoulder height.',
    'Press without shrugging; keep your back on the pad.',
    'Control the way down.',
  ],
  lat_pulldown: [
    'Lean back slightly and pull the bar to your upper chest.',
    'Drive your elbows down to your sides.',
    'Don\'t yank with momentum; control the return to a full stretch.',
  ],
  neutral_pulldown: [
    'Use a neutral (palms-facing) handle.',
    'Pull your elbows toward your ribs.',
    'Usually easier on the elbows than a straight bar.',
  ],
  pullup: [
    'Start from a full hang with shoulders engaged, not shrugged.',
    'Pull your chest toward the bar and avoid kipping.',
    'Lower under control; use a band or machine if needed.',
  ],
  chinup: [
    'Palms toward you, hands about shoulder width.',
    'Get your chin over the bar without craning your neck.',
    'Take a full but controlled descent.',
  ],
  barbell_row: [
    'Hinge to about 45° with a flat back and braced core.',
    'Pull the bar to your lower ribs, squeezing your shoulder blades.',
    'Don\'t bounce with your hips; go lighter if your lower back rounds.',
  ],
  db_row: [
    'Brace on a bench with one hand and knee.',
    'Pull the dumbbell toward your hip, not straight up.',
    'Keep your torso square; don\'t twist to lift heavier.',
  ],
  chest_supported_row: [
    'Rest your chest on an incline bench to unload your lower back.',
    'Row with your elbows at about 45°.',
    'Squeeze your shoulder blades at the top.',
  ],
  cable_row: [
    'Sit tall with a slight knee bend.',
    'Pull the handle to your stomach, squeezing your shoulder blades.',
    'Let the shoulders reach forward on the return without rounding your back.',
  ],
  face_pull: [
    'Set the rope at eye level or slightly above.',
    'Pull toward your face with your thumbs pointing back.',
    'Finish with arms in a "double biceps" position; use light weight.',
  ],
  band_pull_apart: [
    'Keep your arms straight at shoulder height.',
    'Pull the band to your chest by squeezing your shoulder blades.',
    'Don\'t shrug or arch your lower back.',
  ],
  straight_arm_pulldown: [
    'Keep your arms nearly straight with a slight elbow bend.',
    'Sweep the bar to your thighs using your lats.',
    'Hinge slightly at the hips; don\'t use your body to swing it.',
  ],
  lateral_raise: [
    'Lead with your elbows and raise to shoulder height.',
    'Use light weight with a slight forward lean.',
    'Lower slowly; don\'t swing or shrug.',
  ],
  cable_lateral_raise: [
    'Run the cable from a low pulley across your body.',
    'Raise to shoulder height leading with your elbow.',
    'Keep constant tension and avoid shrugging.',
  ],
  rear_delt_fly: [
    'Hinge forward with a flat back.',
    'Keep a slight elbow bend and sweep your arms out wide.',
    'Use light weight and squeeze at the top without shrugging.',
  ],
  barbell_curl: [
    'Pin your elbows to your sides.',
    'Curl without swinging your hips or back.',
    'An EZ bar can ease wrist and elbow strain.',
  ],
  db_curl: [
    'Turn your palms up as you curl.',
    'Use a full range of motion: full stretch at the bottom.',
    'No swinging; lower slowly.',
  ],
  hammer_curl: [
    'Keep a neutral (thumbs-up) grip throughout.',
    'Keep elbows still at your sides.',
    'Often tolerated better by irritated elbows.',
  ],
  triceps_pushdown: [
    'Pin your elbows to your sides.',
    'Fully extend your arms, then control the return.',
    'Don\'t lean over the stack to push more weight.',
  ],
  rope_pushdown: [
    'Spread the rope ends apart at the bottom.',
    'Keep your elbows still at your sides.',
    'The neutral grip is gentler on the elbows.',
  ],
  overhead_triceps_ext: [
    'Face away from the cable with your elbows by your head.',
    'Extend overhead without flaring your elbows wide.',
    'Brace your core so your lower back doesn\'t arch.',
  ],
  skull_crusher: [
    'Use an EZ bar and keep your elbows pointed up.',
    'Lower toward your forehead or just behind your head with control.',
    'Skip it if your elbows ache; use a rope pushdown instead.',
  ],
  dips: [
    'Lean slightly forward and keep your shoulders down.',
    'Descend until your upper arms are about parallel, no deeper.',
    'Stop if you feel pain at the front of your shoulder.',
  ],
  leg_curl: [
    'Line your knee up with the machine\'s pivot.',
    'Curl fully, then lower slowly.',
    'Keep your hips pressed into the pad.',
  ],
  leg_extension: [
    'Line your knee up with the machine\'s pivot.',
    'Extend fully and squeeze, then lower slowly.',
    'If your knees are sensitive, use a partial range or lighter load.',
  ],
  bulgarian_split_squat: [
    'Rest your rear foot on the bench and plant your front foot flat.',
    'Drop the back knee straight down.',
    'Keep your front knee tracking over your toes; hold onto something for balance if needed.',
  ],
  walking_lunge: [
    'Take a long stride and keep your torso upright.',
    'Let the back knee lightly touch the floor.',
    'Push through your front heel to step forward.',
  ],
  step_up: [
    'Use a knee-height box and plant your whole foot.',
    'Drive up through the top leg; minimise push from the back foot.',
    'Step down slowly with control.',
  ],
  glute_bridge: [
    'Bring your heels close to your glutes.',
    'Drive your hips up and squeeze your glutes at the top.',
    'Keep your ribs down; don\'t arch your lower back.',
  ],
  calf_raise: [
    'Get a full stretch at the bottom.',
    'Pause at the top and push through the big toe.',
    'Use slow tempo; no bouncing.',
  ],
  plank: [
    'Stack your forearms under your shoulders.',
    'Squeeze your glutes and keep your ribs down so your back stays flat.',
    'Breathe steadily; stop when your form breaks.',
  ],
  hanging_leg_raise: [
    'Start from a dead hang with shoulders engaged.',
    'Curl your pelvis up rather than just lifting your legs.',
    'Avoid swinging; bend your knees to make it easier.',
  ],
  cable_crunch: [
    'Kneel with the rope beside your head.',
    'Crunch your ribs toward your hips and round your spine.',
    'Keep your hips still; don\'t sit back to move the weight.',
  ],
  pallof_press: [
    'Stand side-on to the cable with feet shoulder width.',
    'Press straight out and resist the pull to rotate.',
    'Keep your hips and shoulders square.',
  ],
  dead_bug: [
    'Press your lower back flat into the floor.',
    'Extend opposite arm and leg slowly.',
    'Exhale as you extend; stop if your back arches.',
  ],
  ab_wheel: [
    'Start from your knees.',
    'Keep a hollow body as you roll out.',
    'Only go as far as you can without your back sagging.',
  ],
  wrist_flexor_stretch: [
    'Keep your arm straight with the palm facing up or out.',
    'Gently pull your fingers back toward you.',
    'Hold 30 seconds; it should feel like a gentle stretch, never pain.',
  ],
  wrist_extensor_stretch: [
    'Keep your arm straight with the palm down.',
    'Gently bend your wrist down with the other hand.',
    'Hold 30 seconds; it should feel like a gentle stretch, never pain.',
  ],
  eccentric_wrist_ext: [
    'Rest your forearm on your knee, palm down.',
    'Lift the weight with your other hand, then lower it over 3–5 s.',
    'Use a light weight; mild discomfort (≤3/10) is acceptable.',
  ],
  eccentric_wrist_flex: [
    'Rest your forearm on your knee, palm up.',
    'Lift with your other hand, then lower over 3–5 s.',
    'Use a light weight; mild discomfort (≤3/10) is acceptable.',
  ],
  doorway_pec_stretch: [
    'Place your forearm on the door frame with the elbow at shoulder height.',
    'Step through gently until you feel the stretch across your chest.',
    'Hold 30 seconds; stop if you feel tingling down the arm.',
  ],
  sleeper_stretch: [
    'Lie on your side with your arm at 90° in front of you.',
    'Gently press your forearm toward the floor.',
    'Keep it mild — this is a delicate shoulder stretch.',
  ],
  band_dislocate: [
    'Use a light band with a wide grip.',
    'Keep your arms straight and move slowly overhead and behind.',
    'Widen your grip if your shoulders pinch.',
  ],
  external_rotation: [
    'Pin your elbow to your side at 90°.',
    'Rotate your forearm outward slowly.',
    'Use light resistance and control the return.',
  ],
  thoracic_extension: [
    'Place the foam roller across your upper back, not your lower back.',
    'Support your head with your hands.',
    'Extend over the roller one segment at a time, breathing out.',
  ],
  cat_cow: [
    'Start on all fours with hands under shoulders.',
    'Alternate rounding and arching slowly.',
    'Match the movement to your breath.',
  ],
  couch_stretch: [
    'Put your back knee against a wall or couch.',
    'Squeeze the glute on the back leg and keep your torso tall.',
    'Pad the knee; ease in gradually.',
  ],
  pigeon_stretch: [
    'Bring your front shin across your body.',
    'Keep your hips square and sink down gently.',
    'Support yourself with your hands; never force your knee.',
  ],
  hamstring_stretch: [
    'Put your heel on a low step.',
    'Hinge forward from the hips with a flat back.',
    'Hold 30 seconds without bouncing.',
  ],
  worlds_greatest: [
    'Step into a lunge with your elbow to your instep.',
    'Rotate and reach toward the ceiling.',
    'Move slowly and do the same reps on each side.',
  ],
  ankle_dorsiflexion: [
    'Place your foot a few inches from the wall.',
    'Drive your knee forward over your toes.',
    'Keep your heel down; move your foot back as you improve.',
  ],
  spanish_squat: [
    'Loop a heavy band behind your knees, anchored in front of you.',
    'Sit back to vertical shins and hold.',
    'Keep pain at 3/10 or below.',
  ],
  mcgill_curl_up: [
    'Bend one knee and keep the other leg straight, hands under your lower back.',
    'Lift your head and shoulders slightly and hold 8–10 s.',
    'Don\'t flatten or flex your lower back.',
  ],
  bird_dog: [
    'Start on all fours with your spine neutral.',
    'Extend opposite arm and leg and hold, hips level.',
    'Move slowly and do the same reps on each side.',
  ],
  leg_swings: [
    'Hold onto something for balance and keep your torso tall.',
    'Start small and let the range grow each swing — don\'t kick or force it.',
    '10 swings front-to-back and 10 side-to-side per leg, 1–2 rounds.',
  ],
  arm_circles: [
    'Start with small circles and grow them to full range.',
    'Keep your ribs down and shoulders away from your ears.',
    '10 forward and 10 backward, 1–2 rounds.',
  ],
  hip_90_90: [
    'Sit tall; use your hands behind you for support if needed.',
    'Rotate both knees together to switch sides, slowly and under control.',
    '6 switches per side, 2 rounds — pause briefly in each position.',
  ],
  lat_stretch: [
    'Hold a post at about hip height and sit your hips back.',
    'Let your head drop between your arms and breathe into your side.',
    'Hold 30 s per side, 2 rounds — a gentle pull, never pain.',
  ],
  calf_stretch: [
    'Keep the back heel down and the back knee straight.',
    'Lean forward until you feel the calf; bend the knee slightly to target the lower calf.',
    'Hold 30 s per side, 2 rounds.',
  ],
  triceps_stretch: [
    'Reach your hand down between your shoulder blades.',
    'Gently press the elbow with your other hand; keep your ribs down.',
    'Hold 30 s per side, 2 rounds.',
  ],
  quad_stretch: [
    'Hold your ankle and keep your knees together.',
    'Squeeze the glute on the stretching side to deepen it at the hip.',
    'Hold 30 s per side, 2 rounds; hold a wall for balance.',
  ],
  cross_body_shoulder: [
    'Pull the arm across your chest at the elbow, not the wrist.',
    'Keep the shoulder down, away from your ear.',
    'Hold 30 s per side, 2 rounds.',
  ],
};

/** YouTube search for a form demonstration. Search links never go stale the way single video links can. */
export function videoUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${name} proper form`)}`;
}
