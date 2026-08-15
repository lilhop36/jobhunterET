'use client';

import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, StatusPill, EmptyState, fmtDate } from '../../lib/ui';

interface InboxItem {
  id: string;
  jobId: string;
  title: string;
  company: string;
  location: string;
  score: number;
  summary: string;
  status: string;
  createdAt: string;
}

export default function InboxPage() {
  const { api } = useAuth();
  const { data, err, loading, reload } = useApi<InboxItem[]>('/api/inbox');

  const read = async (id: string) => {
    await api(`/api/inbox/${id}/read`, { method: 'PATCH' });
    reload();
  };

  const readAll = async () => {
    await api('/api/inbox/read-all', { method: 'POST' });
    reload();
  };

  const unread = data?.filter((n) => n.status === 'UNREAD_WEB').length ?? 0;

  return (
    <RequireAuth>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Inbox</h1>
        {unread > 0 && (
          <button className="btn ghost small" onClick={readAll}>
            Mark all read
          </button>
        )}
      </div>
      <p className="subtitle">
        Missed alerts that couldn&apos;t reach Telegram — nothing is ever silently lost (FR-024c).
      </p>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && data.length === 0 && (
          <EmptyState
            icon="📭"
            title="Inbox empty — you're all caught up"
            message="When Telegram isn't linked (or delivery fails), qualifying matches land here so nothing is ever lost (FR-024c)."
          />
        )}
        {data?.map((n) => (
          <div key={n.id} className="job-row" style={{ alignItems: 'flex-start' }}>
            <ScoreBadge score={n.score} />
            <div className="info">
              <div className="title">
                <Link href={`/jobs/${n.jobId}`}>{n.title || 'Job'}</Link>
              </div>
              <div className="meta">
                {n.company} · {n.location} · {fmtDate(n.createdAt)}
              </div>
              {n.summary && <div style={{ fontSize: 13.5, marginTop: 4 }}>{n.summary}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <StatusPill status={n.status} />
              {n.status === 'UNREAD_WEB' && (
                <button className="btn ghost small" onClick={() => read(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </RequireAuth>
  );
}
