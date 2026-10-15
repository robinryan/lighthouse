import { SESSION_ACTIONS, isHiddenMessage, type CoachAction, type MessageRow } from '../../supabase/functions/_shared/coach.ts';
import type { IntakeResult } from '../../supabase/functions/_shared/intake.ts';
import { must } from '../../supabase/functions/_shared/queries.ts';
import { db } from './client';
import {
  addExerciseToWorkout, adjustLoad, getProfile, removeWorkoutExercise, restoreTargets, saveProfile, setSlotExercise, swapExercise,
} from './training';
import type { CoachMessage } from './types';

function toMessage(r: MessageRow): CoachMessage {
  return {
    id: r.id, role: r.role, content: r.content, createdAt: r.created_at, actions: r.actions ?? [], sources: r.sources ?? [],
    costUsd: r.cost_usd ?? null, effort: r.usage?.effort ?? null, webSearches: r.usage?.webSearches ?? 0,
  };
}

export async function listMessages(workoutId: number | null): Promise<CoachMessage[]> {
  let q = db().from('coach_messages').select('*').order('id');
  q = workoutId == null ? q.is('workout_id', null) : q.eq('workout_id', workoutId);
  return (must(await q) as MessageRow[]).filter((m) => !isHiddenMessage(m)).map(toMessage);
}

/** Thrown when the coach edge function isn't deployed or has no API key yet. */
export class CoachNotConfiguredError extends Error {}

/** Call the coach edge function, turning its errors into readable ones. */
async function invokeCoach<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('coach', { body });
  if (error) {
    // supabase-js wraps non-2xx responses; pull out the function's own message when there is one.
    const ctx = (error as { context?: Response }).context;
    let message = error.message as string;
    let code: string | undefined;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = await ctx.json();
        message = b.error ?? message;
        code = b.code;
      } catch { /* not JSON */ }
    }
    if (code === 'not_configured' || (ctx && ctx.status === 404)) {
      throw new CoachNotConfiguredError(
        ctx?.status === 404
          ? 'The coach function isn\'t deployed to Supabase yet.'
          : 'The AI coach needs an ANTHROPIC_API_KEY secret in Supabase.',
      );
    }
    throw new Error(message);
  }
  return data as T;
}

export async function askCoach(workoutId: number | null, text: string, research = false): Promise<CoachMessage> {
  return toMessage(await invokeCoach<MessageRow>({ workoutId, text, research }));
}

/** Onboarding: read a new user's description of their health, goals and history. */
export const readIntake = (text: string) => invokeCoach<IntakeResult>({ mode: 'intake_extract', text });

/** Onboarding: the coach explains the plan it built; stored as the first message in the coach chat. */
export async function explainPlan(text: string): Promise<CoachMessage> {
  return toMessage(await invokeCoach<MessageRow>({ mode: 'intake_explain', text }));
}

/** The most recent "why this plan fits you" explanation, if the coach wrote one. */
export async function latestPlanExplanation(): Promise<CoachMessage | null> {
  const rows = must(await db().from('coach_messages').select('*').eq('role', 'assistant').is('workout_id', null)
    .order('id', { ascending: false }).limit(50)) as MessageRow[];
  const row = rows.find((r) => r.usage?.kind === 'plan');
  return row ? toMessage(row) : null;
}

async function loadActions(messageId: number): Promise<CoachAction[]> {
  const row = must(await db().from('coach_messages').select('actions').eq('id', messageId).maybeSingle()) as { actions: CoachAction[] } | null;
  if (!row) throw new Error('Message not found');
  return row.actions;
}
const saveActions = async (messageId: number, actions: CoachAction[]) =>
  must(await db().from('coach_messages').update({ actions }).eq('id', messageId));

/**
 * Carry out a change to today's workout and remember how to undo it.
 * `todayOnly` keeps a "program" swap to this session until the user says otherwise.
 */
async function runSessionAction(a: CoachAction, todayOnly: boolean) {
  switch (a.type) {
    case 'swap': {
      const scope = todayOnly ? 'today' : a.scope;
      const r = await swapExercise(a.workoutExerciseId, a.exerciseId, scope);
      a.undo = { kind: 'swap', workoutExerciseId: r.id, exerciseId: r.replaced };
      if (a.scope === 'program') a.permanent = scope === 'program';
      break;
    }
    case 'load':
      a.undo = { kind: 'load', weights: await adjustLoad(a.workoutExerciseId, a.percent) };
      break;
    case 'add': {
      const id = await addExerciseToWorkout(a.workoutId, a.exerciseId, { sets: a.sets, reps: a.reps, restSeconds: a.restSeconds, note: a.note });
      a.undo = { kind: 'add', workoutExerciseId: id };
      break;
    }
    default:
      throw new Error('Not a change to today\'s workout');
  }
  a.status = 'applied';
}

const isSessionAction = (a: CoachAction) => (SESSION_ACTIONS as readonly string[]).includes(a.type);

/**
 * Apply a coach reply's changes to the workout in progress straight away (swaps, load changes,
 * added exercises). Future-session changes stay as buttons. Returns how many were applied.
 */
export async function applySessionActions(messageId: number): Promise<number> {
  const actions = await loadActions(messageId);
  let applied = 0;
  for (const a of actions) {
    if (a.status !== 'pending' || !isSessionAction(a)) continue;
    try {
      await runSessionAction(a, true);
      applied++;
    } catch {
      // e.g. the exercise was already changed or the workout finished: leave it as a manual button.
    }
  }
  if (applied) await saveActions(messageId, actions);
  return applied;
}

/** Undo an applied change to today's workout. */
export async function undoAction(messageId: number, index: number): Promise<CoachAction> {
  const actions = await loadActions(messageId);
  const a = actions[index];
  if (!a || !isSessionAction(a) || a.status !== 'applied' || !('undo' in a) || !a.undo) throw new Error('Nothing to undo');
  const u = a.undo;
  if (u.kind === 'swap') {
    // Look up the program slot before the swap-back replaces this row.
    const slot = a.type === 'swap' && a.permanent ? await getProgramSlotFor(u.workoutExerciseId) : null;
    await swapExercise(u.workoutExerciseId, u.exerciseId, 'today');
    if (slot) await setSlotExercise(slot, u.exerciseId);
    if (a.type === 'swap') a.permanent = false;
  } else if (u.kind === 'load') {
    await restoreTargets(u.weights);
  } else {
    await removeWorkoutExercise(u.workoutExerciseId);
  }
  a.status = 'undone';
  delete a.undo;
  await saveActions(messageId, actions);
  return a;
}

async function getProgramSlotFor(wexId: number): Promise<string | null> {
  const row = must(await db().from('workout_exercises').select('slot_id').eq('id', wexId).maybeSingle()) as { slot_id: string | null } | null;
  return row?.slot_id ?? null;
}

/** For a swap the coach suggested keeping: also use it in future sessions. */
export async function makeSwapPermanent(messageId: number, index: number): Promise<CoachAction> {
  const actions = await loadActions(messageId);
  const a = actions[index];
  if (!a || a.type !== 'swap' || a.status !== 'applied' || a.undo?.kind !== 'swap') throw new Error('Nothing to keep');
  const slot = await getProgramSlotFor(a.undo.workoutExerciseId);
  if (!slot) throw new Error('This exercise isn\'t part of your program');
  await setSlotExercise(slot, a.exerciseId);
  a.permanent = true;
  await saveActions(messageId, actions);
  return a;
}

export async function applyAction(messageId: number, index: number, dismiss: boolean): Promise<CoachAction> {
  const actions = await loadActions(messageId);
  const a = actions[index];
  if (!a) throw new Error('Action not found');
  if (a.type === 'health') {
    // Saved automatically; dismissing means "undo".
    if (!dismiss || a.status !== 'applied') throw new Error('Already saved');
    must(await db().from('health_notes').delete().eq('id', a.noteId));
    a.status = 'dismissed';
    await saveActions(messageId, actions);
    return a;
  }
  if (a.status !== 'pending') throw new Error(`Already ${a.status}`);
  if (dismiss) {
    a.status = 'dismissed';
  } else if (isSessionAction(a)) {
    await runSessionAction(a, false);
  } else {
    switch (a.type) {
      case 'program': await setSlotExercise(a.slotId, a.exerciseId); break;
      case 'limitations': {
        const p = await getProfile();
        const set = new Set(p.limitations);
        a.add.forEach((j) => set.add(j));
        a.remove.forEach((j) => set.delete(j));
        const notes = a.note ? [p.limitationNotes, a.note].filter(Boolean).join('\n') : p.limitationNotes;
        await saveProfile({ ...p, limitations: [...set], limitationNotes: notes });
        break;
      }
    }
    a.status = 'applied';
  }
  await saveActions(messageId, actions);
  return a;
}

export interface CoachMonthUsage { spentUsd: number; messages: number; budgetUsd: number | null; webSearches: number; avgUsd: number }

/** This month's coach spending (UTC month), from the usage stored with each reply. */
export async function coachUsageThisMonth(): Promise<CoachMonthUsage> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = must(await db().from('coach_messages').select('cost_usd, usage, created_at').eq('role', 'assistant')
    .gte('created_at', start).order('created_at', { ascending: false })) as Array<{ cost_usd: number | null; usage: MessageRow['usage'] }>;
  const spentUsd = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
  return {
    spentUsd, messages: rows.length, budgetUsd: rows.find((r) => r.usage)?.usage?.budgetUsd ?? null,
    webSearches: rows.reduce((a, r) => a + (r.usage?.webSearches ?? 0), 0),
    avgUsd: rows.length ? spentUsd / rows.length : 0,
  };
}
