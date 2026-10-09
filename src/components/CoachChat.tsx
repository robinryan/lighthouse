import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyAction, askCoach, CoachNotConfiguredError, listMessages, type CoachMessage } from '../api';
import { useAsync, useOnline } from '../hooks';

/** Tiny, safe markdown subset: paragraphs, bullet/numbered lists, **bold**, headings rendered bold. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
function Markdown({ text }: { text: string }) {
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

export function CoachChat({ workoutId, suggestions, onApplied, initialPrompt }: {
  workoutId: number | null; suggestions: string[]; onApplied?: () => void; initialPrompt?: string;
}) {
  const { data, setData, reload, error: loadError } = useAsync(async () => ({ messages: await listMessages(workoutId) }), [workoutId]);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [text, setText] = useState(initialPrompt ?? '');
  const [sending, setSending] = useState(false);
  const [research, setResearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const online = useOnline();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [data?.messages.length, sending]);

  async function send(msg: string) {
    const body = msg.trim();
    if (!body || sending || !data) return;
    setSending(true);
    setError(null);
    setText('');
    const optimistic: CoachMessage = { id: -Date.now(), role: 'user', content: body, createdAt: '', actions: [], sources: [], costUsd: null, effort: null, webSearches: 0 };
    setData({ ...data, messages: [...data.messages, optimistic] });
    try {
      await askCoach(workoutId, body, research);
      setResearch(false);
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

  async function act(m: CoachMessage, index: number, dismiss: boolean) {
    try {
      const updated = await applyAction(m.id, index, dismiss);
      setData((d) => d && {
        ...d,
        messages: d.messages.map((x) => (x.id === m.id ? { ...x, actions: x.actions.map((a, i) => (i === index ? updated : a)) } : x)),
      });
      if (!dismiss) onApplied?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat" style={{ overflowY: 'auto', flex: 1, minHeight: 120 }}>
        {data.messages.length === 0 && (
          <p className="muted small">
            Ask anything — "my elbow hurts on bench", "what stretches before squats?", "why did my weight drop?". I can research,
            swap exercises, lighten loads, and add mobility work. You approve every change.
          </p>
        )}
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            {m.actions.map((a, i) => (
              <div key={i} className="action-card">
                <div style={{ fontWeight: 600, fontSize: 14 }}>{a.label}</div>
                {(a.reason || a.note) && <div className="small muted">{a.reason || a.note}</div>}
                <div className="row" style={{ marginTop: 6 }}>
                  {a.type === 'health' ? (
                    a.status === 'applied'
                      ? <><span className="small muted">✓ Saved</span><button className="btn sm ghost" onClick={() => act(m, i, true)}>Undo</button></>
                      : <span className="small muted">Removed</span>
                  ) : a.status === 'pending' ? (
                    <>
                      <button className="btn sm primary" onClick={() => act(m, i, false)}>Apply</button>
                      <button className="btn sm ghost" onClick={() => act(m, i, true)}>Dismiss</button>
                    </>
                  ) : (
                    <span className="small muted">{a.status === 'applied' ? '✓ Applied' : 'Dismissed'}</span>
                  )}
                </div>
              </div>
            ))}
            {m.role === 'assistant' && m.costUsd != null && (
              <div className="tiny muted" style={{ marginTop: 4 }}>
                ≈ ${m.costUsd < 0.01 ? '<0.01' : m.costUsd.toFixed(2)}{m.effort === 'low' ? ' · quick answer' : ''}{m.webSearches ? ` · ${m.webSearches} search${m.webSearches > 1 ? 'es' : ''}` : ''}
              </div>
            )}
            {m.sources.length > 0 && (
              <div className="sources">
                <div className="muted">Sources</div>
                {m.sources.slice(0, 6).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>)}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="bubble assistant">
            <div className="typing"><span /><span /><span /></div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{research ? 'Researching — can take ~30s' : 'Thinking…'}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <p className="error">{error}</p>}
      {notConfigured && (
        <div className="notice">
          {notConfigured} See the README's "AI coach" section: deploy the <code>coach</code> edge function and add your
          <code> ANTHROPIC_API_KEY</code> under Supabase → Edge Functions → Secrets.
        </div>
      )}
      {data.messages.length === 0 && !sending && (
        <div className="chips">
          {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={`chip ${research ? 'on' : ''}`} onClick={() => setResearch((v) => !v)} aria-pressed={research}
          title="Search reputable sources for evidence (slower, costs a little more)">
          🔎 Research{research ? ' on' : ''}
        </button>
        <span className="tiny muted">{research ? 'Will search studies & clinical sources' : 'Answers from training knowledge'}</span>
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea
          rows={1}
          placeholder={online ? 'e.g. My elbow hurts today — what should I do instead?' : 'Offline — coach unavailable'}
          value={text}
          disabled={!online}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
        />
        <button className="btn primary" disabled={sending || !text.trim() || !online}>Send</button>
      </form>
    </div>
  );
}
