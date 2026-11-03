import { test, expect, Page, CDPSession, APIRequestContext } from '@playwright/test';

/**
 * NFR-006 — the low-bandwidth budget, measured instead of asserted.
 *
 * The requirement is written for a candidate on a modest laptop or an entry-level phone over a
 * weak Ethiopian connection, so the numbers have to come from a real browser over a throttled
 * socket: this spec runs Chromium's own network emulation (CDP `Network.emulateNetworkConditions`)
 * at Lighthouse's simulated-3G profile and reads the compressed bytes the browser actually paid
 * for (`Network.loadingFinished.encodedDataLength`) plus the Largest Contentful Paint the page
 * actually reached.
 *
 * It has to run against a production build — `npm run build && npm run start` — because the budget
 * describes what a user downloads, and the dev server's un-minified, un-hashed bundles are not
 * that artefact. Against a dev server these numbers mean nothing, which is worse than no test.
 *
 * Measured here: initial JS payload (<200 KB gzipped), total page weight (<1 MB), LCP (<3 s on
 * simulated 3G), and no autoplaying media. Not measured by this file, and still unproven: skeleton
 * loaders with no layout shift, `next/image` coverage, and whether job list/detail routes are
 * statically rendered. Those stay in the report's gap list rather than being folded into a
 * percentage this suite cannot earn.
 *
 * Status on a warm stack: `/` 0.86s, `/login` 0.66s, `/dashboard` 1.6-2.3s, `/matches` 1.8-2.2s,
 * all inside budget; `/jobs` measures 3.0-3.4s and fails, which is why this file is not in CI yet.
 *
 * ponytail: /jobs paints its first row only after the client has hydrated and a gzipped 57 KB first
 * page of 50 jobs has crossed the throttled socket. The fix is the one the SRS already asks for —
 * static/ISR rendering of the job list, NFR-006 clause 5 — not a larger budget. Revisit when that
 * lands, or when the initial page size becomes a product decision someone has made.
 */

const EMAIL = process.env.QA_EMAIL || 'amara@jobhunter.et';
const PASSWORD = process.env.QA_PASSWORD || 'demo1234';

/**
 * Lighthouse's simulated-3G profile (what "LCP on simulated 3G" means in practice): 1.6 Mbit/s
 * down, 750 kbit/s up, 150 ms round trip. Chrome DevTools' separate "Slow 3G" preset is 400 kbit/s
 * at 400 ms — stricter than the budget the SRS states, so it is not the gate here.
 */
const SIMULATED_3G = {
  offline: false,
  latency: 150,
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.floor((750 * 1024) / 8),
};

const BUDGET = {
  jsBytes: 200 * 1024,
  pageBytes: 1024 * 1024,
  lcpMs: 3_000,
};

type Sample = { jsBytes: number; totalBytes: number; lcpMs: number; lcpEl: string; requests: number; top: string };

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Throttle, navigate, and read back what the browser paid. The LCP observer is installed with
 * `addInitScript` so it exists before the first paint it is meant to measure.
 *
 * Cold cache, warm server. Warming the *server* (a plain HTTP GET primes Next's route module) and
 * not the *browser* matters: the first request a Next server handles for a route is slower than
 * every request after it, and that cost is the server's, not the user's link's — on a cold prod
 * server it was worth ~1.5s and pushed /matches over budget in one run and under it in the next.
 * A browser-navigation warm would instead have filled the HTTP cache and metered a returning
 * visitor (JS came out at 0.0 KB), which is not the first-visit budget the SRS is written against.
 */
async function measureOnSlow3G(page: Page, path: string): Promise<Sample> {
  await page.addInitScript(() => {
    (window as any).__lcp = 0;
    (window as any).__lcpEl = '';
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (entry.startTime <= (window as any).__lcp) continue;
        (window as any).__lcp = entry.startTime;
        const el = entry.element as HTMLElement | undefined;
        (window as any).__lcpEl = el
          ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')}`
          : '(none)';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', SIMULATED_3G);

  // loadingFinished carries only a requestId and a byte count, so the URL is captured from the
  // response that precedes it. Scripts are matched on the URL extension rather than Chrome's
  // `Script` resource type: Next preload hints arrive with other labels, and a budget on the code a
  // user downloads has to count every `.js` they download. Sourcemaps are excluded because a
  // production build should not ship them.
  const urlByRequestId = new Map<string, string>();
  client.on('Network.responseReceived', (e) => urlByRequestId.set(e.requestId, e.response.url));

  let jsBytes = 0;
  let totalBytes = 0;
  let requests = 0;
  const paid: { url: string; bytes: number }[] = [];
  client.on('Network.loadingFinished', (e) => {
    requests++;
    totalBytes += e.encodedDataLength;
    const url = urlByRequestId.get(e.requestId) ?? '';
    paid.push({ url, bytes: e.encodedDataLength });
    if (/\.js(\?|#|$)/.test(url) && !url.endsWith('.map')) jsBytes += e.encodedDataLength;
  });

  await page.goto(path, { waitUntil: 'load' });
  // LCP is reported after the paint that wins, which can land after `load` on a throttled socket.
  await page.waitForTimeout(2_500);
  const lcpMs = Number(await page.evaluate(() => (window as any).__lcp));
  const lcpEl = String(await page.evaluate(() => (window as any).__lcpEl));

  // The four heaviest responses, so a failing budget says what to cut instead of only that it was
  // cut too late.
  const top = paid
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 4)
    .map((p) => `${kb(p.bytes)} ${p.url.replace(/^http:\/\/localhost:\d+/, '').split('?')[0]}`)
    .join(' | ');

  return { jsBytes, totalBytes, lcpMs, lcpEl, requests, top };
}

/**
 * One token for the whole suite, taken from the API rather than the sign-in form. The UI login is
 * what runtime-verification.spec.ts covers; repeating it here would spend three more of SEC-005's
 * five logins per email per 15 minutes on every route and 429 the run — a throttle artefact, not a
 * performance finding. The app reads `jh_token`/`jh_user` from localStorage on mount, so seeding
 * them before the page script runs is the same authenticated start a returning user has.
 */
async function seedSession(page: Page, session: { token: string; user: unknown }) {
  await page.addInitScript(([blob]) => {
    localStorage.setItem('jh_token', blob.token);
    localStorage.setItem('jh_user', JSON.stringify(blob.user));
  }, [session]);
}

let session: { token: string; user: unknown } | null = null;

async function loginOnce(request: APIRequestContext) {
  if (session) return session;
  const res = await request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`NFR-006 needs an account to measure with: login returned ${res.status()}`);
  const body = await res.json();
  session = { token: body.accessToken, user: body.user };
  return session;
}

test.describe('NFR-006 — low-bandwidth budget on simulated 3G', () => {
  // A deliberately slow link is the subject of the test, not an accident: one route can legitimately
  // take 15 s of wall clock. Serial, so the throttle of one page never overlaps another.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  const routes = [
    { path: '/', authed: false },
    { path: '/login', authed: false },
    { path: '/dashboard', authed: true },
    { path: '/matches', authed: true },
    { path: '/jobs', authed: true },
  ];

  for (const route of routes) {
    test(`${route.path} stays inside the low-bandwidth budget (NFR-006)`, async ({ page, request }) => {
      if (route.authed) await seedSession(page, await loginOnce(request));
      // Prime Next's route module over an unthrottled socket, so what follows is the user's link.
      await request.get(route.path);
      const sample = await measureOnSlow3G(page, route.path);

      // eslint-disable-next-line no-console
      console.log(
        `[nfr006] ${route.path} — JS ${kb(sample.jsBytes)}, page ${kb(sample.totalBytes)}, ` +
          `LCP ${sample.lcpMs.toFixed(0)}ms on ${sample.lcpEl} over ${sample.requests} requests\n` +
          `         heaviest: ${sample.top}`,
      );

      expect(sample.jsBytes, `initial JS on ${route.path}`).toBeLessThan(BUDGET.jsBytes);
      expect(sample.totalBytes, `page weight on ${route.path}`).toBeLessThan(BUDGET.pageBytes);
      expect(sample.lcpMs, `LCP on ${route.path}`).toBeLessThan(BUDGET.lcpMs);
    });
  }

  test('no route autoplays media (NFR-006)', async ({ page }) => {
    for (const path of ['/', '/login', '/dashboard']) {
      await page.goto(path);
      await expect(page.locator('video[autoplay], audio[autoplay]'), `autoplaying media on ${path}`).toHaveCount(0);
    }
  });
});
