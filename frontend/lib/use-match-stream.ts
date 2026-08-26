'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './auth';

// ── Event type definitions (mirror backend) ───────────────────

export interface MatchEvent {
  type: 'match';
  jobId: string;
  score: number;
  title: string;
  company: string;
  summary: string;
  createdAt: string;
  _key: number;
}

export interface ApplicationEvent {
  type: 'application';
  jobId: string;
  title: string;
  company: string;
  from: string;
  to: string;
  createdAt: string;
  _key: number;
}

export interface DigestEvent {
  type: 'digest';
  digestId: string;
  jobsCollected: number;
  newJobs: number;
  strongMatches: number;
  createdAt: string;
  _key: number;
}

export interface CollectionEvent {
  type: 'collection';
  sourceId: string;
  sourceName: string;
  status: string;
  jobsFetched: number;
  jobsCreated: number;
  duplicates: number;
  duration: number;
  createdAt: string;
  _key: number;
}

export type StreamEvent = MatchEvent | ApplicationEvent | DigestEvent | CollectionEvent;

export interface StreamState {
  /** Recent events (newest first, capped at MAX_TOASTS). */
  events: StreamEvent[];
  /** Total count of match events received this session. */
  matchCount: number;
  /** Total count of application events received this session. */
  appCount: number;
  /** Total count of digest events received this session. */
  digestCount: number;
  /** Total count of collection events received this session. */
  collectionCount: number;
  /** Whether the SSE connection is currently open. */
  connected: boolean;
  /** Remove a single toast by its _key. */
  dismiss: (key: number) => void;
  /** Remove all current toasts. */
  dismissAll: () => void;
}

const MAX_TOASTS = 8;
const TOAST_TTL_MS = 8_000;

/**
 * Connects to the backend SSE stream and returns real-time events.
 * Maintains a capped queue of recent toasts with auto-expiry.
 * Auto-reconnects on drop with exponential backoff.
 */
export function useEventStream(enabled = true): StreamState {
  const { token } = useAuth();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [appCount, setAppCount] = useState(0);
  const [digestCount, setDigestCount] = useState(0);
  const [collectionCount, setCollectionCount] = useState(0);
  const [connected, setConnected] = useState(false);

  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const keyRef = useRef(0);
  const expiryRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleExpiry = useCallback((key: number) => {
    const id = setTimeout(() => {
      setEvents((prev) => prev.filter((e) => e._key !== key));
      expiryRefs.current.delete(key);
    }, TOAST_TTL_MS);
    expiryRefs.current.set(key, id);
  }, []);

  const dismiss = useCallback((key: number) => {
    setEvents((prev) => prev.filter((e) => e._key !== key));
    const t = expiryRefs.current.get(key);
    if (t) {
      clearTimeout(t);
      expiryRefs.current.delete(key);
    }
  }, []);

  const dismissAll = useCallback(() => {
    setEvents([]);
    for (const t of expiryRefs.current.values()) clearTimeout(t);
    expiryRefs.current.clear();
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;

    esRef.current?.close();

    const url = '/api/events/stream';
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retryRef.current = 0;
      setConnected(true);
    };

    // Generic handler: listen for all event types by name.
    const handleEvent = (eventName: string, rawData: string) => {
      try {
        const data = JSON.parse(rawData);
        const key = ++keyRef.current;
        const toast = { ...data, _key: key } as StreamEvent;
        setEvents((prev) => {
          const next = [toast, ...prev];
          return next.length > MAX_TOASTS ? next.slice(0, MAX_TOASTS) : next;
        });
        if (eventName === 'match') setMatchCount((c) => c + 1);
        else if (eventName === 'application') setAppCount((c) => c + 1);
        else if (eventName === 'digest') setDigestCount((c) => c + 1);
        else if (eventName === 'collection') setCollectionCount((c) => c + 1);
        scheduleExpiry(key);
      } catch {
        // malformed payload — ignore
      }
    };

    es.addEventListener('match', (msg) => handleEvent('match', msg.data));
    es.addEventListener('application', (msg) => handleEvent('application', msg.data));
    es.addEventListener('digest', (msg) => handleEvent('digest', msg.data));
    es.addEventListener('collection', (msg) => handleEvent('collection', msg.data));
    es.addEventListener('keepalive', () => {});

    es.onerror = () => {
      es.close();
      setConnected(false);
      const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
      retryRef.current++;
      timerRef.current = setTimeout(connect, delay);
    };
  }, [token, enabled, scheduleExpiry]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
      for (const t of expiryRefs.current.values()) clearTimeout(t);
      expiryRefs.current.clear();
    };
  }, [connect]);

  return { events, matchCount, appCount, digestCount, collectionCount, connected, dismiss, dismissAll };
}

// Backward-compat alias
export const useMatchStream = useEventStream;
