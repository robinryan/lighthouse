import { useEffect, useRef, useState } from 'react';
import { EXERCISE_TIPS, videoUrl } from '../api';
import { EXERCISES } from '../../supabase/functions/_shared/exercises.ts';
import { EXERCISE_VIDEOS } from '../../supabase/functions/_shared/exerciseVideos.ts';
import { STRETCH_DOSE } from '../../supabase/functions/_shared/stretches.ts';
import { Sheet } from './Sheet';

// Open the demo for an exercise from anywhere: openDemo('squat').
const EVENT = 'lh-demo';
export function openDemo(exerciseIdOrName: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: exerciseIdOrName }));
}

// Minimal typing for the YouTube IFrame Player API.
interface YTPlayer { destroy(): void }
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube unavailable')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Click-to-load YouTube player (nothing is downloaded until the user taps Play). */
function Player({ videoId, title, fallbackUrl }: { videoId: string; title: string; fallbackUrl: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);

  useEffect(() => () => player.current?.destroy(), []);

  async function play() {
    setState('loading');
    try {
      await loadYouTubeApi();
      if (!host.current || !window.YT) throw new Error('no player');
      player.current = new window.YT.Player(host.current, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => setState('playing'),
          // 2 bad id, 5 HTML5 error, 100 removed/private, 101/150 embedding disabled.
          onError: () => setState('error'),
        },
      });
    } catch {
      setState('error');
    }
  }

  if (state === 'error') {
    return (
      <div className="video-box video-fallback">
        <p className="small">This video can't play here.</p>
        <a className="btn primary" href={fallbackUrl} target="_blank" rel="noreferrer noopener">Search on YouTube</a>
      </div>
    );
  }
  return (
    <div className="video-box">
      <div ref={host} className="video-frame" />
      {state !== 'playing' && (
        <button className="video-play" onClick={play} disabled={state === 'loading'} aria-label={`Play demo: ${title}`}>
          <svg viewBox="0 0 68 48" width="68" height="48" aria-hidden="true"><path d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3S12.8.3 7.5 1.7A8.5 8.5 0 0 0 1.5 7.7C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#f00" /><path d="M45 24 27 14v20z" fill="#fff" /></svg>
          <span className="small">{state === 'loading' ? 'Loading…' : 'Play demo'}</span>
        </button>
      )}
    </div>
  );
}

/** Mount once (in App). Shows the demo, tips and dose for an exercise in a bottom sheet. */
export function DemoHost() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!target) return null;
  const ex = EXERCISES.find((e) => e.id === target || e.name === target);
  const name = ex?.name ?? target;
  const video = ex ? EXERCISE_VIDEOS[ex.id] : undefined;
  const tips = ex ? EXERCISE_TIPS[ex.id] ?? [] : [];
  const dose = ex ? STRETCH_DOSE[ex.id] : undefined;
  return (
    <Sheet onClose={() => setTarget(null)} title={name}>
      {video
        ? <Player key={video.videoId} videoId={video.videoId} title={video.title} fallbackUrl={videoUrl(name)} />
        : (
          <div className="video-box video-fallback">
            <p className="small">No demo saved for this one yet.</p>
            <a className="btn primary" href={videoUrl(name)} target="_blank" rel="noreferrer noopener">Search on YouTube</a>
          </div>
        )}
      {video && <p className="tiny muted" style={{ margin: '6px 0 0' }}>{video.title} · {video.channel}</p>}
      {dose && <p className="small" style={{ margin: '10px 0 0' }}><b>How long:</b> {dose.text}</p>}
      {tips.length > 0 && (
        <>
          <h3 style={{ margin: '12px 0 4px' }}>Form tips</h3>
          <ul className="tips" style={{ fontSize: 15 }}>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {ex && <p className="small muted" style={{ marginTop: 8 }}>{ex.cues}</p>}
      {video && (
        <a className="small" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer noopener">Open in YouTube</a>
      )}
    </Sheet>
  );
}
