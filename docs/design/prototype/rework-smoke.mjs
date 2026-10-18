// Browser regressions for the D03 review; all actions use the shared input driver.
import assert from 'node:assert/strict';

const TAB_LIMIT = 80;
const SEARCH_SETTLE_MS = 600;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export async function checkSearchDismissal(page, input = 'click') {
  for (const requestState of ['idle', 'empty', 'loading', 'error']) {
    await page[input]('[data-action="open-search"]');
    if (requestState === 'empty') {
      await page.evaluate(`(() => {
        const input = $('#lore-input');
        input.value = 'no-matching-entry';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(SEARCH_SETTLE_MS);
      assert.equal(await page.count('.result'), 0);
    } else {
      await page[input](`[data-demo-state="${requestState}"]`);
    }
    const close = '#search-dialog button[type="submit"]';
    assert.equal(await page.has(close), true, `visible cancel control in ${requestState}`);
    await page[input](close);
    assert.equal(await page.read('#search-dialog', 'open'), false);
    assert.equal(await page.evaluate('document.activeElement.dataset.action'), 'open-search');
  }
}

export async function checkInitiativeFocus(page) {
  await page.click('.rail [data-view="encounter"]');
  for (const id of ['aubrey', 'sera', 'celeste']) {
    const selector = `[data-participant="${id}"]`;
    await activateWithKeyboard(page, selector);
    assert.equal(await page.evaluate('document.activeElement.dataset.participant'), id);
    assert.equal(await page.read(selector, 'dataset.active'), 'true');
    assert.equal(await page.evaluate('document.activeElement.matches(":focus-visible")'), true);
    assert.notEqual(
      await page.evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none',
    );
  }
  await page.press('Tab');
  assert.equal(await page.evaluate('document.activeElement.dataset.participant'), 'thug');
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
