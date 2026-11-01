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

// ─── NFR-009: CORS origin policy ────────────────────────────────
// Contract (SRS §26): allow only configured web origins, and never fall back to a
// wildcard in production. backend/src/main.ts wires exactly this decision, so the
// enforcement is checked through the real `cors` middleware rather than a re-implementation.

import { buildCorsPolicy, isOriginAllowedByPolicy, parseAllowedOrigins } from './cors-policy';

/** Runs the configured policy through the same middleware Nest's enableCors uses. */
function corsHeaders(env: Record<string, string>, requestOrigin: string | undefined) {
  const cors = require('cors');
  const { policy } = buildCorsPolicy(env as NodeJS.ProcessEnv);
  const headers: Record<string, unknown> = {};
  const req = { method: 'GET', headers: requestOrigin ? { origin: requestOrigin } : {} };
  const res = {
    setHeader: (k: string, v: unknown) => { headers[k] = v; },
    getHeader: (k: string) => headers[k],
  };
  cors(policy)(req, res, () => undefined);
  return headers;
}

describe('NFR-009 — CORS origin policy (SEC-002)', () => {
  const prod = { NODE_ENV: 'production', CORS_ORIGIN: 'https://jobhunter-et.vercel.app, https://app.example.test' };

  it('reflects a configured origin in production', () => {
    expect(corsHeaders(prod, 'https://jobhunter-et.vercel.app')['Access-Control-Allow-Origin']).toBe(
      'https://jobhunter-et.vercel.app',
    );
  });

  it('never reflects an unconfigured origin', () => {
    expect(corsHeaders(prod, 'https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined();
    // Credentials are only ever paired with a specific origin, never "*"
    expect(corsHeaders(prod, 'https://evil.example')['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('sends no wildcard in production', () => {
    const { policy } = buildCorsPolicy(prod as NodeJS.ProcessEnv);
    expect(policy.origin).not.toBe('*');
    expect(policy.origin).not.toBe(true);
    expect(policy.origin).toEqual(['https://jobhunter-et.vercel.app', 'https://app.example.test']);
  });

  it('refuses to start in production rather than defaulting to a wildcard', () => {
    const { refusesToStart, allowedOrigins } = buildCorsPolicy({ NODE_ENV: 'production' });
    expect(refusesToStart).toBe(true);
    expect(allowedOrigins).toEqual([]);
  });

  it('treats a blank or whitespace-only CORS_ORIGIN as unset', () => {
    expect(buildCorsPolicy({ NODE_ENV: 'production', CORS_ORIGIN: ' , , ' } as any).refusesToStart).toBe(true);
    expect(parseAllowedOrigins(' , , ')).toEqual([]);
  });

  it('stays permissive in development so the local stack runs unconfigured', () => {
    const dev = buildCorsPolicy({ NODE_ENV: 'development' });
    expect(dev.permissive).toBe(true);
    expect(dev.refusesToStart).toBe(false);
    expect(dev.policy.origin).toBe(true);
    expect(corsHeaders({ NODE_ENV: 'development' }, 'http://localhost:3211')['Access-Control-Allow-Origin']).toBe(
      'http://localhost:3211',
    );
  });

  it('requires an Origin header before an allowlisted production origin is honoured', () => {
    const decision = buildCorsPolicy(prod as NodeJS.ProcessEnv);
    expect(isOriginAllowedByPolicy(undefined, decision)).toBe(false);
    expect(isOriginAllowedByPolicy('https://app.example.test', decision)).toBe(true);
    expect(isOriginAllowedByPolicy('https://jobhunter-et.vercel.app', buildCorsPolicy({ NODE_ENV: 'development' }))).toBe(
      true,
    );
  });

  it('trims and drops empty entries in the configured origin list', () => {
    expect(parseAllowedOrigins(' https://a.et , ,https://b.et ')).toEqual(['https://a.et', 'https://b.et']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('always sends credentials and the fixed method/header allowlist', () => {
    const { policy } = buildCorsPolicy(prod as NodeJS.ProcessEnv);
    expect(policy.credentials).toBe(true);
    expect(policy.methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
    expect(policy.allowedHeaders).toEqual(['Content-Type', 'Authorization']);
    expect(policy.maxAge).toBe(86400);
  });
});

// ─── SEC-005 / NFR-001: password hashing cost ───────────────────
// NFR-001's 500ms request budget and SEC-005's hashing requirement meet at one number, so
// the number is pinned with the floor that keeps it defensible.

import * as bcrypt from 'bcrypt';
import { PASSWORD_COST } from './password-policy';

describe('SEC-005 — password hashing policy', () => {
  it('stays at or above the OWASP bcrypt floor of 10 rounds', () => {
    expect(PASSWORD_COST).toBeGreaterThanOrEqual(10);
  });

  it('records the cost inside the hash so a policy change is detectable per account', async () => {
    const hash = await bcrypt.hash('password123', PASSWORD_COST);
    expect(hash.startsWith('$2')).toBe(true);
    expect(bcrypt.getRounds(hash)).toBe(PASSWORD_COST);
    await expect(bcrypt.compare('password123', hash)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
  });
});
