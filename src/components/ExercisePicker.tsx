import { useMemo, useState } from 'react';
import type { Exercise, Joint } from '../api';
import { useExercises, useSession } from '../hooks';
import { JOINT_LABELS, MUSCLE_LABELS } from '../format';
import { Sheet } from './Sheet';

/** Searchable exercise list. When `similarTo` is given, alternatives that hit the same muscles come first. */
export function ExercisePicker({ onPick, onClose, similarTo, title = 'Choose exercise' }: {
  onPick: (ex: Exercise) => void; onClose: () => void; similarTo?: string; title?: string;
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
        {list.map((e) => (
          <button key={e.id} className="list-item" onClick={() => onPick(e)}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div className="small muted">
                {e.muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(', ')} · {e.equipment.join(', ')}
                {e.category === 'mobility' ? ' · mobility' : ''}
              </div>
            </div>
          </button>
        ))}
        {!list.length && <p className="muted center" style={{ marginTop: 24 }}>No matches. Try clearing a filter.</p>}
      </div>
    </Sheet>
  );
}
