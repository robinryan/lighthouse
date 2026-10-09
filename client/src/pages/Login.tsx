import { useState } from 'react';
import { api, type User } from '../api';
import { useAsync } from '../hooks';

export function LoginPage({ onAuthed }: { onAuthed: (u: User) => void }) {
  const { data: cfg } = useAsync(() => api.get<{ signupOpen: boolean; inviteRequired: boolean }>('/auth/config'), []);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'login'
        ? await api.post<User>('/auth/login', { email, password })
        : await api.post<User>('/auth/register', { email, password, name, inviteCode: invite || undefined });
      onAuthed(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </label>
        {mode === 'register' && cfg?.inviteRequired && (
          <label className="field"><span>Invite code</span><input value={invite} onChange={(e) => setInvite(e.target.value)} required /></label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      {cfg?.signupOpen !== false && (
        <p className="center small">
          {mode === 'login' ? 'New here? ' : 'Have an account? '}
          <button className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      )}
    </div>
  );
}
