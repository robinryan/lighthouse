// Onboarding in the user's own words: Claude reads what they wrote about their health, goals
// and past setbacks, turns it into profile settings and health notes, and later explains the
// plan that was built from it. Shared by the `coach` edge function and its tests.

import { EXERCISES, EXERCISE_MAP, JOINTS, type Equipment, type Joint } from './exercises.ts';
import { type UsageTotals, addUsage, costUsd, emptyUsage } from './pricing.ts';
import { type Db, loadProfile, loadProgram, must } from './queries.ts';
import { type CoachLimits, type CoachUsage, DEFAULT_LIMITS, DEFAULT_MODEL, type MessageRow, checkLimits, limitStats, requestOptionsFor } from './coach.ts';
import { describeProgram, healthSwaps } from './plan.ts';

export const MAX_INTAKE_CHARS = 2000;
const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'band'];

// ---------------------------------------------------------------------------
// Reading what the user wrote

const EXTRACT_SYSTEM = `You help set up Gym Bestie, a strength-training app. A new user has described themselves in their own words. Turn it into settings for their program. Only use what they actually said or clearly implied; use "unknown", 0 or an empty list for anything they didn't mention. Don't diagnose.

- goal: "strength" (getting stronger), "hypertrophy" (building muscle / size / physique), or "general" (health, fitness, weight loss, longevity, sport support).
- experience: "beginner" (under ~1 year of consistent lifting, or returning after a long break), "intermediate" (1–3 years), "advanced" (3+ years).
- days_per_week: 2–6, or 0 if not said. session_minutes: 45, 60, 75 or 90 (nearest), or 0 if not said.
- equipment: only if they describe where or how they train (e.g. "home gym with dumbbells and bands", "commercial gym" = barbell, dumbbell, cable, machine, pullup_bar, band). Empty list if not mentioned.
- joints: each joint they need to protect now or have a history of problems with. severity 1 = minor or old and settled, 2 = current but manageable, 3 = painful now or recent injury/surgery. note: a few words in their terms.
- avoid_exercises: catalog ids of exercises they say hurt, they were told to avoid, or that clearly conflict with what they described. Use ids from the catalog below only.
- other_notes: other things that matter for training (e.g. "desk job, tight hips", "returning after 2 years off", "training for a hike in June", "low energy from new baby"). Short phrases.
- summary: 1–2 friendly sentences to the user, starting "Here's what I took from that:", covering the key points you used.

Exercise catalog (id|name):
${EXERCISES.map((e) => `${e.id}|${e.name}`).join('\n')}`;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', enum: ['strength', 'hypertrophy', 'general', 'unknown'] },
    experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'unknown'] },
    days_per_week: { type: 'integer' },
    session_minutes: { type: 'integer' },
    equipment: { type: 'array', items: { type: 'string', enum: EQUIPMENT } },
    joints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { joint: { type: 'string', enum: JOINTS }, severity: { type: 'integer' }, note: { type: 'string' } },
        required: ['joint', 'severity', 'note'],
        additionalProperties: false,
      },
    },
    avoid_exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: { exercise_id: { type: 'string' }, note: { type: 'string' } },
        required: ['exercise_id', 'note'],
        additionalProperties: false,
      },
    },
    other_notes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['goal', 'experience', 'days_per_week', 'session_minutes', 'equipment', 'joints', 'avoid_exercises', 'other_notes', 'summary'],
  additionalProperties: false,
};

/** What we understood, ready to pre-fill onboarding. Missing values are left out. */
export interface IntakeResult {
  goal?: 'strength' | 'hypertrophy' | 'general';
  experience?: 'beginner' | 'intermediate' | 'advanced';
  daysPerWeek?: number;
  sessionMinutes?: number;
  equipment?: Equipment[];
  /** Joints to protect in the program (severity 2+). */
  limitations: Joint[];
  limitationNotes: string;
  /** Health-profile notes to save when the user confirms. */
  healthNotes: Array<{ kind: 'joint' | 'avoid' | 'note'; joint: Joint | null; exercise_id: string | null; severity: number; note: string }>;
  summary: string;
}

const clampInt = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

// deno-lint-ignore no-explicit-any
export function toIntakeResult(raw: any): IntakeResult {
  const out: IntakeResult = { limitations: [], limitationNotes: '', healthNotes: [], summary: String(raw?.summary ?? '').slice(0, 600) };
  if (['strength', 'hypertrophy', 'general'].includes(raw?.goal)) out.goal = raw.goal;
  if (['beginner', 'intermediate', 'advanced'].includes(raw?.experience)) out.experience = raw.experience;
  if (Number(raw?.days_per_week) > 0) out.daysPerWeek = clampInt(raw.days_per_week, 2, 6);
  if (Number(raw?.session_minutes) > 0) {
    const m = Number(raw.session_minutes);
    out.sessionMinutes = [45, 60, 75, 90].reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best), 60);
  }
  const eq = (Array.isArray(raw?.equipment) ? raw.equipment : []).filter((e: string) => (EQUIPMENT as string[]).includes(e));
  if (eq.length) out.equipment = [...new Set(eq)] as Equipment[];
  const notes: string[] = [];
  for (const j of Array.isArray(raw?.joints) ? raw.joints : []) {
    if (!(JOINTS as string[]).includes(j?.joint)) continue;
    const severity = clampInt(j.severity, 1, 3);
    const note = String(j.note ?? '').slice(0, 200);
    out.healthNotes.push({ kind: 'joint', joint: j.joint, exercise_id: null, severity, note });
    if (severity >= 2 && !out.limitations.includes(j.joint)) out.limitations.push(j.joint);
    if (note) notes.push(note);
  }
  for (const a of Array.isArray(raw?.avoid_exercises) ? raw.avoid_exercises : []) {
    if (!EXERCISE_MAP.has(a?.exercise_id)) continue;
    out.healthNotes.push({ kind: 'avoid', joint: null, exercise_id: a.exercise_id, severity: 2, note: String(a.note ?? '').slice(0, 200) });
  }
  for (const n of Array.isArray(raw?.other_notes) ? raw.other_notes.slice(0, 8) : []) {
    const note = String(n ?? '').trim().slice(0, 200);
    if (note) out.healthNotes.push({ kind: 'note', joint: null, exercise_id: null, severity: 1, note });
  }
  out.limitationNotes = notes.join('; ');
  return out;
}

interface IntakeOpts {
  db: Db; admin: Db; userId: string;
  // deno-lint-ignore no-explicit-any
  anthropic: any;
  model?: string; text: string; limits?: Partial<CoachLimits>;
}

function usageRecord(model: string, usage: UsageTotals, cost: number, budget: number, spent: number, kind: string): CoachUsage & { kind: string } {
  return { ...usage, model, effort: 'low', costUsd: cost, budgetUsd: budget, monthSpentUsd: Math.round((spent + cost) * 10_000) / 10_000, kind };
}

/** Read the user's description. Recorded as a hidden coach message so it counts toward limits and spending. */
export async function runIntakeExtract(opts: IntakeOpts): Promise<IntakeResult> {
  const { admin, userId, anthropic } = opts;
  const text = opts.text.trim().slice(0, MAX_INTAKE_CHARS);
  if (!text) throw new Error('Tell me a little about yourself first');
  const model = opts.model || DEFAULT_MODEL;
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const stats = await limitStats(admin, userId);
  checkLimits(stats, limits);

  const usage = emptyUsage();
  const msg = await anthropic.beta.messages.create({
    model,
    max_tokens: 4000,
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: `<about_me>\n${text}\n</about_me>` }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    ...requestOptionsFor(model).fallback,
  });
  addUsage(usage, msg.usage);
  const cost = costUsd(model, usage);
  must(await admin.from('coach_messages').insert({
    user_id: userId, workout_id: null, role: 'user', content: text, cost_usd: cost,
    usage: usageRecord(model, usage, cost, limits.budgetUsd, stats.user_month, 'intake_extract'),
  }));
  if (msg.stop_reason === 'refusal') throw new Error('I couldn\'t read that automatically. Please fill in the next steps yourself.');
  // deno-lint-ignore no-explicit-any
  const out = msg.content.find((b: any) => b.type === 'text')?.text;
  if (!out) throw new Error('I couldn\'t read that automatically. Please fill in the next steps yourself.');
  return toIntakeResult(JSON.parse(out));
}

// ---------------------------------------------------------------------------
// Explaining the plan

const EXPLAIN_SYSTEM = `You are the coach inside Gym Bestie, a strength-training app. A new user just told you about themselves and the app built them a program. Explain, in plain language, why this plan suits them.

How the app trains people: four sessions (A1, A2, B1, B2) done in rotation; each has a heavy main lift (5 sets of 3, last set as many reps as possible), a lighter volume main lift (3×10), then accessories. Weights rise each time they hit their reps; when a lift stalls the reps change before the weight drops. Exercises that stress joints they need to protect are swapped out. The coach can adjust anything later.

Write 150–250 words, warm and direct, no jargon (explain any term you must use). Use this shape, with bold labels:
**What I heard** — one or two sentences reflecting their situation back.
**Your plan** — what a week looks like for them.
**Why it fits you** — 3–5 bullets tying specific parts of the plan to specific things they said (goals, schedule, injuries, past setbacks, experience). Name the actual exercises.
**First few weeks** — what to expect and one practical tip.
Don't promise outcomes or diagnose. If they mention a serious or unclear medical issue, add one sentence suggesting they check with a doctor or physiotherapist. Only talk about their training plan.`;

/** Write the "why this plan fits you" message, stored as a coach reply after the user's own description. */
export async function runIntakeExplain(opts: IntakeOpts): Promise<MessageRow> {
  const { db, admin, userId, anthropic } = opts;
  const text = opts.text.trim().slice(0, MAX_INTAKE_CHARS);
  const model = opts.model || DEFAULT_MODEL;
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const stats = await limitStats(admin, userId);
  checkLimits(stats, limits);

  const [profile, stored, notes] = await Promise.all([
    loadProfile(db), loadProgram(db),
    db.from('health_notes').select('kind, joint, exercise_id, severity, note').then(must) as Promise<Array<{ kind: string; joint: string | null; exercise_id: string | null; severity: number; note: string }>>,
  ]);
  if (!stored) throw new Error('Build the program first');
  const swaps = healthSwaps(profile, stored.program);
  const context = [
    `Goal: ${profile.goal}. Experience: ${profile.experience}. ${profile.daysPerWeek} days a week, about ${profile.sessionMinutes} minutes a session. Units: ${profile.units}.`,
    `Equipment: ${profile.equipment.join(', ') || 'none listed'}. Joints to protect: ${profile.limitations.join(', ') || 'none'}${profile.limitationNotes ? ` (${profile.limitationNotes})` : ''}.`,
    notes.length ? `Health profile: ${notes.map((n) => `${n.kind}${n.joint ? ` ${n.joint}` : ''}${n.exercise_id ? ` ${EXERCISE_MAP.get(n.exercise_id)?.name ?? n.exercise_id}` : ''}${n.note ? `: ${n.note}` : ''}`).join('; ')}` : '',
    `Program:\n${describeProgram(stored.program)}`,
    swaps.length ? `Swapped for their joints/health: ${swaps.map((s) => `${s.to} instead of ${s.from}`).join('; ')}` : 'No exercises needed swapping.',
  ].filter(Boolean).join('\n');

  const usage = emptyUsage();
  const msg = await anthropic.beta.messages.create({
    model,
    max_tokens: 4000,
    system: EXPLAIN_SYSTEM,
    messages: [{ role: 'user', content: `<about_me>\n${text || '(They only picked options; no description.)'}\n</about_me>\n<plan>\n${context}\n</plan>` }],
    output_config: { effort: 'low' },
    ...requestOptionsFor(model).fallback,
  });
  addUsage(usage, msg.usage);
  const cost = costUsd(model, usage);
  // deno-lint-ignore no-explicit-any
  const reply = msg.stop_reason === 'refusal' ? '' : msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  if (!reply) throw new Error('The coach couldn\'t write an explanation this time.');
  if (text) must(await admin.from('coach_messages').insert({ user_id: userId, workout_id: null, role: 'user', content: text }));
  return must(await admin.from('coach_messages').insert({
    user_id: userId, workout_id: null, role: 'assistant', content: reply, cost_usd: cost,
    usage: usageRecord(model, usage, cost, limits.budgetUsd, stats.user_month, 'plan'),
  }).select('*').single()) as MessageRow;
}
