'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { RequireAuth, ErrorBox, Loading, StatusPill, fmtDate } from '../../../lib/ui';

interface UserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  lastActiveAt: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { api, user } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/admin/users');
      setUsers(data);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Load on mount
  if (!users && !err && loading) {
    load();
  }

  if (user?.role !== 'ADMIN') {
    return (
      <RequireAuth>
        <h1>Admin — Users</h1>
        <div className="error-box">403 — admin access required (FR-002f).</div>
      </RequireAuth>
    );
  }

  const toggleStatus = async (u: UserRow) => {
    const next = u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusyId(u.id);
    setResult(null);
    try {
      await api(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      setResult(`${u.email}: ${next === 'ACTIVE' ? 'enabled' : 'disabled'}.`);
      load();
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = async (u: UserRow, newRole: string) => {
    setBusyId(u.id);
    setResult(null);
    try {
      await api(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      setResult(`${u.email}: role changed to ${newRole}.`);
      load();
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (u: UserRow) => {
    setBusyId(u.id);
    setTempPassword(null);
    setResult(null);
    try {
      const r = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
      setTempPassword(r.temporaryPassword);
      setResult(`Password reset for ${u.email}. Share the temporary password securely.`);
      setResetTarget(u.id);
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = () => {
    if (tempPassword) navigator.clipboard.writeText(tempPassword);
  };

  return (
    <RequireAuth>
      <h1>Admin — Users</h1>
      <p className="subtitle">User metadata only — never CV contents, matches, or notifications (FR-002f).</p>

      {result && <div className={result.startsWith('Error') ? 'error-box' : 'ok-box'}>{result}</div>}
      {err && <ErrorBox msg={err} onRetry={load} />}
      {loading && <Loading />}

      {tempPassword && resetTarget && (
        <div className="card" style={{ border: '2px solid hsl(var(--primary))' }}>
          <h2>Temporary Password</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <code style={{ fontSize: 16, letterSpacing: 1, flex: 1 }}>{tempPassword}</code>
            <button className="btn ghost small" onClick={copyPassword}>
              Copy
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Share this with the user securely. They must change it on next login. (FR-002f assisted reset)
          </p>
          <button className="btn ghost small" onClick={() => { setTempPassword(null); setResetTarget(null); }}>
            Dismiss
          </button>
        </div>
      )}

      {users && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
            {/* Header */}
            <div style={{ fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Email</div>
            <div style={{ fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Role</div>
            <div style={{ fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Status</div>
            <div style={{ fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Last Active</div>
            <div style={{ fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Actions</div>

            {users.map((u) => (
              <div key={u.id} style={{ display: 'contents' }}>
                <div>
                  <div>{u.email}</div>
                  <div className="muted" style={{ fontSize: 11 }}>since {fmtDate(u.createdAt)}</div>
                </div>
                <div>
                  <select
                    value={u.role}
                    disabled={busyId === u.id || u.id === user?.id}
                    onChange={(e) => changeRole(u, e.target.value)}
                    style={{ fontSize: 12, padding: '2px 4px' }}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
                <div>
                  <StatusPill status={u.status} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {u.lastActiveAt ? fmtDate(u.lastActiveAt) : 'never'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {u.id !== user?.id && (
                    <>
                      <button
                        className="btn ghost small"
                        disabled={busyId === u.id}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={busyId === u.id}
                        onClick={() => resetPassword(u)}
                      >
                        Reset PW
                      </button>
                    </>
                  )}
                  {u.id === user?.id && <span className="muted" style={{ fontSize: 11 }}>you</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </RequireAuth>
  );
}
