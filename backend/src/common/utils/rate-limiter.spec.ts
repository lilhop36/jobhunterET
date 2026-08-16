import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to max requests then rejects', () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(false);
  });

  it('is keyed independently', () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('b')).toBe(true);
    expect(rl.consume('a')).toBe(false);
    expect(rl.consume('b')).toBe(false);
  });

  it('refills after the window elapses', () => {
    jest.useFakeTimers();
    try {
      const rl = new RateLimiter(1, 1000);
      expect(rl.consume('a')).toBe(true);
      expect(rl.consume('a')).toBe(false);
      jest.advanceTimersByTime(1001);
      expect(rl.consume('a')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reset forgets a key immediately', () => {
    const rl = new RateLimiter(1, 60_000);
    rl.consume('a');
    rl.reset('a');
    expect(rl.consume('a')).toBe(true);
  });

  it('accepts a request on a fresh window after expiry', () => {
    jest.useFakeTimers();
    try {
      const rl = new RateLimiter(2, 5000);
      rl.consume('a');
      rl.consume('a');
      expect(rl.consume('a')).toBe(false);
      jest.advanceTimersByTime(5001);
      expect(rl.consume('a')).toBe(true); // new window, budget reset
    } finally {
      jest.useRealTimers();
    }
  });
});
