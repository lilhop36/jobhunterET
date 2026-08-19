import { encodeCursor, decodeCursor, parseLimit, keysetAfter, pageFrom } from './keyset';

describe('cursor encode/decode', () => {
  it('round-trips a payload', () => {
    const c = encodeCursor({ firstSeenAt: '2026-08-16T10:00:00.000Z', id: 'abc123' });
    expect(decodeCursor(c)).toEqual({ firstSeenAt: '2026-08-16T10:00:00.000Z', id: 'abc123' });
  });

  it('returns null for missing or malformed cursors', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull(); // array, not object
  });
});

describe('parseLimit', () => {
  it('clamps to the default and max', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('0')).toBe(50);
    expect(parseLimit('-3')).toBe(50);
    expect(parseLimit('abc')).toBe(50);
    expect(parseLimit('25')).toBe(25);
    expect(parseLimit('9999')).toBe(100);
  });
});

describe('keysetAfter', () => {
  it('desc: strictly lower key, or equal key with lower id', () => {
    expect(keysetAfter('score', 80, 'job-9', 'desc')).toEqual({
      OR: [{ score: { lt: 80 } }, { score: 80, id: { lt: 'job-9' } }],
    });
  });

  it('asc: strictly higher key, or equal key with higher id', () => {
    expect(keysetAfter('deadline', '2026-09-01T00:00:00.000Z', 'job-9', 'asc')).toEqual({
      OR: [{ deadline: { gt: '2026-09-01T00:00:00.000Z' } }, { deadline: '2026-09-01T00:00:00.000Z', id: { gt: 'job-9' } }],
    });
  });

  it('asc with a null key: remaining nulls with a larger id, then everything non-null', () => {
    expect(keysetAfter('deadline', null, 'job-9', 'asc')).toEqual({
      OR: [{ deadline: null, id: { gt: 'job-9' } }, { deadline: { not: null } }],
    });
  });

  it('desc with a null key: only remaining nulls with a smaller id', () => {
    expect(keysetAfter('firstSeenAt', null, 'job-9', 'desc')).toEqual({
      firstSeenAt: null,
      id: { lt: 'job-9' },
    });
  });
});

describe('pageFrom', () => {
  const row = (id: string) => ({ id, firstSeenAt: new Date() });

  it('returns all rows with no cursor when fewer than the page size', () => {
    const { items, nextCursor } = pageFrom([row('a'), row('b')], 50, (r) => r.id);
    expect(items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(nextCursor).toBeNull();
  });

  it('drops the look-ahead row and emits a cursor when more rows exist', () => {
    const rows = ['a', 'b', 'c', 'd'].map(row);
    const { items, nextCursor } = pageFrom(rows, 3, (r) => r.id);
    expect(items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(nextCursor).toBe('c');
  });

  it('emits no cursor when exactly at the page boundary', () => {
    const { items, nextCursor } = pageFrom(['a', 'b', 'c'].map(row), 3, (r) => r.id);
    expect(items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(nextCursor).toBeNull();
  });
});
