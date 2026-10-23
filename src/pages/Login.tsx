import { useState } from 'react';
import { db, siteUrl } from '../api';

type Mode = 'login' | 'magic' | 'register' | 'reset';

export function LoginPage({ linkError = null }: { linkError?: string | null }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  /** A magic link was sent: show the code box. */
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(linkError);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const auth = db().auth;
    await run(async () => {
      if (mode === 'login') {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'magic') {
        if (linkSent) {
          const { error } = await auth.verifyOtp({ email, token: code.trim(), type: 'email' });
          if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Send a new link and try again.' : error.message);
          return;
        }
        // Only existing accounts: new people sign up with a name and password first.
        const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: siteUrl(), shouldCreateUser: false } });
        // Don't reveal whether an address has an account.
        if (error && !/signups? not allowed|not found/i.test(error.message)) throw error;
        setLinkSent(true);
        setInfo('If that email has an account, a sign-in link is on its way. Tap the link on this device, or enter the code from the email.');
      } else if (mode === 'register') {
        const { data, error } = await auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: siteUrl() } });
        if (error) throw error;
        // With email confirmation on, there's no session until the link is clicked.
        if (!data.session) setInfo('Check your email for a confirmation link, then sign in.');
      } else {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
        if (error) throw error;
        setInfo('If that email has an account, a reset link is on its way. Open it to choose a new password.');
      }
    });
  }

  const switchTo = (m: Mode) => { setMode(m); setError(null); setInfo(null); setLinkSent(false); setCode(''); };

  const button = mode === 'login' ? 'Sign in'
    : mode === 'magic' ? (linkSent ? 'Sign in with code' : 'Email me a sign-in link')
    : mode === 'register' ? 'Create account' : 'Send reset link';

  return (
    <div className="auth stack">
      <div className="center brand">
        <img src="/icon-192.png" alt="" className="logo" />
        <h1 className="wordmark">Gym <span>Bestie</span></h1>
        <p className="muted">Your training buddy: a plan built around you, a logbook, and a coach in your pocket.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        {mode === 'register' && (
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
        )}
        <label className="field"><span>Email</span>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setLinkSent(false); }} autoComplete="email" required />
        </label>
        {(mode === 'login' || mode === 'register') && (
          <label className="field"><span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
        )}
        {mode === 'magic' && linkSent && (
          <label className="field"><span>Code from the email</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              autoComplete="one-time-code" pattern="\d{6,10}" maxLength={10} placeholder="123456" required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {info && <p className="notice">{info}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? '…' : button}</button>
        {mode === 'magic' && linkSent && (
          <button type="button" className="link-btn small" disabled={busy} onClick={() => { setLinkSent(false); setCode(''); setInfo(null); }}>
            Send a new link
          </button>
        )}
        {mode === 'login' && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="link-btn small" onClick={() => switchTo('magic')}>Email me a link</button>
            <button type="button" className="link-btn small" onClick={() => switchTo('reset')}>Forgot password?</button>
          </div>
        )}
        {(mode === 'magic' || mode === 'reset') && (
          <button type="button" className="link-btn small" onClick={() => switchTo('login')}>Sign in with a password</button>
        )}
      </form>
      <p className="center small">
        {mode === 'register' ? 'Have an account? ' : 'New here? '}
        <button className="link-btn" onClick={() => switchTo(mode === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </div>
  );
}

/** Shown after opening a password-reset link: the link signed the user in; now pick a new password. */
export function NewPasswordPage({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await db().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <div className="auth stack">
      <div className="center">
        <img src="/icon-192.png" alt="" className="logo" />
        <h1 style={{ marginTop: 12 }}>Choose a new password</h1>
      </div>
      <form className="card stack" onSubmit={submit}>
        <label className="field"><span>New password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy || pw.length < 8}>{busy ? '…' : 'Save password'}</button>
        <button type="button" className="link-btn small" onClick={onDone}>Skip for now</button>
      </form>
    </div>
  );
}
