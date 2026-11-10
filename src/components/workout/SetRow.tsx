import { useEffect, useRef, useState } from 'react';
import { parseSkip, describeSkip, type SetDTO, type Units, type WorkoutExercise } from '../../api';
import { e1rm, fmtNum } from '../../format';
import { prefs } from '../RestTimer';

/** '' → null, invalid → undefined. */
export function parseField(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const v = Number(raw.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** One set: previous and target values, weight and reps inputs, the done check, and swipe to delete. */
export function SetRow({ s, n, ex, prev, readOnly, showWeight, current, units, onToggle, onEdit, onMenu, onDelete }: {
  s: SetDTO; n: number; ex: WorkoutExercise; prev: { reps: number | null; weight: number | null } | null; readOnly: boolean; showWeight: boolean;
  current: boolean; units: Units;
  onToggle: (s: SetDTO, typed: { reps: number | null; weight: number | null }) => Promise<void>;
  onEdit: (s: SetDTO, field: 'actualReps' | 'actualWeight', raw: string, propagate?: boolean) => Promise<void>;
  onMenu: (s: SetDTO) => void;
  onDelete: (s: SetDTO) => Promise<void>;
}) {
  // Swipe left or right on a pending set to delete it.
  const canSwipe = !readOnly && !s.done && !s.skipped;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; width: number; decided: boolean; active: boolean } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLTableRowElement>) => {
    if (!canSwipe || e.button > 0) return;
    drag.current = { x: e.clientX, y: e.clientY, width: e.currentTarget.getBoundingClientRect().width, decided: false, active: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLTableRowElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.decided) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      d.decided = true;
      d.active = Math.abs(mx) > Math.abs(my) * 1.5; // clearly sideways, not a scroll
      if (!d.active) { drag.current = null; return; }
      e.currentTarget.setPointerCapture(e.pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
      setDragging(true);
    }
    setDx(mx);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    setDragging(false);
    swiped.current = true;
    setTimeout(() => { swiped.current = false; }, 50);
    if (Math.abs(dx) > Math.max(90, d.width * 0.35)) {
      setDx(Math.sign(dx) * d.width);
      if (prefs().vibrate && 'vibrate' in navigator) navigator.vibrate(15);
      setTimeout(() => void onDelete(s), 180);
    } else {
      setDx(0);
    }
  };
  const swipeProps = canSwipe ? {
    onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    // A swipe that ends over a button isn't a tap.
    onClickCapture: (e: React.MouseEvent) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); } },
    style: { '--dx': `${dx}px` } as React.CSSProperties,
  } : {};
  const swipeClass = canSwipe ? ` swipeable${dragging ? ' dragging' : ''}` : '';

  const [w, setW] = useState(s.actualWeight != null ? String(s.actualWeight) : '');
  const [r, setR] = useState(s.actualReps != null ? String(s.actualReps) : '');
  // Follow server/coach-driven changes.
  useEffect(() => { setW(s.actualWeight != null ? String(s.actualWeight) : ''); }, [s.actualWeight]);
  useEffect(() => { setR(s.actualReps != null ? String(s.actualReps) : ''); }, [s.actualReps]);

  const isWarm = s.kind === 'warmup';
  const curW = parseField(w) ?? null;
  const curR = parseField(r) ?? null;
  const isPR = !isWarm && s.done && ex.bestE1rm > 0 && e1rm(curW ?? 0, curR ?? 0) > ex.bestE1rm + 1e-9;
  const unit = units === 'lb' ? 'lb' : 'kg';
  const reps = s.targetReps != null ? `${s.targetReps}${s.amrap ? '+' : ''}` : '';
  const target = ex.loadType === 'time' ? (s.targetReps != null ? `${s.targetReps}s` : '—')
    : s.targetWeight ? `${fmtNum(s.targetWeight)} ${unit} × ${reps}` : reps ? `× ${reps}` : '—';

  const numberCell = (
    <td className={`set-num ${isWarm ? 'warm' : ''}`}>
      {dx > 0 && <span className="swipe-reveal from-left" aria-hidden="true">Delete</span>}
      {readOnly ? (isWarm ? 'W' : n) : (
        <button className="prev" style={{ fontWeight: 700, color: 'inherit' }} title="Set options (skip, remove)" onClick={() => onMenu(s)}>
          {isWarm ? 'W' : n}
        </button>
      )}
      {s.amrap && <span className="amrap-tag">AMRAP</span>}
    </td>
  );

  if (s.skipped) {
    const why = parseSkip(s.skipReason);
    return (
      <tr className="skipped">
        {numberCell}
        <td colSpan={showWeight ? 5 : 4} className="small muted" style={{ textAlign: 'left', padding: '10px 6px' }}>
          Skipped{why ? ` — ${describeSkip(why)}` : ''}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`${s.done ? 'done' : current ? 'current' : ''}${swipeClass}`} {...swipeProps}>
      {numberCell}
      <td>
        <button className="prev" disabled={readOnly || !prev}
          onClick={() => {
            if (!prev) return;
            // "Previous" fills just this set: each set has its own previous values.
            if (prev.weight != null) { setW(String(prev.weight)); void onEdit(s, 'actualWeight', String(prev.weight), false); }
            if (prev.reps != null) { setR(String(prev.reps)); void onEdit(s, 'actualReps', String(prev.reps), false); }
          }}>
          {prev ? (ex.loadType === 'time' ? `${prev.reps}s` : `${fmtNum(prev.weight ?? 0)}${unit}×${prev.reps}`) : '—'}
        </button>
      </td>
      <td className="col-target target">{target}</td>
      {showWeight && (
        <td className="w-cell">
          <input
            inputMode="decimal" enterKeyHint="next" aria-label="Weight" disabled={readOnly} value={w}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={s.targetWeight != null ? fmtNum(s.targetWeight) : ex.loadType === 'bodyweight' ? '0' : '?'}
            onChange={(e) => setW(e.target.value)}
            onBlur={() => void onEdit(s, 'actualWeight', w)}
          />
        </td>
      )}
      <td className={showWeight ? 'r-cell' : ''}>
        <input
          inputMode="numeric" enterKeyHint="done" aria-label={ex.loadType === 'time' ? 'Seconds' : 'Reps'} disabled={readOnly} value={r}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={s.targetReps != null ? `${s.targetReps}${s.amrap ? '+' : ''}` : ''}
          onChange={(e) => setR(e.target.value)}
          onBlur={() => void onEdit(s, 'actualReps', r)}
        />
      </td>
      <td style={{ width: 48 }}>
        {dx < 0 && <span className="swipe-reveal from-right" aria-hidden="true">Delete</span>}
        {isPR && <span className="badge pr" style={{ display: 'block', marginBottom: 2 }}>PR</span>}
        <button className={`check ${s.done ? 'on' : ''}`} disabled={readOnly}
          onClick={() => void onToggle(s, { reps: curR != null ? Math.round(curR) : null, weight: curW })}
          aria-label={s.done ? 'Mark not done' : 'Mark done'}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>
      </td>
    </tr>
  );
}
