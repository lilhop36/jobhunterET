'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from './auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Re-export the Zustand-backed useApi — same API, shared cache + dedup.
export { useApi } from './api-store';
export type { UseApiResult } from './api-store';

/** Redirect to /login until a token exists. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !token) router.push('/login');
  }, [ready, token, router]);
  if (!ready || !token) return <p className="muted">Loading…</p>;
  return <>{children}</>;
}

export function scoreBand(score: number): 'excellent' | 'strong' | 'good' | 'possible' | 'low' {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 60) return 'possible';
  return 'low';
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const variant = {
    excellent: 'success' as const,
    strong: 'info' as const,
    good: 'warning' as const,
    possible: 'secondary' as const,
    low: 'destructive' as const,
  }[scoreBand(score)];
  return (
    <Badge variant={variant} className={cn('tabular-nums', className)}>
      {score}%
    </Badge>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{status}</span>;
}

/* ------------------------------------------------------------------ */
/* Skeleton loaders */
/* ------------------------------------------------------------------ */

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-5 shadow-sm', className)}>
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/** Skeleton list that mimics .card + .job-row rows — used while async data loads. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" aria-busy="true" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3" style={{ minHeight: 52 }}>
          <Skeleton className="h-6 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-5 text-center shadow-sm">
          <Skeleton className="mx-auto h-8 w-12" />
          <Skeleton className="mx-auto mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function Loading() {
  return <ListSkeleton />;
}

/* Designed empty state — icon, message, and an optional CTA */
export function EmptyState({
  icon,
  title,
  message,
  action,
  actionHref,
  onClick,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: string;
  actionHref?: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center" role="status">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
        {icon ?? '🔍'}
      </div>
      <h3 className="mt-4">{title}</h3>
      <p className="muted mt-1 max-w-sm text-sm">{message}</p>
      {action && actionHref && (
        <Link href={actionHref} className="btn mt-5">
          {action}
        </Link>
      )}
      {action && !actionHref && onClick && (
        <button onClick={onClick} className="btn mt-5">
          {action}
        </button>
      )}
    </div>
  );
}

export function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{msg}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn ghost small">
          Retry
        </button>
      )}
    </div>
  );
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Returns the deadline formatted as a date string plus a colour band. */
export function fmtDeadline(iso?: string | null): {
  label: string;
  daysLeft: number | null;
  band: 'urgent' | 'soon' | 'ok' | null;
} {
  if (!iso) return { label: '—', daysLeft: null, band: null };
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysLeft <= 0) return { label: `${dateStr} (expired)`, daysLeft, band: 'urgent' };
  const suffix = daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
  const band = daysLeft <= 3 ? 'urgent' : daysLeft <= 7 ? 'soon' : 'ok';
  return { label: dateStr, daysLeft, band, ...({ suffix } as any) };
}

