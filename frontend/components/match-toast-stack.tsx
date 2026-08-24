'use client';

import Link from 'next/link';
import { ScoreBadge } from '../lib/ui';
import type { StreamEvent, DigestEvent, CollectionEvent } from '../lib/use-match-stream';

// Re-export for backward compat
export type { StreamEvent as MatchEvent };

/**
 * Floating toast stack for real-time notifications.
 * Renders in the bottom-right corner; newest on top.
 * Each toast auto-dismisses after ~8s (handled by useEventStream).
 */
export function MatchToastStack({
  events,
  onDismiss,
}: {
  events: StreamEvent[];
  onDismiss: (key: number) => void;
}) {
  if (events.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Live notifications"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 380,
        width: 'calc(100vw - 40px)',
        pointerEvents: 'none',
      }}
    >
      {events.map((evt) => {
        switch (evt.type) {
          case 'match':
            return <MatchToast key={evt._key} event={evt} onDismiss={() => onDismiss(evt._key)} />;
          case 'application':
            return <ApplicationToast key={evt._key} event={evt} onDismiss={() => onDismiss(evt._key)} />;
          case 'digest':
            return <DigestToast key={evt._key} event={evt} onDismissKey={evt._key} dismissFn={onDismiss} />;
          case 'collection':
            return <CollectionToast key={evt._key} event={evt} onDismiss={() => onDismiss(evt._key)} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ── Match toast ──────────────────────────────────────────────

function MatchToast({ event, onDismiss }: { event: StreamEvent & { type: 'match' }; onDismiss: () => void }) {
  return (
    <div className="match-toast" style={{ pointerEvents: 'auto' }}>
      <Link href={`/jobs/${event.jobId}`} className="match-toast-body">
        <ScoreBadge score={event.score} />
        <div className="match-toast-text">
          <div className="match-toast-title">{event.title || 'New match'}</div>
          <div className="match-toast-meta">{event.company}</div>
        </div>
      </Link>
      <button onClick={onDismiss} className="match-toast-close" aria-label="Dismiss">✕</button>
    </div>
  );
}

// ── Application status toast ─────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  SAVED: '💾 Saved',
  APPLIED: '📤 Applied',
  ASSESSMENT: '📋 Assessment',
  INTERVIEW: '🎤 Interview',
  OFFER: '🎉 Offer',
  REJECTED: '❌ Rejected',
  WITHDRAWN: '↩️ Withdrawn',
};

function ApplicationToast({ event, onDismiss }: { event: StreamEvent & { type: 'application' }; onDismiss: () => void }) {
  const label = STAGE_LABELS[event.to] ?? event.to;
  return (
    <div className="match-toast match-toast--app" style={{ pointerEvents: 'auto' }}>
      <Link href={`/jobs/${event.jobId}`} className="match-toast-body">
        <div className="match-toast-icon">📋</div>
        <div className="match-toast-text">
          <div className="match-toast-title">{event.title || 'Job'}</div>
          <div className="match-toast-meta">{event.company} · {label}</div>
        </div>
      </Link>
      <button onClick={onDismiss} className="match-toast-close" aria-label="Dismiss">✕</button>
    </div>
  );
}

// ── Digest ready toast ───────────────────────────────────────

function DigestToast({
  event,
  onDismissKey,
  dismissFn,
}: {
  event: DigestEvent;
  onDismissKey: number;
  dismissFn: (key: number) => void;
}) {
  return (
    <div className="match-toast match-toast--digest" style={{ pointerEvents: 'auto' }}>
      <Link href="/dashboard" className="match-toast-body">
        <div className="match-toast-icon">📅</div>
        <div className="match-toast-text">
          <div className="match-toast-title">Daily digest ready</div>
          <div className="match-toast-meta">
            {event.newJobs} new jobs · {event.strongMatches} strong matches
          </div>
        </div>
      </Link>
      <button onClick={() => dismissFn(onDismissKey)} className="match-toast-close" aria-label="Dismiss">✕</button>
    </div>
  );
}

// ── Collection toast ─────────────────────────────────────────

function CollectionToast({ event, onDismiss }: { event: CollectionEvent; onDismiss: () => void }) {
  const isOk = event.status === 'OK';
  return (
    <div className="match-toast match-toast--collection" style={{ pointerEvents: 'auto' }}>
      <Link href="/sources" className="match-toast-body">
        <div className="match-toast-icon">⚡</div>
        <div className="match-toast-text">
          <div className="match-toast-title">
            {event.sourceName} collected {event.jobsCreated} new job{event.jobsCreated === 1 ? '' : 's'}
          </div>
          <div className="match-toast-meta">
            {event.jobsFetched} fetched · {event.duplicates} dupes · {(event.duration / 1000).toFixed(1)}s
          </div>
        </div>
      </Link>
      <button onClick={onDismiss} className="match-toast-close" aria-label="Dismiss">✕</button>
    </div>
  );
}
