import { test, expect, Page } from '@playwright/test';

// Runtime verification against the live stack (open question U02 in
// docs/architecture-health/architecture-health-full-report.md). This is what CI's
// Gate 6 runs against a freshly provisioned + seeded SQLite database.
//
// Start the stack first (`bash dev.sh`), then:
//   npx playwright test e2e/runtime-verification.spec.ts --project=desktop
//
// Defaults are the account the demo seed creates (prisma/seed.ts) — that is what
// CI's Gate 6 database contains. A long-used local dev.db usually has no demo
// seed, so point the run at an account that exists there:
//   QA_EMAIL=… QA_PASSWORD=… npx playwright test …
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3210';
const EMAIL = process.env.QA_EMAIL || 'amara@jobhunter.et';
const PASSWORD = process.env.QA_PASSWORD || 'demo1234';

// Measured on the real stack, not guessed. The dominant term is the Next dev server compiling each
// route on first request: cold, the wizard test — register, three steps, profile read-back — takes
// 47s and the suite about 95s; with the routes already compiled the same six tests finish in 20s and
// the wizard in 16s. Password hashing is no longer a factor now that the auth path uses the native
// bcrypt binding at cost 11 (a login answers in 0.2–0.3s). These are live-stack checks against a dev
// server, so they get their own budget rather than the 45s project default, which the cold wizard
// alone would exceed.
test.setTimeout(150_000);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Two outcomes compete: the redirect, and the throttle banner that appears when the
  // server refused the attempt. Both are caught so neither leaks an unhandled rejection
  // into the worker when the other one wins.
  const throttled = page.getByText('Too many attempts');
  await Promise.race([
    page.waitForURL('**/dashboard').catch(() => undefined),
    throttled.waitFor({ state: 'visible' }).catch(() => undefined),
  ]);

  // Auth is throttled per email (AUTH_EMAIL_RATE_MAX, default 5 per 15 min) and per IP
  // (AUTH_RATE_MAX, default 10). Every test signs in again, so two suite runs back to
  // back exhaust the window and the UI simply stays on /login. A bare waitForURL
  // timeout would send the next reader hunting a product bug that is not there, so the
  // throttle is named before anything else is.
  if ((await throttled.count()) > 0) {
    throw new Error(
      `Sign-in for ${EMAIL} hit the auth throttle, not a defect. Allow 15 minutes, or ` +
        `restart the backend with AUTH_EMAIL_RATE_MAX=50 AUTH_RATE_MAX=100 (docs/ops-runbook.md).`,
    );
  }
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Call the API from inside the app with the token the UI stored. */
async function apiAs(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, {
      headers: { authorization: `Bearer ${localStorage.getItem('jh_token')}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

test('health endpoint answers on the documented port', async ({ request }) => {
  // BACKEND_URL is the same variable the launcher and the smoke test honour.
  const res = await request.get(`${BACKEND}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('protected API rejects anonymous callers', async ({ request }) => {
  const res = await request.get(`${BACKEND}/api/matches`);
  expect(res.status()).toBe(401);
});

test('sign-in issues a session and the shell renders', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('main')).toBeVisible();
  await page.screenshot({ path: 'e2e-artifacts/dashboard.png', fullPage: true });
});

test('authenticated matches call returns scored data', async ({ page }) => {
  await signIn(page);
  const { status, body } = await apiAs(page, '/api/matches');
  expect(status).toBe(200);
  expect(body.items.length).toBeGreaterThan(0);

  // One posting must not occupy two slots in one user's list.
  const jobIds = body.items.map((m: any) => m.jobId);
  expect(new Set(jobIds).size).toBe(jobIds.length);
});

test('matches page renders no duplicate postings', async ({ page }) => {
  await signIn(page);
  await page.goto('/matches');
  await expect(page.locator('.subtitle')).toBeVisible();

  const rows = page.locator('a.job-row');
  await expect(rows.first()).toBeVisible();
  const hrefs = await rows.evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  expect(new Set(hrefs).size).toBe(hrefs.length);

  // One posting = one slot. A posting is identified by the fields the row shows,
  // so the assertion is title + company + location: that is what a stored Job row
  // is, and what the (sourceId, fingerprint) ingestion guard deduplicates on.
  const labels = await rows.evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector('.title')?.textContent?.trim() ?? '';
      const meta = el.querySelector('.meta')?.textContent?.trim() ?? '';
      const parts = meta.split('·').map((p) => p.trim());
      return `${title}|${parts[0]}|${parts[1] ?? ''}`;
    }),
  );
  expect(new Set(labels).size).toBe(labels.length);

  // Reported, not asserted: some sources publish one page per city for the same
  // opening, so the rows above can still read as the same job twice to a human.
  // Stored data cannot separate that from two genuine openings in two cities, so
  // the merge is a product decision — measure it with
  // `npm run duplicates:report -- --content` in backend/.
  const byHeadline = new Map<string, number>();
  for (const label of labels) {
    const [title, company] = label.split('|');
    byHeadline.set(`${title}|${company}`, (byHeadline.get(`${title}|${company}`) ?? 0) + 1);
  }
  const twins = [...byHeadline.values()].filter((n) => n > 1).reduce((n, k) => n + k - 1, 0);
  console.log(`[matches] ${labels.length} rows, ${twins} extra row(s) sharing title+company with another row`);

  await page.screenshot({ path: 'e2e-artifacts/matches.png', fullPage: false });
});
