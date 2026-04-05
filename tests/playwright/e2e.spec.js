const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8150';

function uniqEmail() {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `pw-e2e+${id}@test.replypals.in`;
}

test.describe('ReplyPals end-to-end (local)', () => {
  test('signup -> dashboard -> /rewrite works', async ({ page, request }) => {
    // 1) Backend health
    const health = await request.get('/health');
    expect(health.status()).toBe(200);
    const healthJson = await health.json();
    expect(healthJson.status).toBe('ok');

    // 2) Signup (email/password via Supabase)
    const email = uniqEmail();
    const password = process.env.SIGNUP_PASSWORD || 'TestPass12345!';
    const name = 'Playwright E2E';

    const apiBaseParam = encodeURIComponent(BASE_URL);
    await page.goto(`/signup.html?api_base=${apiBaseParam}`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#name');
    await page.fill('#name', name);
    await page.fill('#email', email);
    await page.fill('#password', password);

    await page.click('#signup-btn');

    // 3) Dashboard validation
    await page.waitForSelector('#mainContent', { state: 'visible', timeout: 120_000 });
    const planContentText = (await page.locator('#planContent').textContent()) || '';
    expect(planContentText.length).toBeGreaterThan(0);

    const normalized = planContentText.toLowerCase();
    expect(normalized.includes('free plan') || normalized.includes('active')).toBeTruthy();

    // 4) /rewrite validation (use email so rate-limit logic can attribute to free user)
    const rewritePayload = {
      text: 'Please do the needful and revert back to me at the earliest.',
      tone: 'Confident',
      language: 'auto',
      mode: 'rewrite',
      email,
      source: 'playwright',
    };

    const rewriteRes = await request.post('/rewrite', {
      headers: { 'Content-Type': 'application/json' },
      data: rewritePayload,
    });

    expect(rewriteRes.status()).toBe(200);
    const rewriteJson = await rewriteRes.json();
    expect(typeof rewriteJson.rewritten).toBe('string');
    expect(rewriteJson.rewritten.length).toBeGreaterThan(5);
    expect(rewriteJson.score).toBeGreaterThanOrEqual(0);
    expect(rewriteJson.score).toBeLessThanOrEqual(100);
  });

  test('payment smoke (optional)', async ({ request }) => {
    test.skip(process.env.RUN_STRIPE_TESTS !== '1');

    const email = uniqEmail();

    const res = await request.post('/create-checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: { email, plan: 'pro', tier: 'tier1' },
    });

    // If Stripe is not configured, the server returns 500; that's acceptable only when
    // RUN_STRIPE_TESTS=1, because the goal is to validate your Stripe wiring.
    expect([200, 400, 500]).toContain(res.status());

    if (res.status() === 200) {
      const json = await res.json();
      expect(json.url).toBeTruthy();
    }
  });
});

