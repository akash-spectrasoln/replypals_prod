const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8150';

function uniqEmail() {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `pw-local+${id}@test.replypals.in`;
}

test.describe('Localhost auth and dashboard flows', () => {
  test('signup, dashboard, logout, login, dashboard', async ({ page, request }) => {
    const health = await request.get('/health');
    expect(health.status()).toBe(200);

    const email = uniqEmail();
    const password = process.env.SIGNUP_PASSWORD || 'TestPass12345!';

    // Signup on localhost page (without api_base override).
    await page.goto(`${BASE_URL}/signup.html`, { waitUntil: 'domcontentloaded' });
    await page.fill('#name', 'Localhost User');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('#signup-btn');

    await page.waitForURL('**/dashboard.html', { timeout: 120_000 });
    await page.waitForSelector('#mainContent', { state: 'visible', timeout: 120_000 });
    await expect(page.locator('#greetEmail')).toContainText(email);

    // Logout from dashboard.
    await page.click('#avatarBtn');
    await page.click('#signOutBtn');
    await page.waitForURL('**/login.html', { timeout: 120_000 });

    // Login with the same account.
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('#login-btn');

    await page.waitForURL('**/dashboard.html', { timeout: 120_000 });
    await page.waitForSelector('#mainContent', { state: 'visible', timeout: 120_000 });
    await expect(page.locator('#greetEmail')).toContainText(email);
  });
});
