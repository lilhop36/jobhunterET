'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
    } catch (ex: any) {
      setErr(ex.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <h1>JobHunter</h1>
      <p className="muted center">Your personal job-search agent for Ethiopia.</p>
      <form className="card auth-box" onSubmit={submit}>
        {err && <div className="error-box">{err}</div>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
      <p className="muted center" style={{ fontSize: 13 }}>
        No account? <Link href="/register">Register</Link>
      </p>
    </div>
  );
}
