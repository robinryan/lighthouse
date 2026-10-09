import { useState } from 'react';
import type { Units } from '../api';
import { Sheet } from './Sheet';
import { fmtNum } from '../format';

const PLATES: Record<Units, number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
const COLORS: Record<string, string> = {
  '25': '#e5484d', '20': '#3e8ef7', '15': '#ffc94d', '10': '#3ecf8e', '5': '#f4f5f7', '2.5': '#9aa3b2', '1.25': '#c7cbd3',
  '45': '#3e8ef7', '35': '#ffc94d',
};

export function platesPerSide(total: number, bar: number, units: Units): { plates: number[]; leftover: number } {
  let side = (total - bar) / 2;
  const plates: number[] = [];
  for (const p of PLATES[units]) {
    while (side >= p - 1e-9) { plates.push(p); side -= p; }
  }
  return { plates, leftover: Math.round(side * 2 * 100) / 100 };
}

export function PlateCalculator({ weight, units, onClose }: { weight: number; units: Units; onClose: () => void }) {
  const [total, setTotal] = useState(String(weight || ''));
  const [bar, setBar] = useState(units === 'kg' ? 20 : 45);
  const t = Number(total) || 0;
  const { plates, leftover } = platesPerSide(t, bar, units);
  const max = PLATES[units][0];
  return (
    <Sheet onClose={onClose} title="Plate calculator">
      <div className="row">
        <label className="field grow"><span>Total ({units})</span>
          <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label className="field" style={{ width: 120 }}><span>Bar</span>
          <select value={bar} onChange={(e) => setBar(Number(e.target.value))}>
            {(units === 'kg' ? [20, 15, 10] : [45, 35, 25]).map((b) => <option key={b} value={b}>{b} {units}</option>)}
          </select>
        </label>
      </div>
      {t < bar ? (
        <p className="muted center" style={{ marginTop: 16 }}>Less than the bar — use dumbbells or a lighter bar.</p>
      ) : (
        <>
          <div className="plates" aria-label="Plates on one side">
            <div className="bar-stub" />
            {plates.map((p, i) => (
              <div key={i} className="plate" style={{ background: COLORS[String(p)] ?? '#ccc', height: 40 + (p / max) * 80, width: p >= 10 ? 22 : 14 }}>
                {fmtNum(p)}
              </div>
            ))}
          </div>
          <p className="center"><b>Each side:</b> {plates.length ? plates.map(fmtNum).join(' + ') : 'just the bar'}</p>
          {leftover > 0 && <p className="center notice">Can't make exactly — {fmtNum(leftover)} {units} short.</p>}
        </>
      )}
    </Sheet>
  );
}
