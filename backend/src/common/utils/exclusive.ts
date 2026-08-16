/**
 * BUG-003: per-name reentrancy guard for scheduled tasks.
 *
 * `@Interval` fires on a fixed cadence with no overlap protection — if a run
 * takes longer than the interval (a hung fetch, a slow digest), the next tick
 * starts a second concurrent run. `exclusive` skips a tick while the same-named
 * run is still in flight; the lock always releases, even on throw.
 */
export function createExclusive() {
  const running = new Set<string>();
  return async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (running.has(name)) return undefined;
    running.add(name);
    try {
      return await fn();
    } finally {
      running.delete(name);
    }
  };
}
