import { test, expect, Page } from '@playwright/test';

// Phase 0.2 — persistence. Run `-g "create data"` first, restart the stack,
// then run `-g "survives restart"` to prove the data is DB-backed, not in memory.
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || 'qa-admin-1@jobhunter.et';
const ADMIN_PASS = process.env.QA_ADMIN_PASSWORD || 'password123';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

async function api(page: Page, path: string, init: RequestInit = {}) {
  return page.evaluate(
    async ({ p, i }) => {
      const res = await fetch(p, {
        ...i,
        headers: { ...(i.headers as any), authorization: `Bearer ${localStorage.getItem('jh_token')}` },
      });
      return res.json();
    },
    { p: `/api${path}`, i: init },
  );
}

test('create data via UI: save job, move application, upload CV', async ({ page }) => {
  await login(page);

  // --- save a job via the UI (pick one that is genuinely not saved/applied yet) ---
  const jobs: any[] = await api(page, '/jobs');
  expect(jobs.length).toBeGreaterThan(0);
  const job = jobs.find((j: any) => !j.saved && !j.application) ?? jobs[0];
  if (job.saved) {
    // idempotency: clean slate via API before UI steps
    await api(page, `/saved-jobs/${job.id}`, { method: 'POST' });
  }
  await page.goto(`/jobs/${job.id}`);
  const saveBtn = page.getByRole('button', { name: /^Save$/ });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  await expect(page.getByRole('button', { name: /^Saved$/ })).toBeVisible();

  // --- create + move an application via the UI ---
  const applyBtn = page.getByRole('button', { name: 'Apply' });
  await applyBtn.click(); // arms
  await applyBtn.click(); // confirms
  await expect(page.getByText('Application tracked — good luck!')).toBeVisible();
  await page.goto('/applications');
  const appliedCard = page.locator('.card', { hasText: /^APPLIED/ }).first();
  await expect(appliedCard).toBeVisible();
  await appliedCard.getByRole('button', { name: 'ASSESSMENT' }).first().click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.card', { hasText: /^ASSESSMENT/ }).first()).toBeVisible();

  // --- upload a CV via the UI ---
  await page.goto('/profile');
  await page.setInputFiles('#cv-file', {
    name: 'qa-persistence-cv.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 persistence-test\n%%EOF'),
  });
  await expect(page.getByText('qa-persistence-cv.pdf')).toBeVisible();

  // --- confirm via API (server-side truth) ---
  const saved = await api(page, '/saved-jobs');
  expect(saved.some((s: any) => s.id === job.id)).toBe(true);
  const apps: any = await api(page, '/applications');
  const mine = apps.applications.find((a: any) => a.jobId === job.id);
  expect(mine?.stage).toBe('ASSESSMENT');
  // list endpoint now reports the same user state as detail (regression guard)
  const jobsAfter = await api(page, '/jobs');
  expect(jobsAfter.find((j: any) => j.id === job.id)?.saved).toBe(true);
  const cv = await api(page, '/profile/cv');
  expect(cv?.originalName).toBe('qa-persistence-cv.pdf');
});

test('data survives restart: saved job, application stage, CV all still present', async ({ page }) => {
  // Run this AFTER restarting the backend + frontend.
  await login(page);

  const saved: any[] = await api(page, '/saved-jobs');
  expect(saved.length).toBeGreaterThan(0);

  const apps: any = await api(page, '/applications');
  expect(apps.applications.length).toBeGreaterThan(0);
  expect(apps.applications.some((a: any) => a.stage === 'ASSESSMENT')).toBe(true);

  const cv = await api(page, '/profile/cv');
  expect(cv?.originalName).toBe('qa-persistence-cv.pdf');

  // UI-level check too
  await page.goto('/saved');
  await expect(page.locator('main .job-row').first()).toBeVisible();
  await page.goto('/profile');
  await expect(page.getByText('qa-persistence-cv.pdf')).toBeVisible();
});
