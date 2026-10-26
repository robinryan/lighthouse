import { SESSION_ACTIONS, isHiddenMessage, type CoachAction, type MessageRow } from '../../supabase/functions/_shared/coach.ts';
import type { IntakeResult } from '../../supabase/functions/_shared/intake.ts';
import type { AdminReport, MyPlan } from '../../supabase/functions/_shared/tiers.ts';
import { must } from '../../supabase/functions/_shared/queries.ts';
import { db } from './client';
import {
  addExerciseToWorkout, adjustLoad, getProfile, getProgram, removeWorkoutExercise, restoreTargets, saveProfile, saveProgram, setSlotExercise, swapExercise,
} from './training';
import type { CoachMessage } from './types';

function toMessage(r: MessageRow): CoachMessage {
  return {
    id: r.id, role: r.role, content: r.content, createdAt: r.created_at, actions: r.actions ?? [], sources: r.sources ?? [],
    costUsd: r.cost_usd ?? null, effort: r.usage?.effort ?? null, webSearches: r.usage?.webSearches ?? 0,
    model: r.usage?.model ?? null, route: r.usage?.route ?? null,
  };
}

export async function listMessages(workoutId: number | null): Promise<CoachMessage[]> {
  let q = db().from('coach_messages').select('*').order('id');
  q = workoutId == null ? q.is('workout_id', null) : q.eq('workout_id', workoutId);
  return (must(await q) as MessageRow[]).filter((m) => !isHiddenMessage(m)).map(toMessage);
}

/** Thrown when the coach edge function isn't deployed or has no API key yet. */
export class CoachNotConfiguredError extends Error {}

/**
 * The request didn't come back (the app was in the background, the network dropped, or the
 * gateway timed out). The coach may still have answered: its reply is saved on the server.
 */
export class CoachConnectionError extends Error {}

/** Call the coach edge function, turning its errors into readable ones. */
async function invokeCoach<T>(body: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: unknown };
  try {
    res = await db().functions.invoke('coach', { body });
  } catch (e) {
    throw new CoachConnectionError((e as Error).message || 'Connection lost');
  }
  const { data } = res;
  const error = res.error as (Error & { context?: Response }) | null;
  if (error) {
    // supabase-js wraps non-2xx responses; pull out the function's own message when there is one.
    // A network failure (FunctionsFetchError) carries the fetch error as its context, not a Response.
    const ctx = error.context instanceof Response ? error.context : undefined;
    let message = error.message as string;
    let code: string | undefined;
    let fromFunction = false;
    if (ctx) {
      try {
        const b = await ctx.json();
        fromFunction = typeof b?.error === 'string';
        message = b.error ?? message;
        code = b.code;
      } catch { /* not JSON */ }
    }
    // No answer from the coach itself: a dropped connection or a gateway timeout, not a refusal.
    if (!fromFunction && (!ctx || ctx.status >= 500 || ctx.status === 0)) throw new CoachConnectionError(message);
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

/**
 * After a dropped connection: wait for the coach's saved reply to `text`, sent after message
 * `sinceId`. Checks every few seconds (and straight away when the app comes back to the
 * foreground) for up to `timeoutMs`. Returns null if no reply turns up.
 */
export async function waitForReply(workoutId: number | null, sinceId: number, text: string, timeoutMs = 180_000): Promise<CoachMessage | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const msgs = await listMessages(workoutId);
      const asked = msgs.find((m) => m.id > sinceId && m.role === 'user' && m.content.trim() === text.trim());
      const reply = asked && msgs.find((m) => m.id > asked.id && m.role === 'assistant');
      if (reply) return reply;
    } catch { /* still offline: keep waiting */ }
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVisible); resolve(); };
      const onVisible = () => { if (document.visibilityState === 'visible') done(); };
      const t = setTimeout(done, 3000);
      document.addEventListener('visibilitychange', onVisible);
    });
  }
  return null;
}

/** The signed-in user's class and how much of this month's coach allowance they've used. */
export const getMyPlan = () => invokeCoach<MyPlan>({ mode: 'me' });

/** Admins: every user, their class, usage and spending. */
export const getAdminReport = () => invokeCoach<AdminReport>({ mode: 'admin_report' });

/** Admins: move a user between free and paid. */
export const setUserTier = (userId: string, tier: 'free' | 'paid') => invokeCoach<{ ok: true }>({ mode: 'admin_set_tier', userId, tier });

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

/** Carry out a change to the program (future sessions) and remember how to undo it. */
async function runProgramAction(a: CoachAction) {
  const sp = await getProgram();
  if (!sp) throw new Error('No program yet');
  switch (a.type) {
    case 'program': {
      const slot = sp.program.days.flatMap((d) => d.slots).find((x) => x.id === a.slotId);
      if (!slot) throw new Error('That program slot no longer exists');
      a.undo = { kind: 'program', slotId: slot.id, exerciseId: slot.exerciseId };
      slot.exerciseId = a.exerciseId;
      break;
    }
    case 'program_add': {
      const stamp = Date.now().toString(36);
      const ids: string[] = [];
      sp.program.days.forEach((d) => {
        if (!a.dayKeys.includes(d.key) || d.slots.some((x) => x.exerciseId === a.exerciseId)) return;
        const id = `${d.key}-x${stamp}${ids.length}`;
        d.slots.push({ id, tier: 'T3', exerciseId: a.exerciseId });
        ids.push(id);
      });
      if (!ids.length) throw new Error('Already in your program');
      a.undo = { kind: 'program_add', slotIds: ids };
      break;
    }
    case 'program_remove': {
      const day = sp.program.days.find((d) => d.slots.some((x) => x.id === a.slotId));
      if (!day) throw new Error('That program slot no longer exists');
      const index = day.slots.findIndex((x) => x.id === a.slotId);
      const [slot] = day.slots.splice(index, 1);
      a.undo = { kind: 'program_remove', dayKey: day.key, index, slot };
      break;
    }
    default:
      throw new Error('Not a program change');
  }
  await saveProgram(sp);
  a.status = 'applied';
}

const isProgramAction = (a: CoachAction) => a.type === 'program' || a.type === 'program_add' || a.type === 'program_remove';

async function undoProgram(u: NonNullable<Extract<CoachAction, { type: 'program' }>['undo']>) {
  const sp = await getProgram();
  if (!sp) throw new Error('No program yet');
  if (u.kind === 'program') {
    const slot = sp.program.days.flatMap((d) => d.slots).find((x) => x.id === u.slotId);
    if (slot) slot.exerciseId = u.exerciseId;
  } else if (u.kind === 'program_add') {
    for (const d of sp.program.days) d.slots = d.slots.filter((x) => !u.slotIds.includes(x.id));
  } else if (u.kind === 'program_remove') {
    const day = sp.program.days.find((d) => d.key === u.dayKey);
    if (day && !day.slots.some((x) => x.id === u.slot.id)) day.slots.splice(Math.min(u.index, day.slots.length), 0, u.slot);
  }
  await saveProgram(sp);
}

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

/** Whether the app applies this change by itself: today's workout always; the program when the user asked. */
export const appliesAutomatically = (a: CoachAction) => a.status === 'pending' && (isSessionAction(a) || (isProgramAction(a) && 'applyNow' in a && !!a.applyNow));

/**
 * Apply a coach reply's changes straight away: changes to the workout in progress (swaps, load
 * changes, added exercises), and program changes the user asked for. Suggestions stay as buttons.
 * Returns how many were applied.
 */
export async function applySessionActions(messageId: number): Promise<number> {
  const actions = await loadActions(messageId);
  let applied = 0;
  for (const a of actions) {
    if (!appliesAutomatically(a)) continue;
    try {
      if (isSessionAction(a)) await runSessionAction(a, !(a.type === 'swap' && a.applyNow));
      else await runProgramAction(a);
      applied++;
    } catch {
      // e.g. the exercise was already changed or the workout finished: leave it as a manual button.
    }
  }
  if (applied) await saveActions(messageId, actions);
  return applied;
}

/** Undo an applied change to today's workout or the program. */
export async function undoAction(messageId: number, index: number): Promise<CoachAction> {
  const actions = await loadActions(messageId);
  const a = actions[index];
  if (!a || !(isSessionAction(a) || isProgramAction(a)) || a.status !== 'applied' || !('undo' in a) || !a.undo) throw new Error('Nothing to undo');
  const u = a.undo;
  if (u.kind === 'program' || u.kind === 'program_add' || u.kind === 'program_remove') {
    await undoProgram(u);
  } else if (u.kind === 'swap') {
    // Look up the program slot before the swap-back replaces this row.
    const slot = a.type === 'swap' && a.permanent ? await getProgramSlotFor(u.workoutExerciseId) : null;
    await swapExercise(u.workoutExerciseId, u.exerciseId, 'today');
    if (slot) await setSlotExercise(slot, u.exerciseId);
    if (a.type === 'swap') a.permanent = false;
  } else if (u.kind === 'load') {
    await restoreTargets(u.weights);
  } else if (u.kind === 'add') {
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
  } else if (isProgramAction(a)) {
    await runProgramAction(a);
  } else {
    switch (a.type) {
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
