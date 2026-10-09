import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Equipment, type Joint, type Profile } from '../api';
import { EQUIPMENT_LABELS, JOINT_LABELS } from '../format';
import { useSession } from '../hooks';

type Draft = Omit<Profile, 'onboarded'>;

const GYM: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar', 'band'];

function Chips<T extends string | number>({ options, value, onChange, labels }: {
  options: T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string>;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={String(o)} className={`chip ${o === value ? 'on' : ''}`} onClick={() => onChange(o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  );
}

function MultiChips<T extends string>({ options, value, onChange, labels }: {
  options: T[]; value: T[]; onChange: (v: T[]) => void; labels: Record<string, string>;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={`chip ${value.includes(o) ? 'on' : ''}`}
          onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>
          {labels[o] ?? o}
        </button>
      ))}
    </div>
  );
}

/** Profile fields, shared by onboarding and settings. */
export function ProfileFields({ draft, set, section }: { draft: Draft; set: (d: Draft) => void; section: 'goals' | 'schedule' | 'equipment' | 'body' | 'all' }) {
  const show = (s: string) => section === 'all' || section === s;
  return (
    <div className="stack">
      {show('goals') && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <b>Main goal</b>
            <Chips options={['strength', 'hypertrophy', 'general'] as Profile['goal'][]} value={draft.goal}
              onChange={(goal) => set({ ...draft, goal })} labels={{ strength: 'Get stronger', hypertrophy: 'Build muscle', general: 'General fitness' }} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b>Lifting experience</b>
            <Chips options={['beginner', 'intermediate', 'advanced'] as Profile['experience'][]} value={draft.experience}
              onChange={(experience) => set({ ...draft, experience })}
              labels={{ beginner: 'Under 1 year', intermediate: '1–3 years', advanced: '3+ years' }} />
          </div>
        </>
      )}
      {show('schedule') && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <b>Days per week</b>
            <Chips options={[2, 3, 4, 5, 6]} value={draft.daysPerWeek} onChange={(daysPerWeek) => set({ ...draft, daysPerWeek })} />
            <span className="small muted">The plan rotates through four sessions (A1, A2, B1, B2) — just do the next one each time you train.</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b>Time per session</b>
            <Chips options={[45, 60, 75, 90]} value={draft.sessionMinutes} onChange={(sessionMinutes) => set({ ...draft, sessionMinutes })}
              labels={{ 45: '45 min', 60: '60 min', 75: '75 min', 90: '90 min' }} />
          </div>
        </>
      )}
      {show('equipment') && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <b>Equipment you have</b>
            <MultiChips options={GYM} value={draft.equipment} onChange={(equipment) => set({ ...draft, equipment })} labels={EQUIPMENT_LABELS} />
            <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ ...draft, equipment: GYM })}>Full gym</button>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b>Joints to go easy on</b>
            <MultiChips options={Object.keys(JOINT_LABELS) as Joint[]} value={draft.limitations} onChange={(limitations) => set({ ...draft, limitations })} labels={JOINT_LABELS} />
            <textarea placeholder="Optional details, e.g. 'left shoulder impingement, overhead pressing hurts'" value={draft.limitationNotes}
              onChange={(e) => set({ ...draft, limitationNotes: e.target.value })} />
          </div>
        </>
      )}
      {show('body') && (
        <div className="row">
          <div className="stack" style={{ gap: 6 }}>
            <b>Units</b>
            <Chips options={['kg', 'lb'] as Profile['units'][]} value={draft.units} onChange={(units) => set({ ...draft, units })} />
          </div>
          <label className="field grow"><span>Bodyweight ({draft.units})</span>
            <input inputMode="decimal" value={draft.bodyweight ?? ''} placeholder="optional"
              onChange={(e) => set({ ...draft, bodyweight: e.target.value ? Number(e.target.value) || null : null })} />
          </label>
        </div>
      )}
    </div>
  );
}

const LIFTS = [
  { key: 'squat', name: 'Back squat' },
  { key: 'bench', name: 'Bench press' },
  { key: 'deadlift', name: 'Deadlift' },
  { key: 'ohp', name: 'Overhead press' },
] as const;

export function SetupPage() {
  const { profile, refreshProfile } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({ ...profile, equipment: profile.equipment.length ? profile.equipment : GYM });
  const [five, setFive] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = ['goals', 'schedule', 'equipment', 'body', 'lifts'] as const;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fiveRMs = Object.fromEntries(LIFTS.map((l) => [l.key, Number(five[l.key]) > 0 ? Number(five[l.key]) : null]));
      await api.post('/onboarding', { profile: draft, fiveRMs });
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = steps[step];
  return (
    <div className="stack">
      <div className="steps">{steps.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}</div>
      <h1>{['What are you training for?', 'Your schedule', 'Equipment & joints', 'About you', 'Your current strength'][step]}</h1>
      {current === 'lifts' ? (
        <div className="stack">
          <p className="muted">
            Roughly the most you could lift for <b>5 good reps</b> today. Not sure? Leave it blank and we'll start conservatively —
            the plan adjusts quickly from your first sessions.
          </p>
          {LIFTS.map((l) => (
            <label key={l.key} className="field"><span>{l.name} — 5-rep max ({draft.units})</span>
              <input inputMode="decimal" value={five[l.key] ?? ''} placeholder="not sure"
                onChange={(e) => setFive({ ...five, [l.key]: e.target.value })} />
            </label>
          ))}
        </div>
      ) : (
        <ProfileFields draft={draft} set={setDraft} section={current} />
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < steps.length - 1
          ? <button className="btn primary grow" onClick={() => setStep(step + 1)}>Next</button>
          : <button className="btn primary grow" onClick={submit} disabled={busy}>{busy ? 'Building your plan…' : 'Build my program'}</button>}
      </div>
    </div>
  );
}
