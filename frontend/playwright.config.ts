import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Read ports from root .env (single source of truth) ──
function loadPort(key: string, fallback: number): number {
  try {
    const raw = readFileSync(resolve(import.meta.dirname, '..', '.env'), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? Number(m[1].trim()) : fallback;
  } catch {
    return fallback;
  }
}

const FRONTEND_PORT = loadPort('FRONTEND_PORT', 3211);

/**
 * Shell smoke tests run against the ALREADY-RUNNING stack (no webServer here):
 * frontend dev server on the configured port, NestJS backend, Postgres.
 * Start them first (see dev.sh or npm run dev), then: npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop: left sidebar + top bar with global search (>=1024px).
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    // Mobile: bottom nav, no sidebar, top-bar search hidden (<768px).
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
