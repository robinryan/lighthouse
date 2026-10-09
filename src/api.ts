// Single entry point for the UI's data access. Set updates made while offline are
// queued in localStorage and replayed when the connection returns, so logging never
// blocks at the gym.

import { NetworkError } from '../supabase/functions/_shared/queries.ts';
import { type SetPatch, updateSet } from './data/training';

export * from './data/types';
export * from './data/training';
export * from './data/stats';
export { listMessages, askCoach, applyAction, coachUsageThisMonth, CoachNotConfiguredError, type CoachMonthUsage } from './data/coach';
export { db, isConfigured } from './data/client';
export { NetworkError };

export function localDate(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const isOffline = (e: unknown) => e instanceof NetworkError || (e instanceof TypeError && /fetch/i.test(e.message));

// ---------------------------------------------------------------------------
// Offline outbox for set updates

const OUTBOX = 'lh_outbox';
type Patch = { id: number; body: SetPatch };

function readOutbox(): Patch[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]'); } catch { return []; }
}
function writeOutbox(items: Patch[]) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(items)); } catch { /* storage unavailable */ }
}

export function pendingCount() { return readOutbox().length; }

export async function patchSet(id: number, body: SetPatch): Promise<'sent' | 'queued'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError();
    await updateSet(id, body);
    return 'sent';
  } catch (e) {
    if (!isOffline(e)) throw e;
    // Merge with any queued patch for the same set.
    const items = readOutbox();
    const existing = items.find((i) => i.id === id);
    if (existing) Object.assign(existing.body, body);
    else items.push({ id, body });
    writeOutbox(items);
    return 'queued';
  }
}

let flushing = false;
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    let items = readOutbox();
    while (items.length) {
      const [first] = items;
      try {
        await updateSet(first.id, first.body);
        sent++;
      } catch (e) {
        if (isOffline(e)) break;
        // Rejected (e.g. the set was deleted) — drop it.
      }
      // Remove what we sent, keeping any newer edit queued for the same set meanwhile.
      const sentBody = JSON.stringify(first.body);
      items = readOutbox().filter((i) => !(i.id === first.id && JSON.stringify(i.body) === sentBody));
      writeOutbox(items);
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export {
  listHealthNotes, addHealthNotes, removeHealthNote, getHealthSummary, skipExercise, unskipExercise, skipSet,
  getAddSuggestions, getReplacementSuggestions, replaceSkipped, type HealthNote, type Suggestion,
} from './data/health';
export { SKIP_REASONS, JOINT_NAMES, describeSkip, parseSkip, type SkipFeedback, type SkipReason } from '../supabase/functions/_shared/health.ts';
export { EXERCISE_TIPS, videoUrl } from '../supabase/functions/_shared/exerciseTips.ts';
