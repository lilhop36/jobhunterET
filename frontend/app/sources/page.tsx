'use client';

import { FormEvent, useState, useEffect } from 'react';
import { ChevronDown, History, Zap, RefreshCw } from 'lucide-react';
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
  healthScore: number | null;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  runs: SourceRun[];
}

interface QueueStats {
  running: number;
  pending: number;
  completed: number;
  failed: number;
  history: {
    sourceId: string;
    status: string;
    jobsFetched: number;
    jobsCreated: number;
    duration: number;
    timestamp: string;
    error?: string;
  }[];
}

const TIER_COLORS: Record<string, string> = {
  ETHIOPIA: '#22c55e',
  REMOTE: '#3b82f6',
  INTERNATIONAL: '#8b5cf6',
};

function HealthBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700,
      background: color + '18', color, border: `1px solid ${color}30`,
    }}>
      {score >= 80 ? '●' : score >= 50 ? '◐' : '○'} {score}%
    </span>
  );
}

export default function SourcesPage() {
  const { api, user } = useAuth();
  const { data, err, loading, reload } = useApi<Source[]>('/api/sources');
  const { data: queueStats, reload: reloadQueue } = useApi<QueueStats>('/api/sources/queue/stats');
  const { data: healthData } = useApi<any[]>('/api/sources/health');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collectAllBusy, setCollectAllBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', baseUrl: '', type: 'JSON', priorityTier: 'ETHIOPIA' });

  // Auto-refresh queue stats while collection is running
  useEffect(() => {
    if (!queueStats || (queueStats.running === 0 && queueStats.pending === 0)) return;
    const iv = setInterval(reloadQueue, 3000);
    return () => clearInterval(iv);
  }, [queueStats, reloadQueue]);

  const collect = async (id: string, name: string) => {
    setBusyId(id);
    setResult(null);
    try {
      const r = await api(`/api/sources/${id}/collect`, { method: 'POST' });
      setResult(`${name}: ${r.message ?? r.status} — fetched ${r.jobsFetched ?? 0}, created ${r.jobsCreated ?? 0}, delivered ${r.delivered ?? 0}`);
      reload();
      reloadQueue();
    } catch (e: any) {
      setResult(`${name}: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const collectAll = async () => {
    setCollectAllBusy(true);
    setResult(null);
    try {
      const r = await api('/api/sources/collect-all', { method: 'POST' });
      setResult(`Queued ${r.enqueued} sources for collection`);
      reloadQueue();
    } catch (e: any) {
      setResult(`Collect all failed: ${e.message}`);
    } finally {
      setCollectAllBusy(false);
    }
  };

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
        <div className="error-box">403 — source management is restricted to ADMIN users.</div>
      </RequireAuth>
    );
  }

  const activeCount = data?.filter((s) => s.status === 'ACTIVE').length ?? 0;
  const totalSources = data?.length ?? 0;
  const healthSources = data?.filter((s) => s.healthScore !== null) ?? [];
  const avgHealth = healthSources.length > 0
    ? healthSources.reduce((a, s) => a + (s.healthScore ?? 0), 0) / healthSources.length
    : 0;

  return (
    <RequireAuth>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Job Sources</h1>
        <button className="btn ghost small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New source'}
        </button>
      </div>
      <p className="subtitle">Manage sources, run collections, and check health.</p>

      {result && (
        <div className={result.includes('FAIL') || result.includes('failed') ? 'error-box' : 'ok-box'}
          style={{ cursor: 'pointer' }} onClick={() => setResult(null)}>
          {result}
        </div>
      )}
      {err && <ErrorBox msg={err} onRetry={reload} />}

      
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'hsl(var(--muted-fg))' }}>Sources</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{activeCount} <span style={{ fontSize: 14, fontWeight: 400, color: 'hsl(var(--muted-fg))' }}>/ {totalSources}</span></div>
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-fg))' }}>active / total</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'hsl(var(--muted-fg))' }}>Avg Health</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              <HealthBadge score={Math.round(avgHealth)} />
            </div>
          </div>
          <button
            className="btn"
            disabled={collectAllBusy}
            onClick={collectAll}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Zap size={14} />
            {collectAllBusy ? 'Queuing…' : 'Collect All'}
          </button>
        </div>

        <div className="card">
          <div style={{ fontSize: 13, color: 'hsl(var(--muted-fg))', marginBottom: 4 }}>Collection Queue</div>
          {queueStats ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>{queueStats.running}</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Running</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{queueStats.pending}</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Pending</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{queueStats.completed}</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>OK</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{queueStats.failed}</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Failed</div>
              </div>
              <button className="btn ghost small" onClick={reloadQueue} title="Refresh stats">
                <RefreshCw size={14} />
              </button>
            </div>
          ) : (
            <div className="muted">No collection runs yet</div>
          )}
          {queueStats && queueStats.history.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, maxHeight: 100, overflow: 'auto' }}>
              {queueStats.history.slice(0, 5).map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px solid hsl(var(--border))' }}>
                  <span style={{ fontWeight: 600, minWidth: 90 }}>{h.sourceId}</span>
                  <StatusPill status={h.status} />
                  <span className="muted">{h.jobsCreated} new</span>
                  <span className="muted">{h.duration}ms</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
                <option>TELEGRAM</option>
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
            <button className="btn" type="submit">Create source</button>
          </div>
        </form>
      )}

      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <Loading />}
        {data?.map((s) => {
          const tierColor = TIER_COLORS[s.priorityTier] ?? '#6b7280';
          const lastRun = s.runs[0];
          return (
            <div key={s.id} className="card" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {/* Source name + tier */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                      background: tierColor + '18', color: tierColor, border: `1px solid ${tierColor}30`,
                    }}>
                      {s.priorityTier}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{s.type}</span>
                  </div>
                  <div className="meta" style={{ fontSize: 12, marginTop: 2 }}>
                    {s.baseUrl.length > 60 ? s.baseUrl.slice(0, 60) + '…' : s.baseUrl}
                  </div>
                </div>

                {/* Health */}
                <div style={{ minWidth: 60, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Health</div>
                  <HealthBadge score={s.healthScore} />
                </div>

                {/* Last run */}
                <div style={{ minWidth: 100, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Last OK</div>
                  <div style={{ fontSize: 13 }}>{fmtDate(s.lastSuccessfulRun)}</div>
                </div>

                {/* Consecutive failures */}
                {s.consecutiveFailures > 0 && (
                  <div style={{ minWidth: 60, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'hsl(var(--muted-fg))' }}>Fails</div>
                    <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>{s.consecutiveFailures}</div>
                  </div>
                )}

                {/* Status */}
                <StatusPill status={s.status} />

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={`btn small ${busyId === s.id ? '' : 'ghost'}`}
                    disabled={busyId === s.id || s.status !== 'ACTIVE'}
                    onClick={() => collect(s.id, s.name)}
                    title="Collect now"
                  >
                    {busyId === s.id ? '…' : 'Collect'}
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={busyId === s.id}
                    onClick={() => toggle(s)}
                    title={s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    style={{ color: s.status === 'ACTIVE' ? '#ef4444' : '#22c55e' }}
                  >
                    {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => setOpenHistory(openHistory === s.id ? null : s.id)}
                    aria-expanded={openHistory === s.id}
                    title="Run history"
                  >
                    <History size={14} />
                    <ChevronDown size={14} style={{ transform: openHistory === s.id ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
                  </button>
                </div>
              </div>

              {/* Last error */}
              {s.lastError && (
                <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: '#ef444410', border: '1px solid #ef444430', fontSize: 12, color: '#ef4444' }}>
                  {s.lastError.length > 120 ? s.lastError.slice(0, 120) + '…' : s.lastError}
                </div>
              )}

              {/* Latest run stats */}
              {lastRun && (
                <div style={{ marginTop: 6, display: 'flex', gap: 12, fontSize: 12, color: 'hsl(var(--muted-fg))' }}>
                  <span>Fetched: <b>{lastRun.jobsFetched}</b></span>
                  <span>Created: <b style={{ color: '#22c55e' }}>{lastRun.jobsCreated}</b></span>
                  <span>Dupes: <b>{lastRun.duplicates}</b></span>
                  {lastRun.errors > 0 && <span>Errors: <b style={{ color: '#ef4444' }}>{lastRun.errors}</b></span>}
                </div>
              )}

              {/* Run history drawer */}
              {openHistory === s.id && (
                <div style={{ marginTop: 8, background: 'hsl(var(--muted) / 0.3)', borderRadius: 6, padding: 8 }}>
                  {s.runs.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>No collection runs recorded yet.</p>
                  ) : (
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Started</th>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Status</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Fetched</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Created</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Dupes</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Errors</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.runs.map((r) => (
                          <tr key={r.id} style={{ borderTop: '1px solid hsl(var(--border) / 0.5)' }}>
                            <td style={{ padding: '3px 8px' }}>{new Date(r.startedAt).toLocaleString()}</td>
                            <td style={{ padding: '3px 8px' }}>
                              <StatusPill status={r.status} />
                              {r.errorMessage && (
                                <span className="muted" style={{ display: 'block', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {r.errorMessage}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', padding: '3px 8px' }}>{r.jobsFetched}</td>
                            <td style={{ textAlign: 'right', padding: '3px 8px', color: '#22c55e' }}>{r.jobsCreated}</td>
                            <td style={{ textAlign: 'right', padding: '3px 8px' }}>{r.duplicates}</td>
                            <td style={{ textAlign: 'right', padding: '3px 8px', color: r.errors > 0 ? '#ef4444' : undefined }}>{r.errors}</td>
                            <td style={{ textAlign: 'right', padding: '3px 8px' }}>
                              {r.finishedAt ? `${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : '…'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {data && data.length === 0 && !loading && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p className="muted">No sources yet. Click "+ New source" to add one.</p>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
