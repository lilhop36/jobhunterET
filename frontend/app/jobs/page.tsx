'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, StatusPill, EmptyState, fmtDate } from '../../lib/ui';

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  experienceLevel: string;
  status: string;
  postedDate: string;
  source: { name: string; tier: string };
  parseConfidence: number;
  match: { score: number } | null;
}

export default function JobsPage() {
  const { api } = useAuth();
  const path = usePathname();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const { data, err, loading, reload } = useApi<Job[]>(query === null ? '/api/jobs' : `/api/jobs?q=${encodeURIComponent(query)}`);

  // Pick up ?q= from the topbar global search (initial load and navigation).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('q');
    if (p !== null) {
      setQ(p);
      setQuery(p);
    }
  }, [path]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim() || null);
    reload();
  };

  return (
    <RequireAuth>
      <h1>Jobs</h1>
      <p className="subtitle">New postings from Ethiopia-first sources, ranked by your profile.</p>

      <form className="card" onSubmit={search} style={{ display: 'flex', gap: 10 }}>
        <input
          placeholder="Search title, company, skill… (e.g. Node.js)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && data.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No jobs match your filters"
            message="Try a broader search, or clear the query to see the latest postings."
            action="Browse all jobs"
            actionHref="/jobs"
          />
        )}
        {data?.map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="job-row">
            {j.match ? <ScoreBadge score={j.match.score} /> : <span className="muted" style={{ width: 42 }}>—</span>}
            <div className="info">
              <div className="title">
                {j.title}
                {j.parseConfidence < 40 && (
                  <span
                    className="pill"
                    style={{ marginLeft: 8 }}
                    title={`Low parse confidence (${j.parseConfidence}%) — details may be unreliable (FR-012c)`}
                  >
                    low-confidence
                  </span>
                )}
              </div>
              <div className="meta">
                {j.company} · {j.location} · {j.employmentType} · {j.experienceLevel} · posted {fmtDate(j.postedDate)} ·{' '}
                {j.source.name}
              </div>
            </div>
            <StatusPill status={j.status} />
          </Link>
        ))}
      </div>
    </RequireAuth>
  );
}
