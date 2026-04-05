const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

function extensionPath() {
  return path.resolve(__dirname, '../../extension');
}

async function launchExtension() {
  const extPath = extensionPath();
  const userDataDir = path.resolve(__dirname, '.pw-ext-user-data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = sw.url().split('/')[2];
  return { context, extensionId };
}

test.describe('Extension UI e2e', () => {
  test('popup supports tabs and template form fill', async () => {
    const { context, extensionId } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);

      await page.waitForSelector('.mode-tab[data-mode="rewrite"]');
      await page.click('.mode-tab[data-mode="templates"]');
      await page.waitForSelector('#templatesList');

      // Open first template and ensure fields are fillable.
      await page.click('.template-item');
      await page.waitForSelector('#templateFormOverlay', { state: 'visible' });
      await page.waitForSelector('.template-form-input');

      const firstInput = page.locator('.template-form-input').first();
      await firstInput.fill('Playwright test value');
      await expect(firstInput).toHaveValue('Playwright test value');

      // Generate button exists and is clickable.
      await page.click('#templateFormGenerate');
      await expect(page.locator('#templateFormGenerate')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('content script shows input badge and selection toolbar', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8150/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
          <textarea id="editor" style="width:500px;height:120px;">Please do the needful and revert back.</textarea>
          <div id="sel" contenteditable="true">Select this sentence to view actions.</div>
        `;
        document.body.appendChild(wrap);
      });

      await page.waitForTimeout(1200); // allow content script bootstrapping

      // R-sign/badge behavior on focused editable field.
      await page.click('#editor');
      await page.waitForSelector('#rp-input-badge.rp-badge-visible', { timeout: 10000 });
      await expect(page.locator('#rp-input-badge')).toBeVisible();

      // Bulb/pill quick actions should appear and include 3 icons.
      await page.hover('#rp-input-badge');
      await page.waitForSelector('#rp-input-pill.rp-pill-visible', { timeout: 10000 });
      await expect(page.locator('#rp-input-pill .rp-ip-btn')).toHaveCount(3);
      await expect(page.locator('#rp-input-pill .rp-ip-btn.rp-ip-rewrite')).toBeVisible();
      await expect(page.locator('#rp-input-pill .rp-ip-btn.rp-ip-reply')).toBeVisible();
      await expect(page.locator('#rp-input-pill .rp-ip-btn.rp-ip-popup')).toBeVisible();

      // Selection toolbar behavior.
      await page.evaluate(() => {
        const el = document.querySelector('#sel');
        if (!el) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.waitForSelector('#rp-sel-toolbar', { timeout: 10000 });
      // Selected paragraph should show full icon row (rewrite/write/reply/summarize/explain/fix/translate/tone).
      await expect(page.locator('#rp-sel-toolbar button')).toHaveCount(8);
      // Click summarize icon path (4th icon index 3) to ensure it is actionable.
      await page.locator('#rp-sel-toolbar button').nth(3).dispatchEvent('mousedown');
    } finally {
      await context.close();
    }
  });
});

