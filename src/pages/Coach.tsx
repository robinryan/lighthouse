import { useSearchParams } from 'react-router';
import { CoachChat } from '../components/CoachChat';

const SUGGESTIONS = [
  'Review my program for my goals',
  'My shoulder clicks when I bench — what should I change?',
  'How should I warm up for heavy squats?',
  'I keep stalling on overhead press. Ideas?',
];

export function CoachPage() {
  const [params] = useSearchParams();
  return (
    <div className="stack" style={{ minHeight: 'calc(100dvh - 140px)' }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>Coach</h1>
          <p className="small muted" style={{ margin: 0 }}>Research-backed answers, with changes you approve. Not medical advice.</p>
        </div>
      </div>
      <CoachChat workoutId={null} suggestions={SUGGESTIONS} initialPrompt={params.get('prompt') ?? undefined} />
    </div>
  );
}
