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

interface TagCount {
  id: string;
  emoji: string;
  label: string;
  color: string;
  description: string;
  count: number;
}

const FALLBACK_TAGS: TagCount[] = [
  { id: 'ethiopian', emoji: '🇪🇹', label: 'Ethiopian', color: '#22c55e', description: '', count: 0 },
  { id: 'remote', emoji: '🌍', label: 'Remote', color: '#3b82f6', description: '', count: 0 },
  { id: 'international', emoji: '🌐', label: 'International', color: '#8b5cf6', description: '', count: 0 },
  { id: 'ngo', emoji: '🏥', label: 'NGO', color: '#f59e0b', description: '', count: 0 },
  { id: 'tech', emoji: '💻', label: 'Tech', color: '#06b6d4', description: '', count: 0 },
  { id: 'senior', emoji: '⭐', label: 'Senior', color: '#ef4444', description: '', count: 0 },
  { id: 'entry_level', emoji: '🌱', label: 'Entry Level', color: '#10b981', description: '', count: 0 },
  { id: 'freelance', emoji: '📋', label: 'Freelance', color: '#f97316', description: '', count: 0 },
];

export default function JobsPage() {
  const { api } = useAuth();
  const path = usePathname();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Live tag metadata + job counts for the category filter pills.
  const tagRes = useApi<TagCount[] | null>('/api/jobs/tags/counts');
  const tags: TagCount[] = tagRes.data && !tagRes.err && (tagRes.data?.length ?? 0) > 0 ? tagRes.data : FALLBACK_TAGS;

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
      <p className="subtitle">Fresh listings, ranked for you.</p>

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
        {tags.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTag(activeTag === t.id ? null : t.id); reload(); }}
            title={t.description ? `${t.description} — ${t.count} job(s)` : `${t.count} job(s)`}
            style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${activeTag === t.id ? t.color : '#e5e7eb'}`,
              background: activeTag === t.id ? t.color + '18' : '#f9fafb',
              color: activeTag === t.id ? t.color : '#6b7280',
              fontWeight: activeTag === t.id ? 700 : 400,
            }}
          >
            {t.emoji} {t.label}
            {' '}
            <span className="muted" style={{ fontSize: 11 }}>{t.count}</span>
          </button>
        ))}
      </div>

      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      <div className="card">
        {data && items.length === 0 && (
          <EmptyState
            title="No jobs found"
            message="Try a broader search or clear your filters."
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
                    title={`Low parse confidence (${j.parseConfidence}%) — details may be unreliable`}
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
