import { parsePort } from './parse-port';

describe('parsePort', () => {
  it.each([
    [undefined, 3001],
    ['', 3001],
    ['   ', 3001],
    ['0', 3001],
    ['abc', 3001],
    ['3.5', 3001],
    ['-1', 3001],
    ['70000', 3001],
  ])('falls back to 3001 for %p', (raw, expected) => {
    expect(parsePort(raw)).toBe(expected);
  });

  it.each([
    ['1', 1],
    ['80', 80],
    ['3001', 3001],
    ['65535', 65535],
    [' 8080 ', 8080],
  ])('accepts %p', (raw, expected) => {
    expect(parsePort(raw)).toBe(expected);
  });

  it('honours a custom fallback', () => {
    expect(parsePort('nope', 5432)).toBe(5432);
  });
});
