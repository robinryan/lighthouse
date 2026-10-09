// The user's health profile: built from skip feedback, coach conversations and
// manual entries, and used to rank exercise suggestions and steer the coach.

import { EXERCISE_MAP, type Joint } from './exercises.ts';

export type HealthKind = 'joint' | 'avoid' | 'prefer' | 'dislike' | 'note';
export type HealthSource = 'skip' | 'coach' | 'user';

export interface HealthNote {
  id: number;
  kind: HealthKind;
  joint: Joint | null;
  exercise_id: string | null;
  severity: number;
  note: string;
  source: HealthSource;
  workout_id: number | null;
  created_at: string;
  expires_at: string | null;
}

export type NewHealthNote = Omit<HealthNote, 'id' | 'created_at'>;

export const JOINT_NAMES: Record<Joint, string> = {
  elbow: 'elbows', shoulder: 'shoulders', wrist: 'wrists', knee: 'knees', lowBack: 'lower back', hip: 'hips',
};

// ---------------------------------------------------------------------------
// Skip feedback

export type SkipReason = 'pain' | 'equipment' | 'tired' | 'time' | 'dislike' | 'too_hard' | 'too_easy' | 'other';

export const SKIP_REASONS: Array<{ id: SkipReason; label: string }> = [
  { id: 'pain', label: 'Pain or discomfort' },
  { id: 'equipment', label: 'Equipment busy or unavailable' },
  { id: 'tired', label: 'Too tired today' },
  { id: 'time', label: 'Short on time' },
  { id: 'too_hard', label: 'Too hard / too heavy' },
  { id: 'too_easy', label: 'Too easy' },
  { id: 'dislike', label: 'Don\'t like this exercise' },
  { id: 'other', label: 'Other' },
];

export interface SkipFeedback { reason: SkipReason; joints: Joint[]; note: string }

export function describeSkip(f: SkipFeedback): string {
  const label = SKIP_REASONS.find((r) => r.id === f.reason)?.label ?? f.reason;
  const where = f.joints.length ? ` (${f.joints.map((j) => JOINT_NAMES[j]).join(', ')})` : '';
  return `${label}${where}${f.note ? ` — "${f.note}"` : ''}`;
}

export function parseSkip(raw: string | null): SkipFeedback | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v.reason === 'string' ? { reason: v.reason, joints: v.joints ?? [], note: v.note ?? '' } : null;
  } catch {
    return { reason: 'other', joints: [], note: raw };
  }
}

const DAY = 86_400_000;

/** What a skip teaches us about the user's body. Pain fades after six weeks unless it recurs. */
export function healthNotesFromSkip(
  f: SkipFeedback, exerciseId: string, wholeExercise: boolean, workoutId: number | null, now = new Date(),
): NewHealthNote[] {
  const name = EXERCISE_MAP.get(exerciseId)?.name ?? exerciseId;
  const base = { source: 'skip' as const, workout_id: workoutId, joint: null, exercise_id: null };
  if (f.reason === 'pain') {
    const expires = new Date(now.getTime() + 42 * DAY).toISOString();
    const severity = wholeExercise ? 2 : 1;
    const where = f.joints.map((j) => JOINT_NAMES[j]).join(', ');
    return [
      ...f.joints.map((joint) => ({
        ...base, kind: 'joint' as const, joint, severity, expires_at: expires,
        note: `Pain during ${name}${f.note ? `: ${f.note}` : ''}`,
      })),
      {
        ...base, kind: 'avoid' as const, exercise_id: exerciseId, severity, expires_at: expires,
        note: `Caused ${where || 'pain'}${f.note ? `: ${f.note}` : ''}`,
      },
    ];
  }
  if (f.reason === 'dislike') {
    return [{ ...base, kind: 'dislike', exercise_id: exerciseId, severity: 1, expires_at: null, note: f.note || 'Skipped — doesn\'t like it' }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Summary

export interface HealthSummary {
  /** Sensitivity per joint, 0–3. */
  joints: Partial<Record<Joint, number>>;
  avoid: Map<string, string>;
  prefer: Set<string>;
  dislike: Set<string>;
  notes: HealthNote[];
}

export function isActive(n: HealthNote, now = new Date()): boolean {
  return !n.expires_at || Date.parse(n.expires_at) > now.getTime();
}

/** Combine notes with the joints declared in the profile (which count as moderate sensitivity). */
export function summarizeHealth(notes: HealthNote[], declared: Joint[] = [], now = new Date()): HealthSummary {
  const active = notes.filter((n) => isActive(n, now));
  const joints: Partial<Record<Joint, number>> = {};
  for (const j of declared) joints[j] = Math.max(joints[j] ?? 0, 2);
  const avoid = new Map<string, string>();
  const prefer = new Set<string>();
  const dislike = new Set<string>();
  // Sensitivity = worst report, plus half a point for each repeat report (capped at 3).
  const reports = new Map<Joint, number[]>();
  for (const n of active) {
    if (n.kind === 'joint' && n.joint) reports.set(n.joint, [...(reports.get(n.joint) ?? []), n.severity]);
  }
  for (const [j, sev] of reports) {
    joints[j] = Math.min(3, Math.max(joints[j] ?? 0, Math.max(...sev) + 0.5 * (sev.length - 1)));
  }
  for (const n of active) {
    if (n.kind === 'joint') continue;
    else if (n.kind === 'avoid' && n.exercise_id) avoid.set(n.exercise_id, n.note);
    else if (n.kind === 'prefer' && n.exercise_id) prefer.add(n.exercise_id);
    else if (n.kind === 'dislike' && n.exercise_id) dislike.add(n.exercise_id);
  }
  for (const id of prefer) avoid.delete(id);
  return { joints, avoid, prefer, dislike, notes: active };
}

/** Plain-text summary for the coach's context. */
export function describeHealth(h: HealthSummary): string[] {
  const lines: string[] = [];
  const joints = Object.entries(h.joints).filter(([, s]) => (s ?? 0) > 0)
    .map(([j, s]) => `${JOINT_NAMES[j as Joint]} (${(s ?? 0) >= 2.5 ? 'high' : (s ?? 0) >= 1.5 ? 'moderate' : 'mild'})`);
  if (joints.length) lines.push(`Sensitive joints: ${joints.join(', ')}`);
  const name = (id: string) => EXERCISE_MAP.get(id)?.name ?? id;
  if (h.avoid.size) lines.push(`Avoid: ${[...h.avoid].map(([id, why]) => `${name(id)} [${id}]${why ? ` — ${why}` : ''}`).join('; ')}`);
  if (h.prefer.size) lines.push(`Works well: ${[...h.prefer].map((id) => `${name(id)} [${id}]`).join(', ')}`);
  if (h.dislike.size) lines.push(`Dislikes: ${[...h.dislike].map((id) => `${name(id)} [${id}]`).join(', ')}`);
  const notes = h.notes.filter((n) => n.kind === 'note' || (n.kind === 'joint' && n.note)).slice(0, 12)
    .map((n) => `${n.created_at.slice(0, 10)} ${n.kind === 'joint' && n.joint ? `[${n.joint}] ` : ''}${n.note}`);
  if (notes.length) lines.push(`Health notes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  return lines;
}
