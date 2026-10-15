// Describing a training plan to the person it was built for: a compact summary for the
// coach, the swaps made for their joints/health profile, and a plain-language explanation
// used when the AI coach isn't writing one.

import { EXERCISE_MAP, type Joint } from './exercises.ts';
import { accessoryCount, generateProgram, type Profile, type Program } from './engine.ts';

const JOINT_WORDS: Record<Joint, string> = {
  elbow: 'elbows', shoulder: 'shoulders', wrist: 'wrists', knee: 'knees', lowBack: 'lower back', hip: 'hips',
};
const name = (id: string) => EXERCISE_MAP.get(id)?.name ?? id;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** One line per day: "A1 Squat & Bench: Back Squat (heavy 5×3+), Bench Press (volume 3×10), then Lat Pulldown, Leg Curl". */
export function describeProgram(program: Program): string {
  return program.days.map((d) => {
    const t1 = d.slots.find((s) => s.tier === 'T1');
    const t2 = d.slots.find((s) => s.tier === 'T2');
    const acc = d.slots.filter((s) => s.tier === 'T3').map((s) => name(s.exerciseId));
    return `${d.key} ${d.name}: ${t1 ? `${name(t1.exerciseId)} (heavy, 5×3)` : ''}`
      + `${t2 ? `, ${name(t2.exerciseId)} (volume, 3×10)` : ''}${acc.length ? `, then ${acc.join(', ')}` : ''}`;
  }).join('\n');
}

export interface Swap { day: string; from: string; to: string }

/** Where the plan differs from the standard one because of joints to protect or exercises to avoid. */
export function healthSwaps(profile: Profile, program: Program): Swap[] {
  const standard = generateProgram({ ...profile, limitations: [] });
  const out: Swap[] = [];
  const seen = new Set<string>();
  for (const day of program.days) {
    const base = standard.days.find((d) => d.key === day.key);
    for (const slot of day.slots) {
      const was = base?.slots.find((s) => s.id === slot.id)?.exerciseId;
      if (!was || was === slot.exerciseId) continue;
      const key = `${was}>${slot.exerciseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ day: day.key, from: name(was), to: name(slot.exerciseId) });
    }
  }
  return out;
}

/** A plain-language explanation built from rules, for when the AI coach isn't used. */
export function basicPlanExplanation(profile: Profile, program: Program): string {
  const goal = {
    strength: 'getting stronger',
    hypertrophy: 'building muscle',
    general: 'general fitness and strength',
  }[profile.goal];
  const n = profile.daysPerWeek;
  const rotation = n === 4 ? 'once a week'
    : n < 4 ? `about every ${Math.round((4 / n) * 7)} days`
    : `a bit more than once a week`;
  const acc = accessoryCount(profile);
  const swaps = healthSwaps(profile, program);
  const joints = profile.limitations.map((j) => JOINT_WORDS[j]);
  const lines = [
    '**Why this plan fits you**',
    `- **Your goal is ${goal}.** Every session starts with one heavy lift in low reps to build strength, then a lighter "volume" lift for muscle and technique${profile.goal === 'hypertrophy' ? ', and extra accessory work for size' : ''}.`,
    `- **${n} days a week.** The plan rotates through four sessions (A1, A2, B1, B2). Just do the next one each time you train, so you'll get through all four ${rotation} and train every big lift regularly without needing fixed days.`,
    `- **${profile.sessionMinutes} minutes a session.** That leaves room for the two main lifts plus ${acc} accessor${acc === 1 ? 'y' : 'ies'} for your back, legs and arms.`,
    profile.experience === 'beginner'
      ? '- **You\'re fairly new to lifting,** so weights start conservatively and go up a little every time you hit your reps. Expect quick progress in the first couple of months.'
      : '- **You have some training behind you,** so weights start from what you can do now and progress steadily. When a lift stalls, the reps change before the weight ever drops.',
  ];
  if (joints.length) {
    lines.push(`- **Going easy on your ${list(joints)}:** ${swaps.length
      ? `${list(swaps.map((s) => `${s.to} instead of ${s.from}`))}, which put less stress there.`
      : 'the exercises picked already keep stress there low.'} Mobility and rehab work for ${joints.length > 1 ? 'those joints' : 'that joint'} will be suggested as you go.`);
  } else if (swaps.length) {
    lines.push(`- **Based on your health profile:** ${list(swaps.map((s) => `${s.to} instead of ${s.from}`))}.`);
  }
  lines.push('- **It only uses equipment you have,** and you can swap any exercise or ask the coach to change things as you learn what suits you.');
  return lines.join('\n');
}
