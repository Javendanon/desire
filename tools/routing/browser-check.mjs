// Run after pnpm build:wasm. Playwright is a local verification tool, not an app dependency.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tools/routing/browser.html`);
  await page.evaluate(() => {
    window.verification = import('./browser-check.ts').then((module) => module.runBrowserChecks())
      .catch((error) => { window.failure = error.message; });
  });
  await page.waitForFunction(() => window.failure ||
    document.querySelector('output').textContent === 'pending', { timeout: 30_000 });
  assert.equal(await page.evaluate(() => window.failure), undefined);
  await page.getByRole('button').click();
  const report = await page.evaluate(() => window.verification);
  assert.deepEqual(errors, [], 'browser page errors');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
