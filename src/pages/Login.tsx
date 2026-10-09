import { useState } from 'react';
import { db } from '../api';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const auth = db().auth;
      if (mode === 'login') {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'register') {
        const { data, error } = await auth.signUp({
          email, password, options: { data: { name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // With email confirmation on, there's no session until the link is clicked.
        if (!data.session) setInfo('Check your email for a confirmation link, then sign in.');
      } else {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/settings` });
        if (error) throw error;
        setInfo('If that email has an account, a reset link is on its way. The link signs you in — then set a new password in Settings.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: typeof mode) => { setMode(m); setError(null); setInfo(null); };

  return (
    <div className="auth stack">
      <div className="center">
        <img src="/icon-192.png" alt="" className="logo" />
        <h1 style={{ marginTop: 12 }}>Lighthouse</h1>
        <p className="muted">Your strength program, logbook and coach.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        {mode === 'register' && (
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
        )}
        <label className="field"><span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {mode !== 'reset' && (
          <label className="field"><span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {info && <p className="notice">{info}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
        </button>
        {mode === 'login' && <button type="button" className="link-btn small" onClick={() => switchTo('reset')}>Forgot password?</button>}
      </form>
      <p className="center small">
        {mode === 'login' ? 'New here? ' : 'Have an account? '}
        <button className="link-btn" onClick={() => switchTo(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
