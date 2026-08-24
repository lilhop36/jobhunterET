'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, ScoreBadge, StatusPill, ListSkeleton, StatSkeleton } from '../../lib/ui';
import { MatchCarousel, CarouselSkeleton, type CarouselMatch } from '../../components/match-carousel';
import { Progress } from '../../components/ui/progress';
import { useEventStream } from '../../lib/use-match-stream';
import { MatchToastStack } from '../../components/match-toast-stack';
import { ConnectionBadge } from '../../components/connection-badge';

interface DashboardData {
  greeting: string;
  completion: number;
  onboardDone: boolean;
  telegramLinked: boolean;
  counts: { new24h: number; above: number; saved: number; inFlight: number; unread: number };
  applications: { jobId: string; stage: string }[];
  recentNotifications: { id: string; jobId: string; title: string; company: string; score: number; status: string; createdAt: string }[];
  lastCycle: { jobsEvaluated: number; matchesCreated: number; aboveThreshold: number; toInbox: number; sent: number; at: string } | null;
  digest: {
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

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, err, loading, reload } = useApi<DashboardData>('/api/dashboard');
  // PERF-002: /api/matches returns { items, nextCursor, total } — take the first page.
  const { data: matchesPage, loading: matchesLoading, reload: reloadMatches } = useApi<{ items: CarouselMatch[] }>(
    data ? '/api/matches' : null,
  );

  // ── SSE: live notifications (matches, application changes, digests) ──
  const sse = useEventStream();
  useEffect(() => {
    if (sse.matchCount > 0 || sse.appCount > 0 || sse.digestCount > 0) {
      reload();
      reloadMatches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sse.matchCount, sse.appCount, sse.digestCount]);

  return (
    <RequireAuth>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, flex: '1 1 auto' }}>
          {data?.greeting ?? 'Selam'}, {user?.email?.split('@')[0] ?? 'there'} 👋
        </h1>
        <ConnectionBadge connected={sse.connected} />
      </div>
      <p className="subtitle">Here&apos;s what your job search looks like today.</p>

      {err && <ErrorBox msg={err} onRetry={reload} />}

      <MatchToastStack events={sse.events} onDismiss={sse.dismiss} />
      {data && !data.onboardDone && (
        <div className="notice">
          🎓 Your profile is {data.completion}% complete — finish the{' '}
          <Link href="/onboarding">3-step onboarding wizard</Link> to get matches that actually fit.
        </div>
      )}
      {loading ? (
        <StatSkeleton />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['New matches (24h)', data.counts.new24h],
              ['Above threshold', data.counts.above],
              ['Saved jobs', data.counts.saved],
              ['Applications in flight', data.counts.inFlight],
            ].map(([label, value]) => (
              <div key={label as string} className="stat card">
                <div className="num">{value}</div>
                <div className="lbl">{label}</div>
              </div>
            ))}
          </div>
        )
      )}

      {matchesLoading ? (
        <CarouselSkeleton />
      ) : matchesPage ? (
        <MatchCarousel matches={matchesPage.items.slice(0, 8)} />
      ) : null}

      {data && !data.telegramLinked && (
        <div className="notice-amber">
          🔔 Telegram isn&apos;t linked yet — matches are landing in your <Link href="/inbox">Inbox</Link>. Connect
          it in <Link href="/settings">Settings</Link> for instant alerts.
        </div>
      )}
      {data && data.counts.unread > 0 && (
        <div className="notice">
          📥 You have <strong>{data.counts.unread}</strong> unread alert
          {data.counts.unread === 1 ? '' : 's'} in your <Link href="/inbox">Inbox</Link>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2>Profile completion</h2>
          <Progress value={data?.completion ?? 0} />
          <p className="muted mb-0 mt-2">
            {data?.completion ?? 0}% — {data?.onboardDone ? 'onboarding done' : 'finish your profile for better matches'}{' '}
            <Link href="/profile">edit</Link>
          </p>
        </div>
        <div className="card">
          <h2>Recent alerts</h2>
          {loading ? (
            <ListSkeleton rows={3} />
          ) : !data || data.recentNotifications.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            data.recentNotifications.map((n) => (
              <div key={n.id} className="job-row">
                <ScoreBadge score={n.score} />
                <div className="info">
                  <Link href={`/jobs/${n.jobId}`} className="title">
                    {n.title || 'Job'}
                  </Link>
                  <div className="meta">{n.company}</div>
                </div>
                <StatusPill status={n.status} />
              </div>
            ))
          )}
        </div>
      </div>

      {data?.digest && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, flex: 1 }}>📅 Daily digest</h2>
            <StatusPill status={data.digest.deliveredTo} />
            <span className="muted" style={{ fontSize: 13 }}>
              {new Date(data.digest.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {data.digest.jobsCollected} jobs collected · {data.digest.newJobs} new ·{' '}
            {data.digest.strongMatches} strong/excellent match
            {data.digest.strongMatches === 1 ? '' : 'es'}
            {data.digest.searches.length > 0 &&
              ` · ${data.digest.searches.map((s) => `${s.name} → ${s.hits}`).join(', ')}`}
          </p>
          {data.digest.topMatches.length > 0 && (
            <div className="mt-1">
              {data.digest.topMatches.slice(0, 3).map((m) => (
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
        </div>
      )}

      {data?.lastCycle && (
        <div className="card">
          <h2>Last match cycle</h2>
          <div className="kv">
            <span className="k">Jobs evaluated</span>
            <span>{data.lastCycle.jobsEvaluated}</span>
            <span className="k">Matches created</span>
            <span>{data.lastCycle.matchesCreated}</span>
            <span className="k">Above threshold</span>
            <span>{data.lastCycle.aboveThreshold}</span>
            <span className="k">Delivered → inbox</span>
            <span>{data.lastCycle.toInbox}</span>
            <span className="k">Delivered → Telegram</span>
            <span>{data.lastCycle.sent}</span>
          </div>
        </div>
      )}

      <p className="center mt-6 flex flex-wrap justify-center gap-3">
        <Link className="btn" href="/matches">
          Browse your matches
        </Link>
        <Link className="btn ghost" href="/jobs">
          Browse all jobs
        </Link>
      </p>
    </RequireAuth>
  );
}
