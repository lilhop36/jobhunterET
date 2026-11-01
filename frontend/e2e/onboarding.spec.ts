import { test, expect, Page } from '@playwright/test';

// FR-003d (SRS §12): "After first login, the user is offered a 3-step wizard,
// skippable and resumable: 1. Roles … 2. Skills … 3. Locations & preferences."
//
// Run against the live stack (`bash dev.sh`), then:
//   npx playwright test e2e/onboarding.spec.ts --project=desktop
//
// Auth endpoints are throttled per IP (10 calls / 15 min — see AUTH_RATE_MAX), so
// this file spends exactly two of them: one register and one login. The wizard
// writes the profile, so it runs as a throwaway account that is deleted with the
// token it already has; the shared QA admin keeps its matching profile intact.
const INVITE_CODE = process.env.REGISTRATION_INVITE_CODE || '';
const PASSWORD = 'password123';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3210';
// process.pid is per Playwright worker, so the two projects never share an account.
const email = `qa-onboarding-${process.pid}-${Date.now()}@jobhunter.et`;

async function apiAs(page: Page, path: string, init: { method?: string; body?: string } = {}) {
  return page.evaluate(
    async ({ p, i }) => {
      const res = await fetch(p, {
        method: i.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${localStorage.getItem('jh_token')}`,
        },
        body: i.body,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { p: path, i: init },
  );
}

// Next dev compiles every route on its first hit (~10 s each) and this spec walks
// login → dashboard → onboarding three times, so it needs more than the 45 s default.
test.setTimeout(180_000);

test('FR-003d — onboarding wizard: three steps, resumable, skippable', async ({ page, request }) => {
  const registered = await request.post(`${BACKEND}/api/auth/register`, {
    data: { email, password: PASSWORD, ...(INVITE_CODE ? { inviteCode: INVITE_CODE } : {}) },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const { accessToken } = await registered.json();

  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    // A freshly registered profile is empty and not yet onboarded.
    const before = await apiAs(page, '/api/profile');
    expect(before.status).toBe(200);
    expect(before.body.onboardDone).toBeFalsy();

    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Onboarding wizard' })).toBeVisible();
    await expect(page.getByText('Three quick steps. Each one makes your matches better.')).toBeVisible();
    // The SRS names three steps; the indicator exposes them by accessible label.
    for (const label of ['Step 1: Roles', 'Step 2: Skills', 'Step 3: Locations']) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    // Skippable: leaving with "Skip for now" writes nothing.
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await page.waitForURL('**/dashboard');
    const skipped = await apiAs(page, '/api/profile');
    expect(skipped.body.onboardDone).toBeFalsy();
    expect(skipped.body.targetRoles).toEqual(before.body.targetRoles);
    await page.goto('/onboarding');

    // Step 1 — nothing selected yet, so the wizard will not advance.
    await expect(page.getByRole('button', { name: /^Step 2/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Next/ })).toBeDisabled();
    await page.fill('#role-draft', 'QA Accountant');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByRole('button', { name: /QA Accountant · HIGH/ })).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();

    // Step 2 — skills typed in, then normalised by the API.
    await expect(page.getByLabel('Step 1: Roles (done)')).toBeVisible();
    await page.fill('#skill-draft', 'Bookkeeping');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByRole('button', { name: /Bookkeeping/ })).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();

    // Step 3 — location tiers, remote preference, employment types.
    await expect(page.getByLabel('Step 2: Skills (done)')).toBeVisible();
    await expect(page.getByLabel('Step 3: Locations')).toBeVisible();
    await page.getByRole('button', { name: /^Remote$/ }).click();
    await expect(page.getByRole('button', { name: /Remote · MEDIUM/ })).toBeVisible();
    // Remote ships off for a new profile, so it is a preference the user turns on here.
    await expect(page.getByLabel('Open to remote work')).not.toBeChecked();
    await page.getByLabel('Open to remote work').check();
    await page.getByRole('button', { name: /CONTRACT/ }).click();
    await page.getByRole('button', { name: /Finish/ }).click();
    await page.waitForURL('**/dashboard');

    // What the user entered is what the matcher will read.
    const saved = await apiAs(page, '/api/profile');
    expect(saved.body.onboardDone).toBe(true);
    expect(saved.body.remote).toBe(true);
    expect(saved.body.targetRoles.map((r: any) => r.role)).toContain('QA Accountant');
    expect(saved.body.skills.map((s: string) => s.toLowerCase())).toContain('bookkeeping');
    expect(saved.body.locationTiers.map((l: any) => l.region)).toContain('Remote');
    expect(saved.body.employmentTypes).toContain('CONTRACT');
    await page.screenshot({ path: 'e2e-artifacts/onboarding-finished.png', fullPage: true });

    // Resumable: reopening prefills from the saved profile instead of starting blank.
    await page.goto('/onboarding');
    await expect(page.getByRole('button', { name: /QA Accountant · HIGH/ })).toBeVisible();
    await page.getByLabel('Step 2: Skills').click();
    await expect(page.getByRole('button', { name: /Bookkeeping/ })).toBeVisible();
    await page.getByLabel('Step 3: Locations').click();
    await expect(page.getByRole('button', { name: /Remote ·/ })).toBeVisible();
    await page.screenshot({ path: 'e2e-artifacts/onboarding-resumed.png', fullPage: false });
  } finally {
    // Leave the dev database as it was found — no orphan QA users.
    await request.post(`${BACKEND}/api/account/delete`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }
});
