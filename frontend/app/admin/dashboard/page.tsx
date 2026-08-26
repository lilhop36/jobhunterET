'use client';

import Link from 'next/link';
import {
  Users,
  Briefcase,
  Target,
  Bell,
  Activity,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading, StatusPill } from '../../../lib/ui';

interface AdminStats {
  overview: {
    totalUsers: number;
    activeUsers: number;
    dormantUsers: number;
    totalJobs: number;
    activeJobs: number;
    expiredJobs: number;
    removedJobs: number;
    totalMatches: number;
    aboveThreshold: number;
    totalNotifications: number;
    unreadInbox: number;
    totalApplications: number;
  };
  sourceHealth: {
    id: string;
    name: string;
    status: string;
    priorityTier: string;
    healthScore: number | null;
    consecutiveFailures: number;
    lastSuccessfulRun: string | null;
    lastFailedRun: string | null;
    lastError: string | null;
    recentRuns: {
      avgDescriptionQuality: number | null;
      linkFailures: number;
      linkChecks: number;
    }[];
  }[];
  lastCycle: {
    startedAt: string;
    finishedAt: string | null;
    jobsEvaluated: number;
    usersProcessed: number;
    matchesCreated: number;
    aboveThreshold: number;
    notificationsSent: number;
    notificationsFailed: number;
    toInbox: number;
    errors: number;
  } | null;
  recentActivity: {
    tag: string;
    msg: string;
    at: string;
  }[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon
          className="h-4 w-4"
          style={{ color: color || 'hsl(var(--primary))' }}
        />
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { user, ready } = useAuth();
  const isAdmin = ready && user?.role === 'ADMIN';
  const { data, err, loading, reload } = useApi<AdminStats>(isAdmin ? '/api/admin/stats' : null);

  if (ready && user && user.role !== 'ADMIN') {
    return (
      <RequireAuth>
        <h1>Admin Dashboard</h1>
        <div className="error-box">403 — admin access required.</div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Admin Dashboard</h1>
        <Link href="/admin/users" className="btn ghost small">Users</Link>
        <Link href="/sources" className="btn ghost small">Sources</Link>
      </div>
      <p className="subtitle">System health, source metrics, and match cycle overview.</p>

      {err && !loading && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      {data && (
        <>
          {/* ── Overview stats ──────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <StatCard
              icon={Users}
              label="Users"
              value={data.overview.totalUsers}
              sub={`${data.overview.activeUsers} active · ${data.overview.dormantUsers} dormant`}
              color="hsl(var(--info))"
            />
            <StatCard
              icon={Briefcase}
              label="Jobs"
              value={data.overview.totalJobs}
              sub={`${data.overview.activeJobs} active · ${data.overview.expiredJobs} expired`}
              color="hsl(var(--primary))"
            />
            <StatCard
              icon={Target}
              label="Matches"
              value={data.overview.totalMatches}
              sub={`${data.overview.aboveThreshold} above threshold`}
              color="hsl(var(--success))"
            />
            <StatCard
              icon={Bell}
              label="Notifications"
              value={data.overview.totalNotifications}
              sub={`${data.overview.unreadInbox} unread inbox`}
              color="hsl(35, 90%, 55%)"
            />
            <StatCard
              icon={Activity}
              label="Applications"
              value={data.overview.totalApplications}
              color="hsl(280, 60%, 55%)"
            />
          </div>

          {/* ── Source health ────────────────────────────────── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Source health</h2>
            {data.sourceHealth.length === 0 ? (
              <p className="muted">No sources configured.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Source</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px' }}>Health</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px' }}>Failures</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Desc Quality</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Link Checks</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Last Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourceHealth.map((s) => {
                      const latestRun = s.recentRuns[0];
                      const descQuality = latestRun?.avgDescriptionQuality;
                      const linkRate = latestRun?.linkChecks
                        ? Math.round(((latestRun.linkChecks - latestRun.linkFailures) / latestRun.linkChecks) * 100)
                        : null;

                      return (
                        <tr key={s.id} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <div style={{ fontWeight: 500 }}>{s.name}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{s.priorityTier}</div>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <StatusPill status={s.status} />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {s.healthScore != null ? (
                              <span
                                style={{
                                  fontWeight: 600,
                                  color:
                                    s.healthScore >= 80
                                      ? 'hsl(var(--success))'
                                      : s.healthScore >= 50
                                        ? 'hsl(35, 90%, 55%)'
                                        : 'hsl(var(--destructive))',
                                }}
                              >
                                {Math.round(s.healthScore)}%
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {s.consecutiveFailures > 0 ? (
                              <span style={{ color: 'hsl(var(--destructive))', fontWeight: 500 }}>
                                {s.consecutiveFailures}
                              </span>
                            ) : (
                              <CheckCircle className="h-4 w-4" style={{ color: 'hsl(var(--success))' }} />
                            )}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {descQuality != null ? (
                              <span
                                style={{
                                  color:
                                    descQuality >= 70
                                      ? 'hsl(var(--success))'
                                      : descQuality >= 40
                                        ? 'hsl(35, 90%, 55%)'
                                        : 'hsl(var(--destructive))',
                                }}
                              >
                                {Math.round(descQuality)}%
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {linkRate != null ? (
                              <span
                                style={{
                                  color:
                                    linkRate >= 95
                                      ? 'hsl(var(--success))'
                                      : linkRate >= 80
                                        ? 'hsl(35, 90%, 55%)'
                                        : 'hsl(var(--destructive))',
                                }}
                              >
                                {linkRate}% alive
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: 200 }}>
                            {s.lastError ? (
                              <span
                                style={{ fontSize: 12, color: 'hsl(var(--destructive))' }}
                                title={s.lastError}
                              >
                                {s.lastError.length > 60 ? s.lastError.slice(0, 60) + '…' : s.lastError}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Last match cycle ─────────────────────────────── */}
          {data.lastCycle && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Last match cycle</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12,
                }}
              >
                {[
                  ['Jobs evaluated', data.lastCycle.jobsEvaluated],
                  ['Users processed', data.lastCycle.usersProcessed],
                  ['Matches created', data.lastCycle.matchesCreated],
                  ['Above threshold', data.lastCycle.aboveThreshold],
                  ['Sent (Telegram)', data.lastCycle.notificationsSent],
                  ['Sent (Inbox)', data.lastCycle.toInbox],
                  ['Failed', data.lastCycle.notificationsFailed],
                  ['Errors', data.lastCycle.errors],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{value as number}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{label}</div>
                  </div>
                ))}
              </div>
              {data.lastCycle.finishedAt && (
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Duration: {Math.round(
                    (new Date(data.lastCycle.finishedAt).getTime() -
                      new Date(data.lastCycle.startedAt).getTime()) /
                      1000,
                  )}
                  s · Finished {new Date(data.lastCycle.finishedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* ── Recent activity log ──────────────────────────── */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Recent activity</h2>
            {data.recentActivity.length === 0 ? (
              <p className="muted">No activity logged yet.</p>
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {data.recentActivity.map((log) => (
                  <div
                    key={`${log.at}-${log.tag}`}
                    style={{
                      padding: '6px 8px',
                      borderBottom: '1px solid hsl(var(--border))',
                      fontSize: 13,
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: 'hsl(var(--muted-foreground))',
                        minWidth: 50,
                      }}
                    >
                      [{log.tag}]
                    </span>
                    <span style={{ flex: 1 }}>{log.msg}</span>
                    <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(log.at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </RequireAuth>
  );
}
