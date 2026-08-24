/**
 * Lightweight client-side API cache built on Zustand.
 *
 * Benefits over the old per-page useApi():
 * - Shared cache: /api/dashboard fetched on layout and dashboard page shares data
 * - Request deduplication: concurrent requests for the same path share one fetch
 * - Stale-while-revalidate: serve cached data instantly, revalidate in background
 * - Manual invalidation: mutations can bust the cache for related paths
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createStore } from 'zustand/vanilla';

// ── Types ────────────────────────────────────────────────────

interface CacheEntry<T = any> {
  data: T | null;
  err: string | null;
  /** Timestamp of last successful fetch (ms since epoch). */
  ts: number;
}

interface ApiState {
  cache: Map<string, CacheEntry>;
  /** In-flight fetch promises — keyed by path for deduplication. */
  inflight: Map<string, Promise<any>>;
  /** Subscribers per path — used to notify React of cache updates. */
  subs: Map<string, Set<() => void>>;
}

// ── Config ───────────────────────────────────────────────────

/** How long cached data is considered fresh (ms). */
const STALE_MS = 30_000;

// ── Vanilla store ────────────────────────────────────────────

export const apiStore = createStore<ApiState>()(() => ({
  cache: new Map(),
  inflight: new Map(),
  subs: new Map(),
}));

// ── Auth helper (reads token outside React context) ──────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jh_token');
}

// ── Core fetch with dedup ────────────────────────────────────

async function fetchJson(path: string): Promise<any> {
  const headers: Record<string, string> = {};
  const tk = getToken();
  if (tk) headers['authorization'] = `Bearer ${tk}`;

  const res = await fetch(path, { headers });
  if (res.status === 401) {
    localStorage.removeItem('jh_token');
    localStorage.removeItem('jh_user');
    window.location.href = '/login';
    throw new Error('Session expired — please log in');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

/** Notify all subscribers of a path that the cache changed. */
function notifyPath(path: string) {
  const state = apiStore.getState();
  const subs = state.subs.get(path);
  if (subs) for (const fn of subs) fn();
}

/**
 * Fetch with in-flight deduplication: if the same path is already being
 * fetched, return the existing promise instead of starting a second request.
 */
function dedupedFetch(path: string): Promise<any> {
  const state = apiStore.getState();
  const existing = state.inflight.get(path);
  if (existing) return existing;

  const p = fetchJson(path).finally(() => {
    apiStore.setState((s) => {
      const next = new Map(s.inflight);
      next.delete(path);
      return { inflight: next };
    });
  });

  apiStore.setState((s) => {
    const next = new Map(s.inflight);
    next.set(path, p);
    return { inflight: next };
  });

  return p;
}

// ── React hook ───────────────────────────────────────────────

export interface UseApiResult<T> {
  data: T | null;
  err: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * React hook that reads from the Zustand cache and triggers fetches.
 * Drop-in replacement for the old useApi() — same return shape.
 *
 * Components sharing the same path will share cached data.
 * Concurrent requests for the same path are deduplicated.
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
  const [, forceRender] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  // Read the current cache entry.
  const getEntry = useCallback(
    () => (path ? (apiStore.getState().cache.get(path) as CacheEntry<T> | undefined) : undefined),
    [path],
  );

  const entry = getEntry();
  const isInflight = path ? apiStore.getState().inflight.has(path) : false;

  // Subscribe to cache changes for this path.
  useEffect(() => {
    if (!path) return;
    const state = apiStore.getState();
    const subs = state.subs.get(path) ?? new Set();
    const bump = () => forceRender((n) => n + 1);
    subs.add(bump);
    apiStore.setState((s) => {
      const next = new Map(s.subs);
      next.set(path, subs);
      return { subs: next };
    });
    return () => {
      const s = apiStore.getState();
      const set = s.subs.get(path);
      if (set) {
        set.delete(bump);
        if (set.size === 0) {
          const next = new Map(s.subs);
          next.delete(path);
          apiStore.setState({ subs: next });
        }
      }
    };
  }, [path]);

  // Trigger fetch on mount / path change if stale or missing.
  useEffect(() => {
    if (!path) return;
    const state = apiStore.getState();
    const cached = state.cache.get(path) as CacheEntry<T> | undefined;
    const isFresh = cached && Date.now() - cached.ts < STALE_MS;
    if (isFresh || state.inflight.has(path)) return;

    dedupedFetch(path)
      .then((data) => {
        apiStore.setState((s) => {
          const next = new Map(s.cache);
          next.set(path, { data, err: null, ts: Date.now() });
          return { cache: next };
        });
        notifyPath(path);
      })
      .catch((e) => {
        apiStore.setState((s) => {
          const next = new Map(s.cache);
          next.set(path, { data: null, err: e.message, ts: Date.now() });
          return { cache: next };
        });
        notifyPath(path);
      });
  }, [path]);

  const reload = useCallback(() => {
    const p = pathRef.current;
    if (!p) return;
    // Clear cache to force re-fetch.
    apiStore.setState((s) => {
      const next = new Map(s.cache);
      next.delete(p);
      return { cache: next };
    });
    // Trigger fetch.
    dedupedFetch(p)
      .then((data) => {
        apiStore.setState((s) => {
          const next = new Map(s.cache);
          next.set(p, { data, err: null, ts: Date.now() });
          return { cache: next };
        });
        notifyPath(p);
      })
      .catch((e) => {
        apiStore.setState((s) => {
          const next = new Map(s.cache);
          next.set(p, { data: null, err: e.message, ts: Date.now() });
          return { cache: next };
        });
        notifyPath(p);
      });
  }, []);

  return {
    data: entry?.data ?? null,
    err: entry?.err ?? null,
    loading: (!entry && isInflight) || (!entry && !isInflight && !!path),
    reload,
  };
}

// ── Non-hook utilities (for use outside React) ───────────────

/**
 * Force-refetch a path, ignoring the cache.
 */
export async function apiRefetch<T>(path: string): Promise<T> {
  const data = await dedupedFetch(path);
  apiStore.setState((s) => {
    const next = new Map(s.cache);
    next.set(path, { data, err: null, ts: Date.now() });
    return { cache: next };
  });
  notifyPath(path);
  return data;
}

/**
 * Invalidate (clear) the cache for a path, or all paths matching a prefix.
 */
export function apiInvalidate(pathPrefix?: string) {
  apiStore.setState((s) => {
    if (!pathPrefix) return { cache: new Map() };
    const next = new Map(s.cache);
    for (const key of next.keys()) {
      if (key.startsWith(pathPrefix)) next.delete(key);
    }
    return { cache: next };
  });
}
