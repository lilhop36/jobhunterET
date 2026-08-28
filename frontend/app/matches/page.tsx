'use client';

import { useEffect, useState } from 'react';
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
  const [isRecalculating, setIsRecalculating] = useState(false);
  const { data, err, loading, reload } = useApi<MatchPage>(`/api/matches?filter=${filter}`);
  const [allItems, setAllItems] = useState<Match[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    if (data?.items) {
      setAllItems(data.items);
      setCursor(data.nextCursor);
    }
  }, [data?.items?.length, data?.nextCursor]);

  const hasMore = !!cursor;

  const loadMore = async () => {
    if (!cursor) return;
    const nextPage = await api(`/api/matches?filter=${filter}&cursor=${cursor}`);
    setAllItems(prev => [...prev, ...(nextPage.items ?? [])]);
    setCursor(nextPage.nextCursor ?? null);
  };

  const recalc = async () => {
    setIsRecalculating(true);
    setRecalcMsg(null);
    try {
      const r = await api('/api/matches/recalculate', { method: 'POST' });
      setRecalcMsg(`Recalculated — ${r.matchesTouched} matches touched, ${r.notificationsDelivered} delivered.`);
      reload();
    } catch (e: any) {
      setRecalcMsg(e.message);
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <RequireAuth>
      <h1>Your matches</h1>
      <p className="subtitle">Each job scored and explained.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`btn ghost small ${filter === f ? 'active-filter' : ''}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            style={filter === f ? { background: 'hsl(var(--primary) / 0.1)', borderColor: 'hsl(var(--primary) / 0.3)' } : {}}
          >
            {f}
          </button>
        ))}
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={recalc} disabled={isRecalculating}>
          {isRecalculating ? 'Recalculating...' : 'Recalculate now'}
        </button>
      </div>
      {recalcMsg && <div className={recalcMsg.startsWith('Recalculated') ? 'ok-box' : 'error-box'} aria-live="polite">{recalcMsg}</div>}
      {err && !loading && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && allItems.length === 0 && (
          <EmptyState
            title={filter === 'UNSEEN' ? 'Nothing unseen' : 'No matches yet'}
            message={
              filter === 'UNSEEN'
                ? 'Everything has already been sent to your Inbox or Telegram. New matches will show up as jobs are collected.'
                : 'Scores refresh on each collection run. Check back soon or recalculate now.'
            }
            action={filter === 'UNSEEN' ? 'Browse all matches' : 'Recalculate now'}
            actionHref={filter === 'UNSEEN' ? '/matches' : undefined}
            onClick={filter !== 'UNSEEN' ? recalc : undefined}
          />
        )}
        {allItems.map((m) => (
          <Link key={m.jobId} href={`/jobs/${m.jobId}`} className="job-row" style={{ alignItems: 'flex-start' }}>
            <ScoreBadge score={m.score} />
            <div className="info">
              <div className="title">{m.job.title}</div>
              <div className="meta">
                {m.job.company} · {m.job.location} · {m.job.employmentType} · posted {fmtDate(m.job.postedDate)}
              </div>
              <ul className="clean" style={{ marginTop: 6 }}>
                {m.reasons.slice(0, 3).map((r, i) => (
                  <li key={`${m.jobId}-reason-${i}`}>{r}</li>
                ))}
              </ul>
            </div>
          </Link>
        ))}
        {hasMore && (
          <button className="btn ghost" style={{ width: '100%', marginTop: 12 }} onClick={loadMore}>
            Load more matches
          </button>
        )}
      </div>
    </RequireAuth>
  );
}
