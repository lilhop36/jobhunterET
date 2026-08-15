import { test, expect, Page } from '@playwright/test';

// QA admin — created via the live API during the verification protocol (not seeded).
const EMAIL = process.env.QA_ADMIN_EMAIL || 'qa-admin-1@jobhunter.et';
const PASSWORD = process.env.QA_ADMIN_PASSWORD || 'password123';

const isMobile = async (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: /Selam/ })).toBeVisible();
}

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('nav adapts to the viewport: sidebar on desktop, bottom nav on mobile', async ({ page }) => {
    const mobile = await isMobile(page);
    const sidebar = page.locator('aside');
    const bottomNav = page.locator('nav[aria-label="Primary"]');

    if (mobile) {
      await expect(sidebar).toBeHidden();
      await expect(bottomNav).toBeVisible();
      for (const label of ['Home', 'Matches', 'Saved', 'Applications', 'Profile']) {
        await expect(bottomNav.getByRole('link', { name: label, exact: true })).toBeVisible();
      }
      // Top-bar global search is hidden below md (768px).
      await expect(page.getByRole('searchbox', { name: 'Search jobs' })).toBeHidden();
    } else {
      await expect(sidebar).toBeVisible();
      await expect(bottomNav).toBeHidden();
      for (const group of ['Find', 'Track', 'You', 'Admin']) {
        // .first(): the "Admin" group label and the ADMIN chip on Sources both match
        await expect(sidebar.getByText(group, { exact: true }).first()).toBeVisible();
      }
      for (const label of [
        'Dashboard',
        'Matches',
        'Jobs',
        'Saved',
        'Applications',
        'Inbox',
        'Searches',
        'Profile',
        'Settings',
        'Sources',
      ]) {
        await expect(sidebar.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
      }
      // Admin-only section carries the ADMIN chip on Sources.
      await expect(sidebar.getByRole('link', { name: /^Sources/ }).getByText('Admin')).toBeVisible();
      await expect(page.getByRole('searchbox', { name: 'Search jobs' })).toBeVisible();
    }
  });

  test('active item follows the route', async ({ page }) => {
    const mobile = await isMobile(page);
    const sidebar = page.locator('aside');
    const bottomNav = page.locator('nav[aria-label="Primary"]');

    await (mobile ? bottomNav : sidebar).getByRole('link', { name: 'Matches' }).click();
    await expect(page).toHaveURL(/\/matches$/);

    if (mobile) {
      await expect(bottomNav.getByRole('link', { name: 'Matches' })).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(sidebar.locator('a[aria-current="page"]')).toContainText('Matches');
    }
  });

  test('account menu lists profile, settings and logout; Profile navigates', async ({ page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText(EMAIL)).toBeVisible();
    await expect(menu.getByText('Signed in as ADMIN')).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();

    await menu.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    // topbar also renders a page-title h1 — scope to main
    await expect(page.getByRole('main').getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  });

  test('global search filters jobs and keeps the query', async ({ page }) => {
    test.skip(await isMobile(page), 'global search lives in the desktop top bar');
    const search = page.getByRole('searchbox', { name: 'Search jobs' });

    await search.fill('Developer');
    await search.press('Enter');

    await expect(page).toHaveURL(/\/jobs\?q=Developer/);
    const rows = page.locator('main .job-row');
    // The query is applied: with live fixture jobs available, expect at least one row.
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    // The query survives in the top-bar input (and the page applied it).
    await expect(page.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('Developer');
  });

  test('mobile: Settings, Saved searches and Sources relocate into the Profile card', async ({ page }) => {
    test.skip(!(await isMobile(page)), 'mobile-only relocation');
    await page.goto('/profile');
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Saved searches' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sources' })).toBeVisible();
  });

  test('logout returns to login and clears the session', async ({ page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('aside')).toBeHidden();
    await expect(page.locator('nav[aria-label="Primary"]')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('jh_token'))).toBeNull();
  });
});
