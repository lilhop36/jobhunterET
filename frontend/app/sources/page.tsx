'use client';

import { FormEvent, useState } from 'react';
import { ChevronDown, History, Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, StatusPill, fmtDate } from '../../lib/ui';

interface SourceRun {
  id: string;
  status: string;
  jobsFetched: number;
  jobsCreated: number;
  duplicates: number;
  errors: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface Source {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  status: string;
  priorityTier: string;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  lastError: string | null;
  runs: SourceRun[];
}

export default function SourcesPage() {
  const { api, user } = useAuth();
  const { data, err, loading, reload } = useApi<Source[]>('/api/sources');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', baseUrl: '', type: 'JSON', priorityTier: 'ETHIOPIA' });

  const collect = async (id: string, name: string) => {
    setBusyId(id);
    setResult(null);
    try {
      const r = await api(`/api/sources/${id}/collect`, { method: 'POST' });
      setResult(`${name}: ${r.message ?? r.status} — fetched ${r.jobsFetched ?? 0}, created ${r.jobsCreated ?? 0}, delivered ${r.delivered ?? 0}`);
      reload();
    } catch (e: any) {
      setResult(`${name}: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  /** FR-007 / §32.11: enable/disable a source (ADMIN). */
  const toggle = async (s: Source) => {
    const next = s.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusyId(s.id);
    setResult(null);
    try {
      await api(`/api/sources/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      setResult(`${s.name}: ${next === 'ACTIVE' ? 'enabled' : 'disabled'}.`);
      reload();
    } catch (e: any) {
      setResult(`${s.name}: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    await api('/api/sources', { method: 'POST', body: JSON.stringify({ ...form, collectionFrequency: '30 min' }) });
    setShowForm(false);
    setForm({ name: '', baseUrl: '', type: 'JSON', priorityTier: 'ETHIOPIA' });
    reload();
  };

  if (user?.role !== 'ADMIN') {
    return (
      <RequireAuth>
        <h1>Sources</h1>
        <div className="error-box">403 — source management is restricted to ADMIN users (FR-002d).</div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Job sources</h1>
        <button className="btn ghost small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New source'}
        </button>
      </div>
      <p className="subtitle">Admin-only source management, enable/disable, and manual collection (FR-007 / FR-010).</p>

      {result && <div className={result.includes(': FAIL') ? 'error-box' : 'ok-box'}>{result}</div>}
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      {showForm && (
        <form className="card" onSubmit={create}>
          <div className="grid grid-2">
            <div>
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label>Base URL</label>
              <input required value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </div>
            <div>
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option>API</option>
                <option>RSS</option>
                <option>JSON</option>
                <option>HTML</option>
                <option>COMPANY_CAREER_PAGE</option>
              </select>
            </div>
            <div>
              <label>Priority tier</label>
              <select value={form.priorityTier} onChange={(e) => setForm({ ...form, priorityTier: e.target.value })}>
                <option>ETHIOPIA</option>
                <option>REMOTE</option>
                <option>INTERNATIONAL</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit">
              Create source
            </button>
          </div>
        </form>
      )}

      <div className="card">
        {data?.map((s) => (
          <div key={s.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="job-row" style={{ alignItems: 'flex-start' }}>
              <div className="info">
                <div className="title">
                  {s.name} <span className="muted">({s.type})</span>
                </div>
                <div className="meta">
                  {s.baseUrl} · tier {s.priorityTier} · last ok {fmtDate(s.lastSuccessfulRun)} · last fail{' '}
                  {fmtDate(s.lastFailedRun)}
                </div>
                {s.lastError && <div className="error-box" style={{ marginTop: 6 }}>{s.lastError}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    className={`btn small ${busyId === s.id ? '' : 'ghost'}`}
                    disabled={busyId === s.id || s.status !== 'ACTIVE'}
                    onClick={() => collect(s.id, s.name)}
                  >
                    {busyId === s.id ? 'Collecting…' : 'Collect now'}
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={busyId === s.id}
                    onClick={() => toggle(s)}
                    title={s.status === 'ACTIVE' ? 'Disable this source' : 'Enable this source'}
                  >
                    {busyId === s.id && openHistory !== s.id ? '…' : s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => setOpenHistory(openHistory === s.id ? null : s.id)}
                    aria-expanded={openHistory === s.id}
                  >
                    <History className="h-4 w-4" />
                    Run history {s.runs.length > 0 ? `(${s.runs.length})` : ''}
                    <ChevronDown
                      className="h-4 w-4"
                      style={{ transform: openHistory === s.id ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}
                    />
                  </button>
                </div>
              </div>
              <StatusPill status={s.status} />
            </div>

            {/* §32.11 SourceRun history drawer */}
            {openHistory === s.id && (
              <div className="card" style={{ margin: '0 6px 12px', background: 'hsl(var(--muted) / 0.4)' }}>
                {s.runs.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>No collection runs recorded yet.</p>
                ) : (
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Started</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Status</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Fetched</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Created</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Duplicates</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.runs.map((r) => (
                        <tr key={r.id} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                          <td style={{ padding: '4px 8px' }}>{new Date(r.startedAt).toLocaleString()}</td>
                          <td style={{ padding: '4px 8px' }}>
                            <StatusPill status={r.status} />
                            {r.errorMessage && (
                              <span className="muted" style={{ display: 'block', fontSize: 12 }}>{r.errorMessage}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 8px' }}>{r.jobsFetched}</td>
                          <td style={{ textAlign: 'right', padding: '4px 8px' }}>{r.jobsCreated}</td>
                          <td style={{ textAlign: 'right', padding: '4px 8px' }}>{r.duplicates}</td>
                          <td style={{ textAlign: 'right', padding: '4px 8px' }}>{r.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
        {data && data.length === 0 && <p className="muted">No sources yet.</p>}
      </div>
    </RequireAuth>
  );
}
