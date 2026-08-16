/**
 * SEC-005: fixed-window in-memory rate limiter.
 *
 * Enough for a single-instance MVP (the SRS defers shared/durable rate state
 * to the queued phase). `consume` is atomic within a Node tick — the check and
 * increment happen without an intervening `await`, so concurrent callers can't
 * all pass the same window.
 */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the key has exhausted its budget for this window. */
  consume(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    if (b.count >= this.max) return false;
    b.count += 1;
    // Bounded memory: once the map grows past a sane size, drop expired windows.
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  /** Forget a key immediately (e.g. after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}
