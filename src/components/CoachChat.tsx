import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyAction, applySessionActions, askCoach, CoachNotConfiguredError, listMessages, makeSwapPermanent, undoAction, type CoachMessage } from '../api';
import type { CoachAction } from '../data/types';
import { refreshPlan, useAsync, useOnline, usePlan } from '../hooks';

/** Tiny, safe markdown subset: paragraphs, bullet/numbered lists, **bold**, headings rendered bold. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); continue; }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(<p key={blocks.length}>{heading ? <strong>{heading[1]}</strong> : inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

const SESSION_TYPES = ['swap', 'load', 'add'];
const MODEL_NAMES: Record<string, string> = { 'claude-haiku-5-5': 'Haiku', 'claude-sonnet-5-5': 'Sonnet', 'claude-opus-5-5': 'Opus' };

/** Group the conversation into exchanges (a question and the coach's reply), newest first. */
function exchanges(messages: CoachMessage[]): CoachMessage[][] {
  const out: CoachMessage[][] = [];
  for (const m of messages) {
    if (m.role === 'user' || !out.length) out.push([m]);
    else out[out.length - 1].push(m);
  }
  return out.reverse();
}

export function CoachChat({ workoutId, suggestions, onApplied, initialPrompt }: {
  workoutId: number | null; suggestions: string[]; onApplied?: () => void; initialPrompt?: string;
}) {
  const { data, setData, reload, error: loadError } = useAsync(async () => ({ messages: await listMessages(workoutId) }), [workoutId]);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [text, setText] = useState(initialPrompt ?? '');
  const [sending, setSending] = useState(false);
  const [research, setResearch] = useState(false);
  const plan = usePlan();
  const isAdmin = plan?.tier === 'admin';
  const canResearch = plan ? plan.research : true;
  const [error, setError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const online = useOnline();

  // Newest exchange is at the top: keep it in view when one is added.
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [data?.messages.length]);

  async function send(msg: string) {
    const body = msg.trim();
    if (!body || sending || !data) return;
    setSending(true);
    setError(null);
    setText('');
    const optimistic: CoachMessage = { id: -Date.now(), role: 'user', content: body, createdAt: '', actions: [], sources: [], costUsd: null, effort: null, webSearches: 0 };
    setData({ ...data, messages: [...data.messages, optimistic] });
    try {
      const reply = await askCoach(workoutId, body, research && canResearch);
      refreshPlan();
      setResearch(false);
      // Changes to today's workout take effect right away (each can be undone).
      if (reply.actions.some((a) => a.status === 'pending' && SESSION_TYPES.includes(a.type))) {
        try {
          if (await applySessionActions(reply.id)) onApplied?.();
        } catch (e) {
          setError(`Couldn't apply the coach's changes: ${(e as Error).message}`);
        }
      }
      await reload();
    } catch (e) {
      if (e instanceof CoachNotConfiguredError) setNotConfigured(e.message);
      else setError((e as Error).message);
      setText(body);
      setData((d) => d && { ...d, messages: d.messages.filter((m) => m.id !== optimistic.id) });
    } finally {
      setSending(false);
    }
  }

  async function act(m: CoachMessage, index: number, run: () => Promise<CoachAction>, changesWorkout = true) {
    try {
      const updated = await run();
      setData((d) => d && {
        ...d,
        messages: d.messages.map((x) => (x.id === m.id ? { ...x, actions: x.actions.map((a, i) => (i === index ? updated : a)) } : x)),
      });
      if (changesWorkout) onApplied?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const actionControls = (m: CoachMessage, a: CoachAction, i: number) => {
    if (a.type === 'health') {
      return a.status === 'applied'
        ? <><span className="small muted">✓ Saved to your health profile</span><button className="btn sm ghost" onClick={() => act(m, i, () => applyAction(m.id, i, true), false)}>Undo</button></>
        : <span className="small muted">Removed</span>;
    }
    if (a.status === 'pending') {
      return (
        <>
          <button className="btn sm primary" onClick={() => act(m, i, () => applyAction(m.id, i, false))}>Apply</button>
          <button className="btn sm ghost" onClick={() => act(m, i, () => applyAction(m.id, i, true), false)}>Dismiss</button>
        </>
      );
    }
    if (a.status === 'applied' && a.undo) {
      return (
        <>
          <span className="small muted">✓ {a.type === 'swap' && a.permanent ? 'Applied — today and future sessions' : 'Applied to today\'s workout'}</span>
          {a.type === 'swap' && a.scope === 'program' && !a.permanent && (
            <button className="btn sm" onClick={() => act(m, i, () => makeSwapPermanent(m.id, i), false)}>Keep for future sessions</button>
          )}
          <button className="btn sm ghost" onClick={() => act(m, i, () => undoAction(m.id, i))}>Undo</button>
        </>
      );
    }
    return <span className="small muted">{a.status === 'applied' ? '✓ Applied' : a.status === 'undone' ? 'Undone' : 'Dismissed'}</span>;
  };

  const bubble = (m: CoachMessage) => (
    <div key={m.id} className={`bubble ${m.role}`}>
      {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
      {m.actions.map((a, i) => (
        <div key={i} className="action-card">
          <div style={{ fontWeight: 600, fontSize: 14 }}>{a.label}</div>
          {(a.reason || a.note) && <div className="small muted">{a.reason || a.note}</div>}
          <div className="row wrap" style={{ marginTop: 6 }}>{actionControls(m, a, i)}</div>
        </div>
      ))}
      {isAdmin && m.role === 'assistant' && m.costUsd != null && (
        <div className="tiny muted" style={{ marginTop: 4 }}>
          ≈ ${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(2)}{m.model ? ` · ${MODEL_NAMES[m.model] ?? m.model}` : ''}{m.route ? ` · ${m.route}` : ''}{m.webSearches ? ` · ${m.webSearches} search${m.webSearches > 1 ? 'es' : ''}` : ''}
        </div>
      )}
      {m.sources.length > 0 && (
        <div className="sources">
          <div className="muted">Sources</div>
          {m.sources.slice(0, 6).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>)}
        </div>
      )}
    </div>
  );

  const turns = exchanges(data.messages);

  return (
    <div className="stack coach-chat">
      <form className="coach-composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea
          rows={4}
          placeholder={online ? 'What\'s going on? e.g. "My elbow hurts on bench today — what should I do instead?"' : 'Offline — coach unavailable'}
          value={text}
          maxLength={1000}
          disabled={!online}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(text); } }}
        />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className={`chip ${research && canResearch ? 'on' : ''}`} onClick={() => setResearch((v) => !v)} aria-pressed={research}
            disabled={!canResearch} title={canResearch ? 'Search reputable sources for evidence (slower)' : 'Research is part of the paid plan'}>
            🔎 Research{research && canResearch ? ' on' : ''}
          </button>
          <span className="tiny muted grow">
            {!canResearch ? 'Research with studies is part of the paid plan' : research ? 'Will search studies & clinical sources' : 'Answers from training knowledge'}
          </span>
          <button className="btn primary" disabled={sending || !text.trim() || !online}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {notConfigured && (
        <div className="notice">
          {notConfigured} See the README's "AI coach" section: deploy the <code>coach</code> edge function and add your
          <code> ANTHROPIC_API_KEY</code> under Supabase → Edge Functions → Secrets.
        </div>
      )}
      {data.messages.length === 0 && !sending && (
        <>
          <div className="chips">
            {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
          </div>
          <p className="muted small">
            Ask anything: "my elbow hurts on bench", "what stretches before squats?", "why did my weight drop?". Changes to today's
            workout (swaps, lighter loads, added mobility work) are applied straight away and can be undone; changes to future sessions wait for your OK.
          </p>
        </>
      )}
      <div className="chat coach-history">
        <div ref={topRef} />
        {turns.map((turn, t) => (
          <div key={turn[0].id} className="exchange">
            {turn.map(bubble)}
            {t === 0 && sending && (
              <div className="bubble assistant">
                <div className="typing"><span /><span /><span /></div>
                <div className="tiny muted" style={{ marginTop: 4 }}>{research && canResearch ? 'Researching — can take ~30s' : 'Thinking…'}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
