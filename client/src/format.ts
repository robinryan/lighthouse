import type { Units } from './api';

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '';
  return String(Math.round(n * 100) / 100);
}

export function fmtWeight(w: number | null | undefined, units: Units, perHand = false): string {
  if (w == null) return '—';
  return `${fmtNum(w)} ${units}${perHand ? ' ea' : ''}`;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function e1rm(w: number, r: number): number {
  if (!w || r <= 0) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

export const JOINT_LABELS: Record<string, string> = {
  elbow: 'Elbows', shoulder: 'Shoulders', wrist: 'Wrists', knee: 'Knees', lowBack: 'Lower back', hip: 'Hips',
};
export const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barbell & rack', dumbbell: 'Dumbbells', cable: 'Cable machine', machine: 'Machines',
  pullup_bar: 'Pull-up bar', band: 'Resistance bands', bodyweight: 'Bodyweight',
};
export const MUSCLE_LABELS: Record<string, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', rear_delts: 'Rear delts', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', core: 'Core', lower_back: 'Lower back',
};
