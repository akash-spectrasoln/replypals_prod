const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8150';

test.describe('Frontend smoke coverage', () => {
  test('public pages load and key controls exist', async ({ page, request }) => {
    const health = await request.get('/health');
    expect(health.status()).toBe(200);

    const pages = [
      { path: '/', selector: 'body' },
      { path: '/login.html?api_base=' + encodeURIComponent(BASE_URL), selector: '#email' },
      { path: '/signup.html?api_base=' + encodeURIComponent(BASE_URL), selector: '#email' },
      { path: '/forgot-password.html?api_base=' + encodeURIComponent(BASE_URL), selector: '#email' },
      { path: '/dashboard.html?api_base=' + encodeURIComponent(BASE_URL), selector: 'body' },
    ];

    for (const p of pages) {
      await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(p.selector, { timeout: 30000 });
    }
  });
});

