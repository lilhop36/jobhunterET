import { parsePort } from './parse-port';

describe('parsePort', () => {
  it.each([
    [undefined, 3210],
    ['', 3210],
    ['   ', 3210],
    ['0', 3210],
    ['abc', 3210],
    ['3.5', 3210],
    ['-1', 3210],
    ['70000', 3210],
  ])('falls back to 3210 for %p', (raw, expected) => {
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
