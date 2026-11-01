/**
 * SEC-007 — every upstream fetch is capped.
 *
 * Contract: no outbound request can hold a collection cycle, a Telegram send, or the dedup lock
 * behind it open indefinitely. The cap is a behaviour, so it is checked twice: once by running an
 * adapter and reading what it actually hands `fetch`, and once across the source tree, because a
 * call site that forgets the signal is invisible until a source hangs at 03:00.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ArbeitnowAdapter } from './arbeitnow.adapter';
import { FETCH_TIMEOUT_MS } from './job-source.adapter';

/** Every `fetch(...)` call in `src`, with its arguments matched by balanced parentheses. */
function fetchCallSites(src: string): string[] {
  const sites: string[] = [];
  const needle = 'fetch(';
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    sites.push(src.slice(i, j + 1));
  }
  return sites;
}

/** Production files that reach the network; spec files stub `fetch` and would only test the stub. */
function networkFiles(): { file: string; src: string }[] {
  const roots = [__dirname, path.resolve(__dirname, '../../telegram'), path.resolve(__dirname, '../../jobs')];
  const out: { file: string; src: string }[] = [];
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) continue;
      const file = path.join(root, name);
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes('fetch(')) out.push({ file: name, src });
    }
  }
  return out;
}

describe('SEC-007 — upstream fetch timeout cap', () => {
  it('bounds a source fetch inside the collection cycle it must not stall', () => {
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('passes an abort signal into fetch when an adapter runs', async () => {
    const recent = new Date().toISOString();
    const calls: { url: string; init: RequestInit }[] = [];
    const original = global.fetch;
    global.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          data: [{ slug: 'sec-007', company_name: 'Test', title: 'Engineer', description: 'd', remote: true, url: 'https://x.test/j', tags: [], job_types: [], location: 'EU', created_at: recent }],
          links: {},
        }),
      };
    }) as any;

    try {
      const jobs = await new ArbeitnowAdapter().fetchJobs({ since: new Date(0) });
      expect(jobs).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
      expect(calls[0].init.signal!.aborted).toBe(false);
    } finally {
      global.fetch = original;
    }
  });

  it('leaves no production fetch call site without a signal', () => {
    const files = networkFiles();
    expect(files.length).toBeGreaterThan(0);
    const uncapped = files.flatMap(({ file, src }) =>
      fetchCallSites(src)
        .filter((call) => !/\bsignal\b/.test(call))
        .map((call) => `${file}: ${call.slice(0, 120)}`),
    );
    expect(uncapped).toEqual([]);
  });
});
