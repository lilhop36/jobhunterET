'use client';

import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, EmptyState, fmtDate } from '../../lib/ui';

interface SavedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  postedDate: string;
  status: string;
  source: string;
  skills: string[];
}

export default function SavedPage() {
  const { api } = useAuth();
  const { data, err, loading, reload } = useApi<SavedJob[]>('/api/saved-jobs');

  const unsave = async (jobId: string) => {
    await api(`/api/saved-jobs/${jobId}`, { method: 'POST' });
    reload();
  };

  return (
    <RequireAuth>
      <h1>Saved jobs</h1>
      <p className="subtitle">Jobs you&apos;ve saved for later (FR-029).</p>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}
      <div className="card">
        {data && data.length === 0 && (
          <EmptyState
            icon="🔖"
            title="Nothing saved yet"
            message="Hit Save on any job to keep it here — or browse your matches and save the ones you like."
            action="Browse matches"
            actionHref="/matches"
          />
        )}
        {data?.map((j) => (
          <div key={j.id} className="job-row">
            <div className="info">
              <Link href={`/jobs/${j.id}`} className="title">
                {j.title}
              </Link>
              <div className="meta">
                {j.company} · {j.location} · {j.employmentType} · saved via {j.source} · posted {fmtDate(j.postedDate)}
              </div>
              <div>
                {j.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <button className="btn ghost small" onClick={() => unsave(j.id)}>
              Unsave
            </button>
          </div>
        ))}
      </div>
    </RequireAuth>
  );
}
