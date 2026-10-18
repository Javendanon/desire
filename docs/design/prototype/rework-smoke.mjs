// Browser regressions for the D03 review; all actions use the shared input driver.
import assert from 'node:assert/strict';

const TAB_LIMIT = 80;

async function activateWithKeyboard(page, selector) {
  for (let step = 0; step < TAB_LIMIT; step += 1) {
    const focused = await page.evaluate(
      `document.activeElement.matches(${JSON.stringify(selector)})`,
    );
    if (focused) {
      await page.press('Enter');
      return;
    }
    await page.press('Tab');
  }
  assert.fail(`control not reachable by Tab: ${selector}`);
}

async function assertHpEverywhere(page, hp) {
  assert.match(await page.read('[data-participant="aubrey"] .turn__meta'), hp);
  assert.match(await page.read('#side-panel-body .party-card__meta'), hp);
  await page.click('.rail [data-view="characters"]');
  assert.match(await page.read('.party-card__meta'), hp);
  await page.click('.rail [data-view="start"]');
  assert.match(await page.read('#start-party li'), hp);
  await page.click('.rail [data-view="encounter"]');
}

export async function checkLiveHp(page) {
  await page.click('.rail [data-view="encounter"]');
  await page.click('[data-action="reset-encounter"]');
  await page.click('[data-action="damage"]');
  await page.click('[data-action="open-sheet"]');
  await assertHpEverywhere(page, /17\/26 PV/);
  await activateWithKeyboard(page, '[data-action="heal"]');
  await assertHpEverywhere(page, /22\/26 PV/);
  await activateWithKeyboard(page, '[data-action="damage"]');
  await assertHpEverywhere(page, /17\/26 PV/);
  await activateWithKeyboard(page, '[data-action="reset-encounter"]');
  await assertHpEverywhere(page, /22\/26 PV/);
  await page.click('[data-action="close-panel"]');
}
