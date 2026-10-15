import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  basicPlanExplanation, CoachNotConfiguredError, completeOnboarding, explainPlan, getProgram, getProgramView, localDate, readIntake,
  type Equipment, type IntakeResult, type Joint, type Profile,
} from '../api';
import { Markdown } from '../components/CoachChat';
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

const ABOUT_PLACEHOLDER = 'e.g. "I\'m 42, desk job, used to run but my knees ache now. Want to get stronger and lose a bit of weight. ' +
  'Hurt my lower back deadlifting years ago. Can train 3 mornings a week for about 45 minutes at a commercial gym."';

type PlanView = { explanation: string; byCoach: boolean; note: string | null; days: NonNullable<Awaited<ReturnType<typeof getProgramView>>>['days'] };

export function SetupPage() {
  const { profile, refreshProfile } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({ ...profile, equipment: profile.equipment.length ? profile.equipment : GYM });
  const [five, setFive] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In their own words: health, goals, past setbacks, schedule.
  const [about, setAbout] = useState('');
  const [intake, setIntake] = useState<{ text: string; result: IntakeResult } | null>(null);
  const [intakeNote, setIntakeNote] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<PlanView | null>(null);
  const steps = ['goals', 'schedule', 'equipment', 'body', 'lifts'] as const;

  /** Fill in the next steps from what the coach read. Choices the user made on this screen win. */
  function applyIntake(r: IntakeResult) {
    setDraft((d) => ({
      ...d,
      goal: !touched.has('goal') && r.goal ? r.goal : d.goal,
      experience: !touched.has('experience') && r.experience ? r.experience : d.experience,
      daysPerWeek: r.daysPerWeek ?? d.daysPerWeek,
      sessionMinutes: r.sessionMinutes ?? d.sessionMinutes,
      equipment: r.equipment ?? d.equipment,
      limitations: [...new Set([...d.limitations, ...r.limitations])],
      limitationNotes: d.limitationNotes || r.limitationNotes,
    }));
  }

  async function next() {
    setError(null);
    const text = about.trim();
    if (step === 0 && text && text !== intake?.text) {
      setBusy(true);
      try {
        const result = await readIntake(text);
        setIntake({ text, result });
        setIntakeNote(null);
        applyIntake(result);
      } catch (e) {
        setIntake(null);
        setIntakeNote(e instanceof CoachNotConfiguredError
          ? 'The AI coach isn\'t set up yet, so I couldn\'t read that automatically. Fill in the next few steps instead.'
          : `I couldn't read that automatically (${(e as Error).message}). Fill in the next few steps instead.`);
      } finally {
        setBusy(false);
      }
    }
    setStep(step + 1);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fiveRMs = Object.fromEntries(LIFTS.map((l) => [l.key, Number(five[l.key]) > 0 ? Number(five[l.key]) : null]));
      await completeOnboarding({ ...draft, onboarded: true }, fiveRMs, intake?.text === about.trim() ? intake.result.healthNotes : []);
      const [stored, view] = await Promise.all([getProgram(), getProgramView(localDate())]);
      const basic = basicPlanExplanation(draft, stored!.program);
      let explanation = basic;
      let byCoach = false;
      let note: string | null = null;
      if (about.trim()) {
        try {
          explanation = (await explainPlan(about.trim())).content;
          byCoach = true;
        } catch {
          note = 'The coach couldn\'t write a personal explanation right now, so here\'s the short version. You can ask it about your plan any time.';
        }
      }
      setPlan({ explanation, byCoach, note, days: view?.days ?? [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    await refreshProfile();
    navigate('/', { replace: true });
  }

  if (plan) {
    return (
      <div className="stack">
        <h1>Your plan</h1>
        {plan.note && <p className="notice">{plan.note}</p>}
        <div className="card">
          <Markdown text={plan.explanation} />
          {plan.byCoach && <div className="tiny muted" style={{ marginTop: 6 }}>Written by your coach from what you told it. It's also saved in the Coach tab, so you can ask follow-up questions.</div>}
        </div>
        {plan.days.map((d) => (
          <div key={d.dayIndex} className="card tight">
            <b>{d.key} · {d.name}</b>
            <div className="small muted">{d.exercises.map((e) => `${e.name}${e.tier === 'T3' ? '' : ` (${e.scheme})`}`).join(' · ')}</div>
          </div>
        ))}
        <button className="btn primary block" onClick={start}>Start training</button>
        <p className="small muted center">You can swap any exercise on the Program page, or ask the coach to adjust things.</p>
      </div>
    );
  }

  const current = steps[step];
  return (
    <div className="stack">
      <div className="steps">{steps.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}</div>
      <h1>{['What are you training for?', 'Your schedule', 'Equipment & joints', 'About you', 'Your current strength'][step]}</h1>
      {step > 0 && step < 4 && intake && (
        <div className="notice">
          {intake.result.summary || 'I\'ve read what you wrote.'} I've filled in the answers below; change anything that's off.
        </div>
      )}
      {step === 1 && intakeNote && <div className="notice">{intakeNote}</div>}
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
        <ProfileFields draft={draft} section={current} set={(d) => {
          if (step === 0) {
            const t = new Set(touched);
            if (d.goal !== draft.goal) t.add('goal');
            if (d.experience !== draft.experience) t.add('experience');
            setTouched(t);
          }
          setDraft(d);
        }} />
      )}
      {step === 0 && (
        <label className="field">
          <span>Or tell me in your own words <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
          <span className="small muted" style={{ fontWeight: 400 }}>
            Your current health, what you want to achieve, injuries or past setbacks, how often you can train. I'll set up the
            next steps from it and explain why your plan fits you.
          </span>
          <textarea className="about-box" rows={6} maxLength={2000} placeholder={ABOUT_PLACEHOLDER} value={about} onChange={(e) => setAbout(e.target.value)} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
        {step < steps.length - 1
          ? <button className="btn primary grow" onClick={next} disabled={busy}>{busy ? 'Reading what you wrote…' : 'Next'}</button>
          : <button className="btn primary grow" onClick={submit} disabled={busy}>{busy ? 'Building your plan…' : 'Build my program'}</button>}
      </div>
    </div>
  );
}
