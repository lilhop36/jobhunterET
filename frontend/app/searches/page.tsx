'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { History, Plus, Trash2, Zap } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, StatusPill, fmtDate } from '../../lib/ui';

interface SavedSearch {
  id: string;
  name: string;
  q: string | null;
  tier: string;
  remote: boolean;
  createdAt: string;
}

interface DigestStatus {
  enabled: boolean;
  last: {
    at: string;
    status: string;
    deliveredTo: string;
    jobsCollected: number;
    newJobs: number;
    strongMatches: number;
    topMatches: { jobId: string; title: string; company: string; score: number }[];
    searches: { name: string; hits: number }[];
  } | null;
}

const TIERS = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];

export default function SearchesPage() {
  const { api } = useAuth();
  const { data, err, loading, reload } = useApi<SavedSearch[]>('/api/searches');
  const { data: digest, loading: digestLoading, reload: reloadDigest } = useApi<DigestStatus>('/api/digest');
  const [running, setRunning] = useState(false);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('ALL');
  const [remote, setRemote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormErr(null);
    try {
      await api('/api/searches', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), q: q.trim() || undefined, tier, remote }),
      });
      setName('');
      setQ('');
      setTier('ALL');
      setRemote(false);
      reload();
    } catch (e2: any) {
      setFormErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/searches/${id}`, { method: 'DELETE' });
      reload();
    } catch (e2: any) {
      setFormErr(e2.message);
    }
  };

  const runDigest = async () => {
    setRunning(true);
    setFormErr(null);
    try {
      await api('/api/digest/run', { method: 'POST' });
      reloadDigest();
    } catch (e2: any) {
      setFormErr(e2.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <RequireAuth>
      <h1>Saved searches</h1>
      <p className="subtitle">Bookmark the queries that matter so you never miss a posting.</p>

      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            Daily digest{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
             
            </span>
          </h2>
          <button className="btn" disabled={running || digestLoading} onClick={runDigest}>
            <Zap className="h-4 w-4" /> {running ? 'Running…' : 'Run now'}
          </button>
        </div>
        {digest && !digest.enabled && (
          <p className="muted" style={{ marginTop: 10 }}>
            The digest is currently <strong>off</strong> — enable it in{' '}
            <Link href="/settings">Settings</Link>.
          </p>
        )}
        {digestLoading ? (
          <Loading />
        ) : !digest?.last ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No digest run yet. Tap <strong>Run now</strong> to generate today&apos;s report, or wait for the
            scheduled daily run.
          </p>
        ) : (
          <>
            <div className="kv" style={{ marginTop: 12 }}>
              <span className="k">Last run</span>
              <span>
                {new Date(digest.last.at).toLocaleString()}{' '}
                <StatusPill status={digest.last.status} />{' '}
                <StatusPill status={digest.last.deliveredTo} />
              </span>
              <span className="k">Jobs collected</span>
              <span>{digest.last.jobsCollected}</span>
              <span className="k">New jobs</span>
              <span>{digest.last.newJobs}</span>
              <span className="k">Strong/excellent</span>
              <span>{digest.last.strongMatches}</span>
            </div>
            {digest.last.searches.length > 0 && (
              <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                Saved searches: {digest.last.searches.map((s) => `${s.name} → ${s.hits}`).join(' · ')}
              </p>
            )}
            {digest.last.topMatches.length > 0 && (
              <div className="mt-2">
                {digest.last.topMatches.slice(0, 3).map((m) => (
                  <Link key={m.jobId} href={`/jobs/${m.jobId}`} className="job-row" style={{ padding: '8px 4px' }}>
                    <ScoreBadge score={m.score} />
                    <div className="info">
                      <div className="title">{m.title}</div>
                      <div className="meta">{m.company}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <form className="card" onSubmit={create}>
        <h2>New search</h2>
        {formErr && <ErrorBox msg={formErr} />}
        <div className="grid grid-2">
          <div>
            <label>Name</label>
            <input placeholder="e.g. Backend roles in Addis" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Keywords (optional)</label>
            <input placeholder="e.g. Node.js, backend" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-2">
          <div>
            <label>Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="checkbox-line" style={{ marginTop: 34 }}>
              <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
              Remote only
            </label>
          </div>
        </div>
        <button className="btn mt-3" disabled={saving || !name.trim()}>
          <Plus className="h-4 w-4" /> {saving ? 'Saving…' : 'Save search'}
        </button>
      </form>

      <div className="card">
        {data && data.length === 0 && <p className="muted">No saved searches yet — create your first one above.</p>}
        {data?.map((s) => (
          <div key={s.id} className="job-row">
            <div className="info">
              <div className="title">
                <Link href={`/jobs${s.q ? `?q=${encodeURIComponent(s.q)}` : ''}`}>{s.name}</Link>
              </div>
              <div className="meta">
                {s.q || 'All keywords'} · tier {s.tier}
                {s.remote ? ' · remote' : ''} · saved {fmtDate(s.createdAt)}
              </div>
            </div>
            <button
              className="btn ghost small"
              aria-label={`Delete ${s.name}`}
              onClick={() => remove(s.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </RequireAuth>
  );
}
