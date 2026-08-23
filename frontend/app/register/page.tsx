'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await register(email, password);
    } catch (ex: any) {
      setErr(ex.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <h1>Create account</h1>
      <p className="muted center">The first registered user becomes an admin (FR-001).</p>
      <form className="card auth-box" onSubmit={submit}>
        {err && <div className="error-box">{err}</div>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password (min 8 chars)</label>
        <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Register'}
          </button>
        </div>
      </form>
      <p className="muted center" style={{ fontSize: 13 }}>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
