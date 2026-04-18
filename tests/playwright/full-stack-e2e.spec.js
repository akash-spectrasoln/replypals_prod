/**
 * End-to-end smoke: API + marketing site + dashboard + admin + extension (import check).
 * Run with API + static site up:
 *   API_URL=http://127.0.0.1:8150 FRONTEND_URL=http://127.0.0.1:4173 npx playwright test full-stack-e2e.spec.js
 */
const { test, expect } = require('@playwright/test');

const API_URL = process.env.API_URL || 'http://127.0.0.1:8150';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'changeme123!';

test.describe('Full stack production smoke', () => {
  test('API health, pricing, and CORS preflight', async ({ request }) => {
    const h = await request.get(`${API_URL}/health`);
    expect(h.status()).toBe(200);
    const hj = await h.json();
    expect(['ok', 'degraded']).toContain(hj.status);

    const pr = await request.get(`${API_URL}/pricing`);
    expect(pr.status()).toBe(200);
    const pj = await pr.json();
    expect(pj).toBeTruthy();
    expect(typeof pj.plans === 'object' || pj.currency != null || Array.isArray(pj.plans)).toBeTruthy();

    const opt = await request.fetch(`${API_URL}/admin/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://replypals.in',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect([200, 204]).toContain(opt.status());
  });

  test('home and auth pages load with styled body', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    const hasStyles =
      (await page.locator('link[rel="stylesheet"], style').count()) > 0 ||
      (await page.locator('[class*="bg-"], [class*="text-"]').count()) > 0;
    expect(hasStyles).toBeTruthy();

    await page.goto('/login.html?api_base=' + encodeURIComponent(API_URL), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#email')).toBeVisible();
  });

  test('dashboard loads plan section', async ({ page }) => {
    await page.goto('/dashboard.html?api_base=' + encodeURIComponent(API_URL), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('body')).toBeVisible();
    await page.waitForSelector('#planContent, #mainContent', { timeout: 60000 });
  });

  test('admin API: JWT reaches protected dashboard-stats', async ({ request }) => {
    const login = await request.post(`${API_URL}/admin/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    if (login.status() === 401) {
      test.skip(true, 'Set ADMIN_USERNAME / ADMIN_PASSWORD to match the running API (.env).');
    }
    expect(login.status()).toBe(200);
    const body = await login.json();
    expect(body.token).toBeTruthy();

    const stats = await request.get(`${API_URL}/admin/dashboard-stats`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(stats.status()).toBe(200);
    const sj = await stats.json();
    expect(typeof sj.total_users).toBe('number');
  });

  test('admin page: login shell loads in browser', async ({ page }) => {
    await page.goto(`${API_URL}/admin/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 30000 });
  });
});
