import { defineConfig } from '@playwright/test';

/**
 * Shell smoke tests run against the ALREADY-RUNNING stack (no webServer here):
 * frontend dev server on http://localhost:3211, NestJS backend on 3210, Postgres on 5433.
 * Start them first (see .freebuff/run.md), then: npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3211',
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop: left sidebar + top bar with global search (>=1024px).
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    // Mobile: bottom nav, no sidebar, top-bar search hidden (<768px).
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
