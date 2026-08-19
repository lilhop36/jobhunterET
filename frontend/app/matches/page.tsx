'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, EmptyState, fmtDate } from '../../lib/ui';

interface Match {
  jobId: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  summary: string;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    employmentType: string;
    experienceLevel: string;
    url: string;
    status: string;
    source: string;
    postedDate: string;
  };
}

interface MatchPage {
  items: Match[];
  nextCursor: string | null;
  total: number;
}

const FILTERS = ['ALL', 'EXCELLENT', 'STRONG', 'GOOD', 'UNSEEN'];

export default function MatchesPage() {
  const { api } = useAuth();
  const [filter, setFilter] = useState('ALL');
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const { data, err, loading, reload } = useApi<MatchPage>(`/api/matches?filter=${filter}`);
  const items = data?.items ?? [];

  const recalc = async () => {
    setRecalcMsg(null);
    try {
      const r = await api('/api/matches/recalculate', { method: 'POST' });
      setRecalcMsg(`Recalculated — ${r.matchesTouched} matches touched, ${r.notificationsDelivered} delivered.`);
      reload();
    } catch (e: any) {
      setRecalcMsg(e.message);
    }
  };

  return (
    <RequireAuth>
      <h1>Your matches</h1>
      <p className="subtitle">Every job scored against your profile, with reasons you can see (FR-019a).</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`btn ghost small ${filter === f ? 'active-filter' : ''}`}
            onClick={() => setFilter(f)}
            style={filter === f ? { background: '#eef2ff', borderColor: '#c7d2fe' } : {}}
          >
            {f}
          </button>
        ))}
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={recalc}>
          Recalculate now
        </button>
      </div>
      {recalcMsg && <div className={recalcMsg.startsWith('Recalculated') ? 'ok-box' : 'error-box'}>{recalcMsg}</div>}
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && items.length === 0 && (
          <EmptyState
            icon="🎯"
            title={filter === 'UNSEEN' ? 'Nothing unseen' : 'No matches here yet'}
            message={
              filter === 'UNSEEN'
                ? 'Every match has already been sent to your Inbox or Telegram. New jobs will appear here as they are collected.'
                : 'Match scores update on each collection cycle — check back after the next run, or hit Recalculate now.'
            }
            action={filter === 'UNSEEN' ? 'Browse all matches' : 'Recalculate now'}
            actionHref={filter === 'UNSEEN' ? '/matches' : undefined}
          />
        )}
        {items.map((m) => (
          <Link key={m.jobId} href={`/jobs/${m.jobId}`} className="job-row" style={{ alignItems: 'flex-start' }}>
            <ScoreBadge score={m.score} />
            <div className="info">
              <div className="title">{m.job.title}</div>
              <div className="meta">
                {m.job.company} · {m.job.location} · {m.job.employmentType} · posted {fmtDate(m.job.postedDate)}
              </div>
              <ul className="clean" style={{ marginTop: 6 }}>
                {m.reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </Link>
        ))}
      </div>
    </RequireAuth>
  );
}
