// Typed API client. Set updates made while offline are queued in localStorage
// and replayed when the connection returns, so logging never blocks at the gym.

export type Units = 'kg' | 'lb';
export type Tier = 'T1' | 'T2' | 'T3';
export type Joint = 'elbow' | 'shoulder' | 'wrist' | 'knee' | 'lowBack' | 'hip';
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'pullup_bar' | 'band';
export type LoadType = 'weight' | 'bodyweight' | 'time';

export interface User { id: number; email: string; name: string }

export interface Profile {
  units: Units;
  experience: 'beginner' | 'intermediate' | 'advanced';
  goal: 'strength' | 'hypertrophy' | 'general';
  daysPerWeek: number;
  sessionMinutes: number;
  equipment: Equipment[];
  limitations: Joint[];
  limitationNotes: string;
  bodyweight: number | null;
  onboarded: boolean;
}

export interface Exercise {
  id: string; name: string; category: 'main' | 'compound' | 'accessory' | 'mobility';
  muscles: string[]; equipment: Equipment[]; loadType: LoadType; lower: boolean; stress: Joint[];
  perHand?: boolean; family?: string; cues: string;
}

export interface SetDTO {
  id: number; position: number; kind: 'warmup' | 'working'; targetReps: number | null; targetWeight: number | null;
  amrap: boolean; actualReps: number | null; actualWeight: number | null; rpe: number | null; done: boolean;
}

export interface WorkoutExercise {
  id: number; exerciseId: string; name: string; tier: Tier; slotId: string | null; schemeLabel: string;
  restSeconds: number; notes: string; engineNote: string | null; substitutedFrom: string | null; loadType: LoadType;
  perHand: boolean; equipment: Equipment[]; cues: string; muscles: string[];
  previous: Array<{ reps: number | null; weight: number | null }>; bestE1rm: number; sets: SetDTO[];
}

export interface FinishSummary {
  results: Array<{ exerciseId: string; name: string; tier: Tier; outcome: string; message: string }>;
  prs: Array<{ exerciseId: string; name: string; weight: number; reps: number; e1rm: number }>;
  volume: number; setsDone: number; durationMin: number | null;
}

export interface Workout {
  id: number; date: string; title: string; status: 'in_progress' | 'completed'; notes: string; dayIndex: number | null;
  startedAt: string; finishedAt: string | null; summary: FinishSummary | null; exercises: WorkoutExercise[];
}

export interface DayPreview {
  dayIndex: number; key: string; name: string;
  exercises: Array<{ slotId: string; exerciseId: string; name: string; tier: Tier; scheme: string; weight: number | null; loadType: LoadType; perHand: boolean; note: string | null }>;
}

export interface Today { activeWorkoutId: number | null; next: DayPreview | null; lastWorkoutDate: string | null; coachEnabled: boolean }
export interface ProgramDTO { nextDay: number; fiveRMs: Record<string, number | null>; days: DayPreview[] }

export interface WorkoutListItem { id: number; date: string; title: string; setsDone: number; volume: number; prs: number; durationMin: number | null; exercises: string[] }

export interface CoachAction { type: string; label: string; reason?: string; note?: string; status: 'pending' | 'applied' | 'dismissed' }
export interface CoachMessage { id: number; role: 'user' | 'assistant'; content: string; createdAt: string; actions: CoachAction[]; sources: Array<{ url: string; title: string }> }

export interface Summary {
  totalWorkouts: number; thisWeek: number; streakWeeks: number; muscleSets: Record<string, number>;
  recentPRs: Array<{ exerciseId: string; name: string; weight: number; reps: number; e1rm: number; date: string }>;
  mains: Array<{ exerciseId: string; name: string; bestE1rm: number; sessions: number; trend: Array<{ date: string; e1rm: number }> }>;
  days: string[];
}

export interface ExerciseHistory {
  exerciseId: string; name: string; bestE1rm: number;
  sessions: Array<{ workoutId: number; date: string; topWeight: number; topReps: number; e1rm: number; volume: number; totalReps: number; sets: Array<{ weight: number | null; reps: number | null; rpe: number | null }> }>;
  repPRs: Array<{ reps: number; weight: number; date: string }>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

export function localDate(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Offline outbox for set updates

const OUTBOX = 'lh_outbox';
type Patch = { id: number; body: Record<string, unknown> };

function readOutbox(): Patch[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]'); } catch { return []; }
}
function writeOutbox(items: Patch[]) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(items)); } catch { /* storage unavailable */ }
}

export function pendingCount() { return readOutbox().length; }

export async function patchSet(id: number, body: Record<string, unknown>): Promise<'sent' | 'queued'> {
  try {
    await api.patch(`/sets/${id}`, body);
    return 'sent';
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Network failure: merge with any queued patch for the same set.
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
        await api.patch(`/sets/${first.id}`, first.body);
        sent++;
      } catch (e) {
        if (!(e instanceof ApiError)) break; // still offline
        // Server rejected (e.g. set deleted) — drop it.
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
