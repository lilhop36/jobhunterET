'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './auth';

export interface MatchEvent {
  type: 'match';
  jobId: string;
  score: number;
  title: string;
  company: string;
  summary: string;
  createdAt: string;
}

export interface StreamState {
  /** Latest match event, or null if none received yet. */
  event: MatchEvent | null;
  /** Accumulated count of match events received this session. */
  matchCount: number;
  /** Whether the SSE connection is currently open. */
  connected: boolean;
}

/**
 * Connects to the backend SSE stream and returns real-time match events.
 * Auto-reconnects on drop with exponential backoff.
 * Pass `enabled = false` to pause the stream (e.g. when the tab is hidden).
 */
export function useMatchStream(enabled = true): StreamState {
  const { token } = useAuth();
  const [state, setState] = useState<StreamState>({
    event: null,
    matchCount: 0,
    connected: false,
  });

  // Use refs so the reconnect callback always reads the latest values.
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!token || !enabled) return;

    // Close any lingering connection.
    esRef.current?.close();

    // EventSource doesn't support headers, so pass the JWT as a query param.
    const url = `/api/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retryRef.current = 0;
      setState((s) => ({ ...s, connected: true }));
    };

    es.addEventListener('match', (msg) => {
      try {
        const data: MatchEvent = JSON.parse(msg.data);
        setState((s) => ({
          ...s,
          event: data,
          matchCount: s.matchCount + 1,
        }));
      } catch {
        // malformed payload — ignore
      }
    });

    // Keepalive events are a no-op; they just reset the connection timer.
    es.addEventListener('keepalive', () => {});

    es.onerror = () => {
      es.close();
      setState((s) => ({ ...s, connected: false }));

      // Exponential backoff: 1s, 2s, 4s, 8s … cap at 30s.
      const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
      retryRef.current++;
      timerRef.current = setTimeout(connect, delay);
    };
  }, [token, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
    };
  }, [connect]);

  return state;
}
