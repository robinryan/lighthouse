import { useId } from 'react';
import { fmtDate, fmtNum } from '../format';

/** Minimal responsive SVG line chart. */
export function LineChart({ points, height = 160, unit = '', compact = false }: {
  points: Array<{ x: string; y: number }>; height?: number; unit?: string; compact?: boolean;
}) {
  const gid = useId();
  const W = 600;
  const H = height;
  const pad = compact ? { l: 4, r: 4, t: 6, b: 6 } : { l: 40, r: 12, t: 12, b: 24 };
  if (points.length === 0) return <p className="muted small">No data yet.</p>;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.1; max += span * 0.1;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const ticks = compact ? [] : [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progress chart">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="4 4" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{fmtNum(Math.round(t))}</text>
        </g>
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={compact ? 3 : 2.5} strokeLinejoin="round" strokeLinecap="round" />
      {!compact && points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.y)} r="3.5" fill="var(--accent)">
          <title>{`${fmtDate(p.x)}: ${fmtNum(p.y)}${unit}`}</title>
        </circle>
      ))}
      {!compact && (
        <>
          <text x={pad.l} y={H - 6} fontSize="12" fill="var(--muted)">{fmtDate(points[0].x, { month: 'short', day: 'numeric' })}</text>
          <text x={W - pad.r} y={H - 6} fontSize="12" fill="var(--muted)" textAnchor="end">{fmtDate(points[points.length - 1].x, { month: 'short', day: 'numeric' })}</text>
        </>
      )}
    </svg>
  );
}
