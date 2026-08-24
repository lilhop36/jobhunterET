'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, StatusPill, EmptyState, fmtDate } from '../../lib/ui';

const TAG_META: Record<string, { emoji: string; color: string }> = {
  ethiopian: { emoji: '🇪🇹', color: '#22c55e' },
  remote: { emoji: '🌍', color: '#3b82f6' },
  international: { emoji: '🌐', color: '#8b5cf6' },
  ngo: { emoji: '🏥', color: '#f59e0b' },
  tech: { emoji: '💻', color: '#06b6d4' },
  entry_level: { emoji: '🌱', color: '#10b981' },
  senior: { emoji: '⭐', color: '#ef4444' },
  freelance: { emoji: '📋', color: '#f97316' },
};

function TagBadge({ tag }: { tag: string }) {
  const m = TAG_META[tag];
  if (!m) return null;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', borderRadius: 4, fontSize: 11,
        background: m.color + '18', color: m.color, fontWeight: 600,
        border: `1px solid ${m.color}30`,
      }}
    >
      {m.emoji} {tag.replace('_', ' ')}
    </span>
  );
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  tags: string[];
  employmentType: string;
  experienceLevel: string;
  status: string;
  postedDate: string;
  source: { name: string; tier: string };
  parseConfidence: number;
  match: { score: number } | null;
}

interface JobPage {
  items: Job[];
  nextCursor: string | null;
  total: number;
}

const ALL_TAGS = [
  { id: 'ethiopian', emoji: '🇪🇹', label: 'Ethiopian' },
  { id: 'remote', emoji: '🌍', label: 'Remote' },
  { id: 'international', emoji: '🌐', label: 'International' },
  { id: 'ngo', emoji: '🏥', label: 'NGO' },
  { id: 'tech', emoji: '💻', label: 'Tech' },
  { id: 'senior', emoji: '⭐', label: 'Senior' },
  { id: 'entry_level', emoji: '🌱', label: 'Entry Level' },
  { id: 'freelance', emoji: '📋', label: 'Freelance' },
];

export default function JobsPage() {
  const { api } = useAuth();
  const path = usePathname();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Build API URL with query + tag
  const apiUrl = (() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (activeTag) params.set('tag', activeTag);
    const qs = params.toString();
    return qs ? `/api/jobs?${qs}` : '/api/jobs';
  })();
  const { data, err, loading, reload } = useApi<JobPage>(apiUrl);
  const items = data?.items ?? [];

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

      {/* Tag filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        <button
          onClick={() => { setActiveTag(null); reload(); }}
          style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
            border: `1px solid ${activeTag === null ? '#22c55e' : '#e5e7eb'}`,
            background: activeTag === null ? '#22c55e18' : '#f9fafb',
            color: activeTag === null ? '#22c55e' : '#6b7280',
            fontWeight: activeTag === null ? 700 : 400,
          }}
        >
          All
        </button>
        {ALL_TAGS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTag(activeTag === t.id ? null : t.id); reload(); }}
            style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${activeTag === t.id ? '#3b82f6' : '#e5e7eb'}`,
              background: activeTag === t.id ? '#3b82f618' : '#f9fafb',
              color: activeTag === t.id ? '#3b82f6' : '#6b7280',
              fontWeight: activeTag === t.id ? 700 : 400,
            }}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && items.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No jobs match your filters"
            message="Try a broader search, or clear the query to see the latest postings."
            action="Browse all jobs"
            actionHref="/jobs"
          />
        )}
        {items.map((j) => (
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
              <div className="tags" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                {(j.tags ?? []).map((t) => <TagBadge key={t} tag={t} />)}
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
