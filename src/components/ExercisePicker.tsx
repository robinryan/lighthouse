import { useMemo, useState } from 'react';
import { videoUrl, type Exercise, type Joint, type Suggestion } from '../api';
import { useExercises, useSession } from '../hooks';
import { JOINT_LABELS, MUSCLE_LABELS } from '../format';
import { Sheet } from './Sheet';

/** Searchable exercise list. When `similarTo` is given, alternatives that hit the same muscles come first. */
function VideoLink({ name }: { name: string }) {
  return (
    <a className="btn icon ghost" href={videoUrl(name)} target="_blank" rel="noreferrer noopener" aria-label={`Watch ${name} on YouTube`}
      title="Watch a demo" onClick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 8.5v7l6-3.5-6-3.5z" /><rect x="2.5" y="5" width="19" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </a>
  );
}

/**
 * Searchable exercise list. `suggestions` (ranked, with reasons) are shown first; when
 * `similarTo` is given, alternatives that hit the same muscles come first.
 */
export function ExercisePicker({ onPick, onClose, similarTo, title = 'Choose exercise', suggestions }: {
  onPick: (ex: Exercise) => void; onClose: () => void; similarTo?: string; title?: string;
  suggestions?: Suggestion[] | 'loading';
}) {
  const all = useExercises();
  const { profile } = useSession();
  const [q, setQ] = useState('');
  const [avoid, setAvoid] = useState<Joint[]>(profile.limitations);
  const [onlyMine, setOnlyMine] = useState(true);
  const base = all.find((e) => e.id === similarTo);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = all.filter((e) =>
      e.id !== similarTo &&
      (!term || e.name.toLowerCase().includes(term) || e.muscles.some((m) => m.includes(term))) &&
      !e.stress.some((j) => avoid.includes(j)) &&
      (!onlyMine || e.equipment.every((eq) => eq === 'bodyweight' || profile.equipment.includes(eq))));
    if (!base) return filtered;
    const score = (e: Exercise) => {
      const overlap = e.muscles.filter((m) => base.muscles.includes(m)).length;
      return overlap * 10 + (e.family && e.family === base.family ? 15 : 0) + (e.category === base.category ? 3 : 0) - (e.category === 'mobility' ? 5 : 0);
    };
    return filtered.sort((a, b) => score(b) - score(a));
  }, [all, q, avoid, onlyMine, base, similarTo, profile.equipment]);

  const toggle = (j: Joint) => setAvoid((a) => (a.includes(j) ? a.filter((x) => x !== j) : [...a, j]));

  return (
    <Sheet onClose={onClose} tall title={title}>
      <input placeholder="Search exercises or muscles" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!similarTo} />
      <div className="small muted" style={{ margin: '10px 0 6px' }}>Easy on:</div>
      <div className="chips">
        {(Object.keys(JOINT_LABELS) as Joint[]).map((j) => (
          <button key={j} className={`chip ${avoid.includes(j) ? 'on' : ''}`} onClick={() => toggle(j)}>{JOINT_LABELS[j]}</button>
        ))}
        <button className={`chip ${onlyMine ? 'on' : ''}`} onClick={() => setOnlyMine((v) => !v)}>My equipment</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, marginTop: 8 }}>
        {suggestions && !q.trim() && (
          <>
            <h3 style={{ margin: '8px 0 0' }}>Suggested for you</h3>
            <p className="tiny muted" style={{ margin: '2px 0 4px' }}>Ranked by what helps most: this week's training, your health profile and coach feedback.</p>
            {suggestions === 'loading' ? <p className="small muted">Ranking exercises…</p> : suggestions.map((sug, i) => {
              const ex = all.find((e) => e.id === sug.exerciseId);
              if (!ex) return null;
              return (
                <div key={sug.exerciseId} className="list-item" role="button" tabIndex={0} onClick={() => onPick(ex)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') onPick(ex); }}>
                  <span className="rank">{i + 1}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{ex.name}</div>
                    <div className="small muted">{sug.reasons.join(' · ') || ex.muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(', ')}</div>
                  </div>
                  <VideoLink name={ex.name} />
                </div>
              );
            })}
            <h3 style={{ margin: '16px 0 0' }}>All exercises</h3>
          </>
        )}
        {list.map((e) => (
          <div key={e.id} className="list-item" role="button" tabIndex={0} onClick={() => onPick(e)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') onPick(e); }}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div className="small muted">
                {e.muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(', ')} · {e.equipment.join(', ')}
                {e.category === 'mobility' ? ' · mobility' : ''}
              </div>
            </div>
            <VideoLink name={e.name} />
          </div>
        ))}
        {!list.length && <p className="muted center" style={{ marginTop: 24 }}>No matches. Try clearing a filter.</p>}
      </div>
    </Sheet>
  );
}
