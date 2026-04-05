// Playwright config for ReplyPals local E2E.
// Run:
//   cd tests/playwright
//   npm i
//   npx playwright test

const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8150';

module.exports = defineConfig({
  testDir: './',
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list']],
});

