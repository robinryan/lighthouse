import { EXERCISE_TIPS, videoUrl } from '../api';

export function tipsEnabled(): boolean {
  try { return localStorage.getItem('lh_tips') !== 'off'; } catch { return true; }
}

/** Exercise name linking to a YouTube form demo. */
export function ExerciseName({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <a className={`ex-link ${className ?? ''}`} style={style} href={videoUrl(name)} target="_blank" rel="noreferrer noopener"
      title={`Watch how to do ${name} on YouTube`} onClick={(e) => e.stopPropagation()}>
      {name}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 8.5v7l6-3.5-6-3.5z" /><rect x="2.5" y="5" width="19" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </a>
  );
}

/** The three form & safety points for an exercise. */
export function FormTips({ exerciseId, tips }: { exerciseId?: string; tips?: string[] }) {
  const list = tips ?? (exerciseId ? EXERCISE_TIPS[exerciseId] : undefined) ?? [];
  if (!list.length) return null;
  return <ul className="tips">{list.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}
