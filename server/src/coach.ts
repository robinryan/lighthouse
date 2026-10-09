// AI coach: Claude with web search plus tools that *propose* changes. Nothing
// the model suggests is applied until the user taps "Apply" in the app.

import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { EXERCISES, EXERCISE_IDS, EXERCISE_MAP, JOINTS, type Joint } from './exercises.js';
import {
  HttpError, activeWorkoutId, addExerciseToWorkout, adjustLoad, getProfile, getProgram, getWorkout,
  ownedWex, ownedWorkout, saveProfile, setSlotExercise, swapExercise,
} from './training.js';

const MODEL = process.env.COACH_MODEL ?? 'claude-opus-5-5';
const MAX_HISTORY = 20;
const MAX_ITERATIONS = 8;

export function coachEnabled(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// ---------------------------------------------------------------------------
// Prompt

const CATALOG = EXERCISES.map((e) =>
  `${e.id} | ${e.name} | ${e.category} | ${e.equipment.join('+')} | ${e.muscles.join(',')} | stresses: ${e.stress.join(',') || 'none'}`,
).join('\n');

const SYSTEM = `You are the coach inside Lighthouse, a strength-training app. The user is usually mid-workout on their phone, so be brief and practical: lead with the answer, use short bullet points, and skip preamble.

How the app trains people:
- Each day has two main lifts — a heavy T1 lift (e.g. 5×3+, last set as many reps as possible) and a volume T2 lift (e.g. 3×10) — then T3 accessories using double progression (add reps within a range, then add weight).
- Rotation: A1 Squat T1 + Bench T2, A2 OHP T1 + Deadlift T2, B1 Bench T1 + Squat T2, B2 Deadlift T1 + OHP T2.
- Missed T1/T2 sessions move a lift to the next rep stage at the same weight (5×3 → 6×2 → 10×1); failing the last stage resets the weight lower.

Your job:
- Answer training questions using evidence-based practice. When a question needs current or specific evidence (injury management, technique research, programming studies), use web search and prefer reputable sources (peer-reviewed research, physiotherapy/sports-medicine organizations, established coaches). Do not invent citations.
- When something hurts: ask at most one clarifying question only if truly needed; otherwise suggest pain-free alternatives from the catalog, load reductions, and relevant mobility or rehab work. Use the propose_* tools so the user can apply your suggestions with one tap. Prefer keeping the movement pattern and training effect while removing the painful position (e.g. neutral grip, reduced range, machine or dumbbell versions).
- Safety: you are not a medical professional. If the user describes sharp or sudden pain, a pop, swelling, numbness or tingling, pain that persists at rest or at night, or chest pain/dizziness, tell them to stop the exercise and see a doctor or physiotherapist. Never encourage training through sharp pain. Mild, familiar discomfort that stays at or below about 3/10 and settles within 24 hours is generally acceptable to train around.
- Only recommend exercises by catalog id via the tools; you may mention others in text but tools must use catalog ids.
- Use propose_program_change only when a change should stick across future sessions (e.g. a recurring problem). Use propose_swap with scope "today" for one-off issues.
- Use propose_limitations when the user reveals an ongoing joint issue so future programs avoid aggravating it.
- Weights are in the user's units. Never claim you changed anything — you propose; the user applies.

Exercise catalog (id | name | category | equipment | muscles | joints it stresses):
${CATALOG}`;

const exerciseEnum = { type: 'string', enum: EXERCISE_IDS } as const;

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  {
    name: 'propose_swap',
    description: 'Propose replacing an exercise in the current workout with another catalog exercise. The user sees an Apply button.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        workout_exercise_id: { type: 'integer', description: 'The id of the exercise row in the current workout (from context).' },
        new_exercise_id: exerciseEnum,
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
        exercise_id: exerciseEnum,
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
        new_exercise_id: exerciseEnum,
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
];

// ---------------------------------------------------------------------------
// Context

function fmtSet(s: { kind: string; targetReps: number | null; targetWeight: number | null; actualReps: number | null; actualWeight: number | null; done: boolean; amrap: boolean }) {
  const target = `${s.targetWeight ?? 'BW'}×${s.targetReps ?? '?'}${s.amrap ? '+' : ''}`;
  return s.done ? `${s.kind === 'warmup' ? 'w ' : ''}${s.actualWeight ?? 'BW'}×${s.actualReps} ✓` : `${s.kind === 'warmup' ? 'w ' : ''}${target} (not done)`;
}

function buildContext(userId: number, workoutId: number | null): string {
  const p = getProfile(userId);
  const sp = getProgram(userId);
  const today = new Date().toISOString().slice(0, 10);
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
  if (workoutId) {
    const w = getWorkout(userId, workoutId);
    lines.push('', `Current workout (${w.status}): "${w.title}" on ${w.date}`);
    for (const e of w.exercises) {
      lines.push(`- workout_exercise_id=${e.id} ${e.name} (${e.exerciseId}) [${e.tier} ${e.schemeLabel}]: ` +
        e.sets.map(fmtSet).join(', ') + (e.notes ? ` — note: ${e.notes}` : ''));
    }
    if (w.notes) lines.push(`Workout notes: ${w.notes}`);
  }
  const recent = db.prepare(`SELECT id FROM workouts WHERE user_id = ? AND status = 'completed' ORDER BY date DESC, id DESC LIMIT 6`)
    .all(userId) as Array<{ id: number }>;
  if (recent.length) {
    lines.push('', 'Recent sessions (top working sets):');
    for (const r of recent) {
      const w = getWorkout(userId, r.id);
      const parts = w.exercises.map((e) => {
        const done = e.sets.filter((s) => s.done && s.kind === 'working');
        if (!done.length) return null;
        return `${e.name} ${done.map((s) => `${s.actualWeight ?? 'BW'}×${s.actualReps}`).join(',')}${e.notes ? ` ("${e.notes}")` : ''}`;
      }).filter(Boolean);
      lines.push(`- ${w.date} ${w.title}: ${parts.join('; ')}${w.notes ? ` | notes: ${w.notes}` : ''}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Actions

export type CoachAction =
  | { type: 'swap'; workoutExerciseId: number; exerciseId: string; scope: 'today' | 'program'; reason: string; label: string; status: ActionStatus }
  | { type: 'load'; workoutExerciseId: number; percent: number; reason: string; label: string; status: ActionStatus }
  | { type: 'add'; workoutId: number; exerciseId: string; sets: number; reps: number; restSeconds: number; note: string; label: string; status: ActionStatus }
  | { type: 'program'; slotId: string; exerciseId: string; reason: string; label: string; status: ActionStatus }
  | { type: 'limitations'; add: Joint[]; remove: Joint[]; note: string; label: string; status: ActionStatus };
type ActionStatus = 'pending' | 'applied' | 'dismissed';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const exName = (id: string) => EXERCISE_MAP.get(id)?.name ?? id;

/** Validate a tool call and turn it into a pending action. Throws on invalid input. */
function toAction(userId: number, workoutId: number | null, name: string, input: Record<string, unknown>): CoachAction {
  const str = (k: string) => String(input[k] ?? '');
  const num = (k: string) => Number(input[k]);
  const needExercise = (id: string) => { if (!EXERCISE_MAP.has(id)) throw new Error(`Unknown exercise id ${id}`); return id; };
  const needWex = (id: number) => {
    const we = ownedWex(userId, id);
    if (we.workout_id !== workoutId || we.status !== 'in_progress') throw new Error('That exercise is not in the current in-progress workout');
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
      if (!workoutId) throw new Error('No workout in progress — describe the exercise in text instead');
      ownedWorkout(userId, workoutId);
      const id = needExercise(str('exercise_id'));
      const sets = clamp(num('sets'), 1, 6);
      const reps = clamp(num('reps'), 1, 120);
      const unit = EXERCISE_MAP.get(id)!.loadType === 'time' ? 's' : '';
      return { type: 'add', workoutId, exerciseId: id, sets, reps, restSeconds: clamp(num('rest_seconds'), 0, 300),
        note: str('note'), status: 'pending', label: `Add ${exName(id)} ${sets}×${reps}${unit}` };
    }
    case 'propose_program_change': {
      const sp = getProgram(userId);
      const slot = sp?.program.days.flatMap((d) => d.slots).find((s) => s.id === str('slot_id'));
      if (!slot) throw new Error(`Unknown slot_id ${str('slot_id')}`);
      const to = needExercise(str('new_exercise_id'));
      return { type: 'program', slotId: slot.id, exerciseId: to, reason: str('reason'), status: 'pending',
        label: `Program: ${exName(slot.exerciseId)} → ${exName(to)}` };
    }
    case 'propose_limitations': {
      const valid = (v: unknown) => (Array.isArray(v) ? v.filter((j): j is Joint => JOINTS.includes(j as Joint)) : []);
      const add = valid(input.add); const remove = valid(input.remove);
      const parts = [add.length ? `protect ${add.join(', ')}` : '', remove.length ? `stop protecting ${remove.join(', ')}` : '']
        .filter(Boolean).join('; ');
      return { type: 'limitations', add, remove, note: str('note'), status: 'pending', label: `Profile: ${parts || 'save injury note'}` };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export function applyAction(userId: number, messageId: number, index: number, dismiss: boolean) {
  const row = db.prepare('SELECT actions FROM coach_messages WHERE id = ? AND user_id = ?').get(messageId, userId) as { actions: string } | undefined;
  if (!row) throw new HttpError(404, 'Message not found');
  const actions = JSON.parse(row.actions) as CoachAction[];
  const a = actions[index];
  if (!a) throw new HttpError(404, 'Action not found');
  if (a.status !== 'pending') throw new HttpError(409, `Already ${a.status}`);
  if (!dismiss) {
    switch (a.type) {
      case 'swap': swapExercise(userId, a.workoutExerciseId, a.exerciseId, a.scope); break;
      case 'load': adjustLoad(userId, a.workoutExerciseId, a.percent); break;
      case 'add': addExerciseToWorkout(userId, a.workoutId, a.exerciseId, { sets: a.sets, reps: a.reps, restSeconds: a.restSeconds, note: a.note }); break;
      case 'program': setSlotExercise(userId, a.slotId, a.exerciseId); break;
      case 'limitations': {
        const p = getProfile(userId);
        const set = new Set(p.limitations);
        a.add.forEach((j) => set.add(j));
        a.remove.forEach((j) => set.delete(j));
        const notes = a.note ? [p.limitationNotes, a.note].filter(Boolean).join('\n') : p.limitationNotes;
        saveProfile(userId, { ...p, limitations: [...set], limitationNotes: notes });
        break;
      }
    }
  }
  a.status = dismiss ? 'dismissed' : 'applied';
  db.prepare('UPDATE coach_messages SET actions = ? WHERE id = ?').run(JSON.stringify(actions), messageId);
  return a;
}

// ---------------------------------------------------------------------------
// Conversation

interface MessageRow { id: number; workout_id: number | null; role: 'user' | 'assistant'; content: string; actions: string; sources: string; created_at: string }

export function listMessages(userId: number, workoutId: number | null) {
  const rows = db.prepare(`SELECT * FROM coach_messages WHERE user_id = ? AND workout_id IS ? ORDER BY id`).all(userId, workoutId) as MessageRow[];
  return rows.map((r) => ({
    id: r.id, role: r.role, content: r.content, createdAt: r.created_at,
    actions: JSON.parse(r.actions) as CoachAction[], sources: JSON.parse(r.sources) as Array<{ url: string; title: string }>,
  }));
}

export async function ask(userId: number, workoutId: number | null, text: string) {
  if (!coachEnabled()) throw new HttpError(503, 'The AI coach is not configured. Set ANTHROPIC_API_KEY on the server.');
  if (workoutId != null) ownedWorkout(userId, workoutId);
  // Coach chats outside a workout can still act on an in-progress one.
  const actionWorkoutId = workoutId ?? activeWorkoutId(userId);

  const history = listMessages(userId, workoutId).slice(-MAX_HISTORY);
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content || '(no text)' }));
  // The API requires the first message to be from the user.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `<context>\n${buildContext(userId, actionWorkoutId)}\n</context>` },
      { type: 'text', text },
    ],
  });

  db.prepare('INSERT INTO coach_messages (user_id, workout_id, role, content) VALUES (?, ?, ?, ?)').run(userId, workoutId, 'user', text);

  const actions: CoachAction[] = [];
  const texts: string[] = [];
  const sources = new Map<string, string>();

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      const msg = await stream.finalMessage();

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

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const action = toAction(userId, actionWorkoutId, block.name, block.input as Record<string, unknown>);
          actions.push(action);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Shown to the user as a button: "${action.label}". Not applied yet.` });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: (err as Error).message });
        }
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The coach is busy right now — try again in a minute.');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'The AI coach API key is invalid.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Coach error: ${err.message}`);
    throw err;
  }

  const content = texts.join('\n\n').trim() || (actions.length ? 'Here are some changes you can apply:' : 'I don\'t have a suggestion for that.');
  const info = db.prepare('INSERT INTO coach_messages (user_id, workout_id, role, content, actions, sources) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, workoutId, 'assistant', content, JSON.stringify(actions),
      JSON.stringify([...sources.entries()].map(([url, title]) => ({ url, title }))));
  return listMessages(userId, workoutId).find((m) => m.id === Number(info.lastInsertRowid))!;
}
