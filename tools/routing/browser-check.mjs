// Run after pnpm build:wasm. Playwright is a local verification tool, not an app dependency.
import assert from 'node:assert/strict';
import { build, preview } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const outDir = 'outputs/d12-browser-build';
await build({ logLevel: 'silent', worker: { format: 'es' }, build: {
  outDir, rollupOptions: { input: 'tools/routing/browser.html' },
} });
const server = await preview({ build: { outDir }, preview: { port: 0, strictPort: false } });
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
  await page.waitForFunction(() => typeof window.runBrowserChecks === 'function');
  await page.evaluate(() => {
    window.verification = window.runBrowserChecks()
      .catch((error) => { window.failure = error.message; });
  });
  const box = await page.getByRole('button').boundingBox();
  assert.ok(box, 'interaction target is visible');
  // Send trusted input throughout the run instead of racing a fast search's completion.
  const clicks = setInterval(() => {
    page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      .catch((error) => errors.push(error.message));
  }, 10);
  let report;
  try {
    report = await page.evaluate(() => Promise.race([
      window.verification,
      new Promise((_, reject) => setTimeout(() => reject(new Error('browser timeout')), 30_000)),
    ]));
  } finally {
    clearInterval(clicks);
  }
  assert.equal(await page.evaluate(() => window.failure), undefined);
  assert.ok(report, 'browser report is required');
  assert.deepEqual(errors, [], 'browser page errors');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
