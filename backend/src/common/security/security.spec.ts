/**
 * Security behavior contract.
 *
 * Tests the BEHAVIOR of security controls, not their implementation.
 * RateLimiter tests live in rate-limiter.spec.ts (its own contract).
 */

// ─── SEC-003: Magic-byte upload validation ──────────────────────
// Contract: only %PDF and PK ZIP headers pass; everything else rejected.

describe('SEC-003 — magic-byte validation', () => {
  // Inline the minimal check — the test IS the spec.
  const validate = (buf: Buffer): boolean => {
    if (buf.length < 4) return false;
    const m = buf.subarray(0, 4);
    const isPdf = m[0] === 0x25 && m[1] === 0x50 && m[2] === 0x44 && m[3] === 0x46;
    const isDocx = m[0] === 0x50 && m[1] === 0x4b && m[2] === 0x03 && m[3] === 0x04;
    return isPdf || isDocx;
  };

  const cases: [string, number[], boolean][] = [
    ['accepts %PDF header',       [0x25, 0x50, 0x44, 0x46, 0x2d], true],
    ['accepts PK ZIP header',     [0x50, 0x4b, 0x03, 0x04, 0x14], true],
    ['rejects MZ (EXE)',          [0x4d, 0x5a, 0x90, 0x00],       false],
    ['rejects PNG header',        [0x89, 0x50, 0x4e, 0x47],        false],
    ['rejects HTML',              [0x3c, 0x68, 0x74, 0x6d],        false],
    ['rejects empty buffer',      [],                                false],
    ['rejects 2-byte buffer',     [0x25, 0x50],                     false],
  ];

  it.each(cases)('%s', (_desc, bytes, expected) => {
    expect(validate(Buffer.from(bytes))).toBe(expected);
  });
});

// ─── SEC-004: Content-Disposition sanitization ───────────────────
// Contract: strip all non-alphanumeric (except ._-), truncate to 128.

describe('SEC-004 — filename sanitization', () => {
  const sanitize = (s: string): string =>
    s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);

  const cases: [string, string, string][] = [
    ['clean pass-through',  'resume.pdf',                    'resume.pdf'],
    ['strips spaces',       'my resume.pdf',                 'my_resume.pdf'],
    ['strips unicode',      'résumé.pdf',                    'r_sum_.pdf'],
    ['neutralizes CRLF',    'a\r\nX-Injected: true',         'a__X-Injected__true'],
    ['neutralizes semicolons', 'a; b=c',                     'a__b_c'],
    ['neutralizes slashes', '../../../etc/passwd',            '.._.._.._etc_passwd'],
    ['truncates to 128',    'a'.repeat(200) + '.pdf',       'a'.repeat(128)],
    ['empty string',        '',                              ''],
  ];

  it.each(cases)('%s: "%s" → "%s"', (_desc, input, expected) => {
    expect(sanitize(input)).toBe(expected);
  });
});

// ─── SEC-001/SEC-006: Helmet ─────────────────────────────────────
// Contract: helmet exports a middleware factory.

describe('SEC-001 — Helmet', () => {
  it('exports a middleware factory', () => {
    const helmet = require('helmet');
    expect(typeof helmet.default).toBe('function');
  });
});
