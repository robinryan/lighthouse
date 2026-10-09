// AI coach core, shared by the `coach` edge function and its tests.
// Claude gets web search plus tools that *propose* changes; nothing is applied
// until the user taps "Apply" in the app.
//
// `db` is a supabase-js client authenticated as the user (row level security
// applies), and `anthropic` is an Anthropic SDK client.

import { EXERCISES, EXERCISE_MAP, JOINTS, type Equipment, type Joint, hasEquipment } from './exercises.ts';
import { type UsageTotals, addUsage, costUsd, emptyUsage } from './pricing.ts';
import { type Db, type LoadedWorkout, loadProfile, loadProgram, loadWorkout, must } from './queries.ts';
import { type HealthNote, describeHealth, describeSkip, parseSkip, summarizeHealth } from './health.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_HISTORY = 10;
const MAX_ITERATIONS = 6;
const RECENT_SESSIONS = 3;
/** Default monthly spending cap per user (USD); override with the COACH_MONTHLY_BUDGET_USD secret. 0 = no cap. */
export const DEFAULT_MONTHLY_BUDGET_USD = 10;

/** Sources the coach may search. Keeps results reputable and short. */
export const SEARCH_DOMAINS = [
  'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'bjsm.bmj.com', 'journals.lww.com', 'jospt.org',
  'physio-pedia.com', 'orthoinfo.aaos.org', 'mayoclinic.org', 'nhs.uk', 'acsm.org', 'nsca.com',
  'strongerbyscience.com', 'barbellmedicine.com', 'e3rehab.com', 'theprehabguys.com', 'squatuniversity.com',
];

// ---------------------------------------------------------------------------
// Prompt

/** Compact catalog of exercises the user can actually do with their equipment. */
function catalogFor(equipment: Equipment[]): string {
  return EXERCISES.filter((e) => hasEquipment(e, equipment))
    .map((e) => `${e.id}|${e.name}|${e.muscles.join(',')}|${e.stress.join(',') || '-'}${e.category === 'mobility' ? '|mobility' : ''}`)
    .join('\n');
}

/**
 * The system prompt. It only changes when the user's equipment changes, so it stays
 * cached across messages.
 */
export function buildSystem(equipment: Equipment[]): string {
  return `You are the coach inside Lighthouse, a strength-training app. The user is usually mid-workout on their phone, so be brief and practical: lead with the answer, use short bullet points, and skip preamble.

How the app trains people:
- Each day has two main lifts — a heavy T1 lift (e.g. 5×3+, last set as many reps as possible) and a volume T2 lift (e.g. 3×10) — then T3 accessories using double progression (add reps within a range, then add weight).
- Rotation: A1 Squat T1 + Bench T2, A2 OHP T1 + Deadlift T2, B1 Bench T1 + Squat T2, B2 Deadlift T1 + OHP T2.
- Workouts also include mobility/stretch items placed before a lift (dynamic prep, short holds) or at the end as a cool-down (longer static holds). Each has an importance rating out of 10.
- Missed T1/T2 sessions move a lift to the next rep stage at the same weight (5×3 → 6×2 → 10×1); failing the last stage resets the weight lower.

Your job:
- Answer training questions using evidence-based practice. Answer from your own knowledge by default; use web search only when the user asks you to research something, or a question genuinely needs specific or recent evidence you aren't sure of (e.g. a particular injury or study). One or two searches is plenty. Prefer reputable sources (peer-reviewed research, physiotherapy/sports-medicine organizations, established coaches). Do not invent citations.
- When something hurts: ask at most one clarifying question only if truly needed; otherwise suggest pain-free alternatives from the catalog, load reductions, and relevant mobility or rehab work. Use the propose_* tools so the user can apply your suggestions with one tap. Prefer keeping the movement pattern and training effect while removing the painful position (e.g. neutral grip, reduced range, machine or dumbbell versions).
- Safety: you are not a medical professional. If the user describes sharp or sudden pain, a pop, swelling, numbness or tingling, pain that persists at rest or at night, or chest pain/dizziness, tell them to stop the exercise and see a doctor or physiotherapist. Never encourage training through sharp pain. Mild, familiar discomfort that stays at or below about 3/10 and settles within 24 hours is generally acceptable to train around.
- Only recommend exercises by catalog id via the tools; you may mention others in text but tools must use catalog ids.
- Use propose_program_change only when a change should stick across future sessions (e.g. a recurring problem). Use propose_swap with scope "today" for one-off issues.
- Use propose_limitations when the user reveals an ongoing joint issue so future programs avoid aggravating it.
- Health profile: whenever the user tells you something lasting about their body or preferences (a sore or injured joint, an exercise that hurts, one that feels great, one they dislike, relevant history like surgery or a desk job), call record_health_note right away — it saves immediately and the user can undo it. Don't record trivia or repeat what's already in the profile. Respect the profile in every recommendation: never suggest exercises listed under "Avoid", and favour ones that are easy on sensitive joints.
- When the user skipped an exercise or sets (shown in context with the reason), take that reason into account.
- Weights are in the user's units. Never claim you changed anything — you propose; the user applies.

Exercise catalog — only exercises the user has equipment for (id|name|muscles|joints it stresses):
${catalogFor(equipment)}`;
}

// Exercise ids are plain strings (validated server-side) — listing all ids as enums would triple the prompt size.
const exerciseId = { type: 'string', description: 'Catalog exercise id.' } as const;

export const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 2, allowed_domains: SEARCH_DOMAINS },
  {
    name: 'propose_swap',
    description: 'Propose replacing an exercise in the current workout with another catalog exercise. The user sees an Apply button.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        workout_exercise_id: { type: 'integer', description: 'The id of the exercise row in the current workout (from context).' },
        new_exercise_id: exerciseId,
        scope: { type: 'string', enum: ['today', 'program'], description: '"today" for this session only, "program" to also change future sessions.' },
        reason: { type: 'string', description: 'One short sentence shown to the user.' },
      },
      required: ['workout_exercise_id', 'new_exercise_id', 'scope', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_load_change',
    description: 'Propose changing the target weight of the remaining sets of an exercise in the current workout by a percentage (-60 to +20).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        workout_exercise_id: { type: 'integer' },
        percent_change: { type: 'integer', description: 'e.g. -20 for 20% lighter.' },
        reason: { type: 'string' },
      },
      required: ['workout_exercise_id', 'percent_change', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_add_exercise',
    description: 'Propose adding a catalog exercise (stretch, mobility drill, rehab or accessory) to the current workout. For time-based holds, reps means seconds.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        exercise_id: exerciseId,
        sets: { type: 'integer' },
        reps: { type: 'integer' },
        rest_seconds: { type: 'integer' },
        note: { type: 'string', description: 'How to do it / why, one or two sentences.' },
      },
      required: ['exercise_id', 'sets', 'reps', 'rest_seconds', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_program_change',
    description: 'Propose permanently changing which exercise fills a slot in the user\'s program (slot ids are in context).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        slot_id: { type: 'string' },
        new_exercise_id: exerciseId,
        reason: { type: 'string' },
      },
      required: ['slot_id', 'new_exercise_id', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_limitations',
    description: 'Propose updating the joints the user needs to protect. Future programs avoid exercises that stress these joints.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        add: { type: 'array', items: { type: 'string', enum: JOINTS } },
        remove: { type: 'array', items: { type: 'string', enum: JOINTS } },
        note: { type: 'string', description: 'Short note to save on the profile, e.g. "Right elbow: outer-elbow pain on pressing (Oct 2026)". Empty string for none.' },
      },
      required: ['add', 'remove', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_health_note',
    description: 'Save an observation to the user\'s health profile immediately (the user can undo). Use for lasting information: a sensitive joint, an exercise to avoid or that works well, one they dislike, or relevant health context.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['joint', 'avoid', 'prefer', 'dislike', 'note'] },
        joint: { type: 'string', enum: ['', ...JOINTS], description: 'For kind=joint: which joint. Empty string otherwise.' },
        exercise_id: { type: 'string', description: 'For avoid/prefer/dislike: the catalog exercise id. Empty string otherwise.' },
        severity: { type: 'integer', description: '1 = mild, 2 = moderate, 3 = severe/injury.' },
        note: { type: 'string', description: 'One short sentence in the user\'s terms, e.g. "Outer right elbow aches on straight-bar pressing".' },
        expires_in_days: { type: 'integer', description: 'How long this is likely relevant: e.g. 14 for a minor tweak, 0 for permanent/ongoing.' },
      },
      required: ['kind', 'joint', 'exercise_id', 'severity', 'note', 'expires_in_days'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Context

type SetLike = { kind: string; target_reps: number | null; target_weight: number | null; actual_reps: number | null; actual_weight: number | null; done: boolean; amrap: boolean; skipped?: boolean };

function fmtSet(s: SetLike) {
  const w = s.kind === 'warmup' ? 'w ' : '';
  if (s.skipped) return `${w}skipped`;
  if (s.done) return `${w}${s.actual_weight ?? 'BW'}×${s.actual_reps} ✓`;
  return `${w}${s.target_weight ?? 'BW'}×${s.target_reps ?? '?'}${s.amrap ? '+' : ''} (not done)`;
}

function exName(id: string) { return EXERCISE_MAP.get(id)?.name ?? id; }

export async function buildContext(db: Db, workout: LoadedWorkout | null, today: string): Promise<string> {
  const p = await loadProfile(db);
  const sp = await loadProgram(db);
  const lines: string[] = [`Today: ${today}`];
  lines.push(`Profile: goal=${p.goal}, experience=${p.experience}, units=${p.units}, ${p.daysPerWeek} days/week, ~${p.sessionMinutes} min sessions, bodyweight=${p.bodyweight ?? 'unknown'}`);
  lines.push(`Equipment: ${p.equipment.join(', ') || 'none listed'}`);
  lines.push(`Protected joints: ${p.limitations.join(', ') || 'none'}${p.limitationNotes ? ` — notes: ${p.limitationNotes}` : ''}`);
  if (sp) {
    lines.push('', 'Program (slot_id: exercise):');
    sp.program.days.forEach((d, i) => {
      lines.push(`Day ${i + 1} ${d.key} "${d.name}"${i === sp.nextDay ? ' (next up)' : ''}: ` +
        d.slots.map((s) => `${s.id} [${s.tier}] ${s.exerciseId}`).join('; '));
    });
  }
  const healthNotes = must(await db.from('health_notes').select('*').order('created_at', { ascending: false }).limit(200)) as HealthNote[];
  const health = describeHealth(summarizeHealth(healthNotes, p.limitations));
  lines.push('', 'Health profile:', ...(health.length ? health : ['(nothing recorded yet)']));
  if (workout) {
    const w = workout.workout;
    lines.push('', `Current workout (${w.status}): "${w.title}" on ${w.date}`);
    for (const e of workout.exercises) {
      const skip = parseSkip(e.skip_reason);
      if (e.skipped) {
        lines.push(`- workout_exercise_id=${e.id} ${exName(e.exercise_id)} (${e.exercise_id}) SKIPPED${skip ? `: ${describeSkip(skip)}` : ''}`);
        continue;
      }
      const role = e.stretch_when && e.stretch_for ? `stretch ${e.stretch_when} ${exName(e.stretch_for)}, ` : '';
      lines.push(`- workout_exercise_id=${e.id} ${exName(e.exercise_id)} (${e.exercise_id}) [${role}${e.tier} ${e.scheme_label}]: ` +
        e.sets.map(fmtSet).join(', ') + (e.notes ? ` — note: ${e.notes}` : ''));
      const skippedSets = e.sets.filter((x) => x.skipped);
      if (skippedSets.length) {
        const why = parseSkip(skippedSets[skippedSets.length - 1].skip_reason);
        lines.push(`  (${skippedSets.length} set(s) skipped${why ? `: ${describeSkip(why)}` : ''})`);
      }
    }
    if (w.notes) lines.push(`Workout notes: ${w.notes}`);
  }
  const recent = must(await db.from('workouts').select('id').eq('status', 'completed')
    .order('date', { ascending: false }).order('id', { ascending: false }).limit(RECENT_SESSIONS)) as Array<{ id: number }>;
  if (recent.length) {
    lines.push('', 'Recent sessions (top working sets):');
    for (const r of recent) {
      const { workout: w, exercises } = await loadWorkout(db, r.id);
      const parts = exercises.map((e) => {
        const done = e.sets.filter((s) => s.done && s.kind === 'working');
        if (!done.length) return null;
        return `${exName(e.exercise_id)} ${done.map((s) => `${s.actual_weight ?? 'BW'}×${s.actual_reps}`).join(',')}${e.notes ? ` ("${e.notes}")` : ''}`;
      }).filter(Boolean);
      lines.push(`- ${w.date} ${w.title}: ${parts.join('; ')}${w.notes ? ` | notes: ${w.notes}` : ''}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Actions (proposals)

type ActionStatus = 'pending' | 'applied' | 'dismissed';
export type CoachAction =
  | { type: 'swap'; workoutExerciseId: number; exerciseId: string; scope: 'today' | 'program'; reason: string; label: string; status: ActionStatus }
  | { type: 'load'; workoutExerciseId: number; percent: number; reason: string; label: string; status: ActionStatus }
  | { type: 'add'; workoutId: number; exerciseId: string; sets: number; reps: number; restSeconds: number; note: string; label: string; status: ActionStatus }
  | { type: 'program'; slotId: string; exerciseId: string; reason: string; label: string; status: ActionStatus }
  | { type: 'limitations'; add: Joint[]; remove: Joint[]; note: string; label: string; status: ActionStatus }
  /** Already saved when created; "dismissing" it undoes the save. */
  | { type: 'health'; noteId: number; label: string; note: string; status: ActionStatus };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)));

/** Validate a tool call and turn it into a pending action. Throws (→ tool error) on invalid input. */
export async function toAction(db: Db, workout: LoadedWorkout | null, name: string, input: Record<string, unknown>): Promise<CoachAction> {
  const str = (k: string) => String(input[k] ?? '');
  const num = (k: string) => Number(input[k]);
  const needExercise = (id: string) => { if (!EXERCISE_MAP.has(id)) throw new Error(`Unknown exercise id ${id}`); return id; };
  const needWex = (id: number) => {
    const we = workout?.workout.status === 'in_progress' ? workout.exercises.find((e) => e.id === id) : undefined;
    if (!we) throw new Error('That exercise is not in the current in-progress workout');
    return { id, name: exName(we.exercise_id) };
  };
  switch (name) {
    case 'propose_swap': {
      const we = needWex(num('workout_exercise_id'));
      const to = needExercise(str('new_exercise_id'));
      const scope = str('scope') === 'program' ? 'program' : 'today';
      return { type: 'swap', workoutExerciseId: we.id, exerciseId: to, scope, reason: str('reason'), status: 'pending',
        label: `Swap ${we.name} → ${exName(to)}${scope === 'program' ? ' (keep in program)' : ' (today)'}` };
    }
    case 'propose_load_change': {
      const we = needWex(num('workout_exercise_id'));
      const pct = clamp(num('percent_change'), -60, 20);
      return { type: 'load', workoutExerciseId: we.id, percent: pct, reason: str('reason'), status: 'pending',
        label: `${pct < 0 ? 'Lighten' : 'Increase'} ${we.name} by ${Math.abs(pct)}%` };
    }
    case 'propose_add_exercise': {
      if (!workout || workout.workout.status !== 'in_progress') throw new Error('No workout in progress — describe the exercise in text instead');
      const id = needExercise(str('exercise_id'));
      const sets = clamp(num('sets'), 1, 6);
      const reps = clamp(num('reps'), 1, 120);
      const unit = EXERCISE_MAP.get(id)!.loadType === 'time' ? 's' : '';
      return { type: 'add', workoutId: workout.workout.id, exerciseId: id, sets, reps, restSeconds: clamp(num('rest_seconds'), 0, 300),
        note: str('note'), status: 'pending', label: `Add ${exName(id)} ${sets}×${reps}${unit}` };
    }
    case 'propose_program_change': {
      const sp = await loadProgram(db);
      const slot = sp?.program.days.flatMap((d) => d.slots).find((s) => s.id === str('slot_id'));
      if (!slot) throw new Error(`Unknown slot_id ${str('slot_id')}`);
      const to = needExercise(str('new_exercise_id'));
      return { type: 'program', slotId: slot.id, exerciseId: to, reason: str('reason'), status: 'pending',
        label: `Program: ${exName(slot.exerciseId)} → ${exName(to)}` };
    }
    case 'propose_limitations': {
      const valid = (v: unknown) => (Array.isArray(v) ? v.filter((j): j is Joint => JOINTS.includes(j as Joint)) : []);
      const add = valid(input.add);
      const remove = valid(input.remove);
      const parts = [add.length ? `protect ${add.join(', ')}` : '', remove.length ? `stop protecting ${remove.join(', ')}` : '']
        .filter(Boolean).join('; ');
      return { type: 'limitations', add, remove, note: str('note'), status: 'pending', label: `Profile: ${parts || 'save injury note'}` };
    }
    case 'record_health_note': {
      const kind = str('kind') as HealthNote['kind'];
      if (!['joint', 'avoid', 'prefer', 'dislike', 'note'].includes(kind)) throw new Error('Invalid kind');
      const joint = str('joint') as Joint | '';
      const exerciseId = str('exercise_id');
      if (kind === 'joint' && !JOINTS.includes(joint as Joint)) throw new Error('kind=joint needs a joint');
      if (['avoid', 'prefer', 'dislike'].includes(kind)) needExercise(exerciseId);
      const days = clamp(num('expires_in_days'), 0, 365);
      const note = str('note').slice(0, 300);
      const row = must(await db.from('health_notes').insert({
        kind, joint: kind === 'joint' ? joint : null, exercise_id: exerciseId || null,
        severity: clamp(num('severity'), 1, 3), note, source: 'coach', workout_id: workout?.workout.id ?? null,
        expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      }).select('id').single()) as { id: number };
      const what = kind === 'joint' ? `sensitive ${joint}` : kind === 'note' ? 'note'
        : `${kind === 'avoid' ? 'avoid' : kind === 'prefer' ? 'works well' : 'dislikes'}: ${exName(exerciseId)}`;
      return { type: 'health', noteId: row.id, note, status: 'applied', label: `Saved to health profile — ${what}` };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Conversation

export interface CoachUsage extends UsageTotals { model: string; effort: 'low' | 'medium'; costUsd: number; budgetUsd: number; monthSpentUsd: number }

export interface MessageRow {
  id: number; workout_id: number | null; role: 'user' | 'assistant'; content: string;
  actions: CoachAction[]; sources: Array<{ url: string; title: string }>; created_at: string;
  usage: CoachUsage | null; cost_usd: number | null;
}

export class BudgetExceededError extends Error {
  constructor(public spent: number, public budget: number) {
    super(`You've used your AI coach budget for this month ($${spent.toFixed(2)} of $${budget.toFixed(2)}). It resets on the 1st.`);
  }
}

/** Questions about pain or injury, or explicit research requests, get deeper thinking; everything else is quick. */
const NEEDS_DEPTH = /\b(pain|hurt|hurts|injur|sore|ache|aching|tweak|strain|sprain|numb|tingl|swell|swollen|pop(ped)?|doctor|physio|surgery|tendon|tendin|research|study|studies|evidence)/i;
export function chooseEffort(text: string, research: boolean): 'low' | 'medium' {
  return research || NEEDS_DEPTH.test(text) ? 'medium' : 'low';
}

/** What this user has spent on the coach since the start of the month (UTC). */
export async function monthSpend(db: Db, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = must(await db.from('coach_messages').select('cost_usd').eq('role', 'assistant').gte('created_at', start)) as Array<{ cost_usd: number | null }>;
  return rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
}

// deno-lint-ignore no-explicit-any
type AnthropicLike = any;

/**
 * Answer one user message: stores the user's message and the coach's reply (with any
 * proposed actions) in coach_messages, and returns the reply row.
 */
export async function runCoach(opts: {
  db: Db; anthropic: AnthropicLike; model?: string; workoutId: number | null; text: string; today?: string;
  /** The user tapped "Research": search the web and think harder. */
  research?: boolean;
  /** Monthly cap in USD (0 = none). */
  budgetUsd?: number;
}): Promise<MessageRow> {
  const { db, anthropic, workoutId, text } = opts;
  const model = opts.model || DEFAULT_MODEL;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const budget = opts.budgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD;
  const spent = await monthSpend(db);
  if (budget > 0 && spent >= budget) throw new BudgetExceededError(spent, budget);
  const effort = chooseEffort(text, !!opts.research);
  const profile = await loadProfile(db);
  const system = buildSystem(profile.equipment);

  // In-workout chats act on that workout; the general chat can act on whatever workout is in progress.
  let targetId = workoutId;
  if (targetId == null) {
    const active = must(await db.from('workouts').select('id').eq('status', 'in_progress')
      .order('id', { ascending: false }).limit(1)) as Array<{ id: number }>;
    targetId = active[0]?.id ?? null;
  }
  const workout = targetId != null ? await loadWorkout(db, targetId) : null;

  let historyQuery = db.from('coach_messages').select('role, content').order('id', { ascending: false }).limit(MAX_HISTORY);
  historyQuery = workoutId == null ? historyQuery.is('workout_id', null) : historyQuery.eq('workout_id', workoutId);
  const history = (must(await historyQuery) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();

  // deno-lint-ignore no-explicit-any
  const messages: any[] = history.map((m) => ({ role: m.role, content: m.content || '(no text)' }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `<context>\n${await buildContext(db, workout, today)}\n</context>` },
      { type: 'text', text: opts.research ? `${text}\n\n(Research requested: please search for supporting evidence.)` : text },
    ],
  });

  must(await db.from('coach_messages').insert({ workout_id: workoutId, role: 'user', content: text }));

  const actions: CoachAction[] = [];
  const texts: string[] = [];
  const sources = new Map<string, string>();
  const usage = emptyUsage();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const msg = await anthropic.beta.messages.stream({
      model,
      max_tokens: 8000,
      // Breakpoint 1: tools + system (stable per user). Top-level cache_control adds a moving
      // breakpoint at the end of the conversation, so tool-call rounds and follow-ups reuse it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      tools: TOOLS,
      messages,
      output_config: { effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }).finalMessage();
    addUsage(usage, msg.usage);

    if (msg.stop_reason === 'refusal') {
      texts.push('Sorry — I can\'t help with that request.');
      break;
    }
    let turnText = '';
    for (const block of msg.content) {
      if (block.type !== 'text') continue;
      turnText += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location') sources.set(c.url, c.title ?? c.url);
      }
    }
    if (turnText.trim()) texts.push(turnText.trim());
    messages.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'pause_turn') continue;
    if (msg.stop_reason !== 'tool_use') break;

    const results = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const action = await toAction(db, workout, block.name, block.input as Record<string, unknown>);
        actions.push(action);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: action.type === 'health'
          ? 'Saved to the health profile (the user can undo).'
          : `Shown to the user as a button: "${action.label}". Not applied yet.` });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: (err as Error).message });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  const content = texts.join('\n\n').trim() || (actions.length ? 'Here are some changes you can apply:' : 'I don\'t have a suggestion for that.');
  const cost = costUsd(model, usage);
  const record: CoachUsage = { ...usage, model, effort, costUsd: cost, budgetUsd: budget, monthSpentUsd: Math.round((spent + cost) * 10_000) / 10_000 };
  return must(await db.from('coach_messages').insert({
    workout_id: workoutId, role: 'assistant', content, actions,
    sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
    usage: record, cost_usd: cost,
  }).select('*').single()) as MessageRow;
}
