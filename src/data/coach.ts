import type { CoachAction, MessageRow } from '../../supabase/functions/_shared/coach.ts';
import { must } from '../../supabase/functions/_shared/queries.ts';
import { db } from './client';
import {
  addExerciseToWorkout, adjustLoad, getProfile, saveProfile, setSlotExercise, swapExercise,
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
  return (must(await q) as MessageRow[]).map(toMessage);
}

/** Thrown when the coach edge function isn't deployed or has no API key yet. */
export class CoachNotConfiguredError extends Error {}

export async function askCoach(workoutId: number | null, text: string, research = false): Promise<CoachMessage> {
  const { data, error } = await db().functions.invoke('coach', { body: { workoutId, text, research } });
  if (error) {
    // supabase-js wraps non-2xx responses; pull out the function's own message when there is one.
    const ctx = (error as { context?: Response }).context;
    let message = error.message as string;
    let code: string | undefined;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        message = body.error ?? message;
        code = body.code;
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
  return toMessage(data as MessageRow);
}

export async function applyAction(messageId: number, index: number, dismiss: boolean): Promise<CoachAction> {
  const row = must(await db().from('coach_messages').select('actions').eq('id', messageId).maybeSingle()) as { actions: CoachAction[] } | null;
  if (!row) throw new Error('Message not found');
  const actions = row.actions;
  const a = actions[index];
  if (!a) throw new Error('Action not found');
  if (a.type === 'health') {
    // Saved automatically; dismissing means "undo".
    if (!dismiss || a.status !== 'applied') throw new Error('Already saved');
    must(await db().from('health_notes').delete().eq('id', a.noteId));
    a.status = 'dismissed';
    must(await db().from('coach_messages').update({ actions }).eq('id', messageId));
    return a;
  }
  if (a.status !== 'pending') throw new Error(`Already ${a.status}`);
  if (!dismiss) {
    switch (a.type) {
      case 'swap': await swapExercise(a.workoutExerciseId, a.exerciseId, a.scope); break;
      case 'load': await adjustLoad(a.workoutExerciseId, a.percent); break;
      case 'add': await addExerciseToWorkout(a.workoutId, a.exerciseId, { sets: a.sets, reps: a.reps, restSeconds: a.restSeconds, note: a.note }); break;
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
  }
  a.status = dismiss ? 'dismissed' : 'applied';
  must(await db().from('coach_messages').update({ actions }).eq('id', messageId));
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
