'use client';

import { cn } from '../lib/utils';

/**
 * Compact SSE connection status badge.
 * Green dot = connected, red dot = disconnected/reconnecting.
 * Pulse animation on the dot when connected.
 */
export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        connected
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400',
      )}
      title={connected ? 'Live updates active' : 'Reconnecting…'}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500',
        )}
      />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}
