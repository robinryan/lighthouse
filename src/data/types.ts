// Shapes the UI works with.

export type Units = 'kg' | 'lb';
export type Tier = 'T1' | 'T2' | 'T3';
export type Joint = 'elbow' | 'shoulder' | 'wrist' | 'knee' | 'lowBack' | 'hip';
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'pullup_bar' | 'band';
export type LoadType = 'weight' | 'bodyweight' | 'time';

export interface User { id: string; email: string }

export interface Profile {
  name: string;
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
  skipped: boolean; skipReason: string | null;
}

export interface WorkoutExercise {
  id: number; exerciseId: string; name: string; tier: Tier; slotId: string | null; schemeLabel: string;
  restSeconds: number; notes: string; engineNote: string | null; substitutedFrom: string | null; loadType: LoadType;
  perHand: boolean; equipment: Equipment[]; cues: string; muscles: string[];
  previous: Array<{ reps: number | null; weight: number | null }>; bestE1rm: number; sets: SetDTO[];
  tips: string[]; videoUrl: string; skipped: boolean; skipReason: string | null;
  /** Set when this row is a stretch: which exercise it's for, before or after it, and why. */
  stretch: { forExerciseId: string; forName: string; when: 'before' | 'after'; importance: number | null; why: string | null; dose: string | null } | null;
  /** For regular exercises: recommended stretches, and whether each is already in this workout. */
  stretchRecs: Array<{ stretchId: string; name: string; when: 'before' | 'after'; importance: number; why: string; dose: string | null; inWorkout: boolean }>;
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

export interface Today { activeWorkoutId: number | null; next: DayPreview | null; days: DayPreview[]; lastWorkoutDate: string | null }
export interface ProgramDTO { nextDay: number; fiveRMs: Record<string, number | null>; days: DayPreview[] }

export interface WorkoutListItem { id: number; date: string; title: string; setsDone: number; volume: number; prs: number; durationMin: number | null; exercises: string[] }

export interface CoachAction { type: string; label: string; reason?: string; note?: string; status: 'pending' | 'applied' | 'dismissed' }
export interface CoachMessage {
  id: number; role: 'user' | 'assistant'; content: string; createdAt: string; actions: CoachAction[]; sources: Array<{ url: string; title: string }>;
  costUsd: number | null; effort: 'low' | 'medium' | null; webSearches: number;
}

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

