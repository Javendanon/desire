// Mounted-component regression: prop replacement must not leak one encounter's local edits.
import { mount, tick, unmount } from 'svelte';

import { DEMO_RULE_ENTRIES } from '../../src/features/characters/demo-sheets.ts';
import { createRuleBook } from '../../src/features/characters/rule-book.ts';
import { createDemoEncounter } from '../../src/features/encounters/demo-encounter.ts';
import type { EncounterBundle } from '../../src/features/encounters/encounter-model.ts';
import TacticalOverlay from '../../src/features/encounters/TacticalOverlay.svelte';

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`encounter replacement: ${message}`);
}

async function press(root: HTMLElement, label: string): Promise<void> {
  const button = [...root.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label || entry.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`encounter replacement: missing button ${label}`);
  button.focus();
  button.click();
  await tick();
}

function panelText(root: HTMLElement): string {
  return root.querySelector('#tactical-panel')?.textContent ?? '';
}

async function editEncounter(root: HTMLElement): Promise<void> {
  await press(root, 'Next turn');
  await press(root, 'Next turn');
  await press(root, 'Next turn');
  await press(root, "Lower Demo Brute's HP by 1, locally");
  await press(root, 'Demo Brute');
  await press(root, 'Dismiss Unknown rule in this session only');
  expect(panelText(root).includes('Round 6 · Turn: Demo Mage'), 'local turn was not advanced');
  expect(panelText(root).includes('10 of 16 HP'), 'local HP was not edited');
  expect(root.textContent?.includes('1 round left') ?? false, 'condition did not tick');
}

async function expectReset(root: HTMLElement): Promise<void> {
  expect(!root.querySelector('#character-sheet'), 'selected sheet leaked across identities');
  expect(panelText(root).includes('Round 1 · Turn: Demo Warden'), 'round or turn leaked');
  expect(panelText(root).includes('11 of 16 HP'), 'HP override leaked');
  const order = root.querySelector('.order')?.textContent ?? '';
  expect(!order.includes('local change'), 'local change flag leaked');
  await press(root, 'Demo Brute');
  const sheet = root.querySelector('#character-sheet');
  expect(sheet?.textContent?.includes('2 rounds left') ?? false, 'duration override leaked');
  expect(sheet?.textContent?.includes('No fixed duration recorded') ?? false, 'dismissal leaked');
}

function expectEditsPreserved(root: HTMLElement): void {
  const sheet = root.querySelector('#character-sheet');
  expect(!!sheet, 'same-identity refresh closed the sheet');
  expect(panelText(root).includes('Round 6 · Turn: Demo Mage'), 'same identity lost round/turn');
  expect(panelText(root).includes('10 of 16 HP'), 'same identity lost HP override');
  expect(sheet?.textContent?.includes('1 round left') ?? false, 'same identity lost duration');
  expect(
    !sheet?.textContent?.includes('No fixed duration recorded'), 'same identity lost dismissal',
  );
}

async function expectRemovedOpenerReset(
  root: HTMLElement,
  props: { bundle: EncounterBundle },
): Promise<void> {
  props.bundle = {
    ...props.bundle,
    encounter: { ...props.bundle.encounter, id: 'without-brute' },
    participants: props.bundle.participants.slice(0, 1),
    sheets: props.bundle.sheets.slice(0, 1),
  };
  await tick();
  expect(!root.querySelector('#character-sheet'), 'removed actor sheet stayed open');
  expect(!panelText(root).includes('Demo Brute'), 'old opener was not removed');
  expect(document.activeElement?.id === 'tactical-launcher', 'removed opener lost keyboard focus');
}

async function expectClaimedEscapeIgnored(root: HTMLElement): Promise<void> {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  event.preventDefault();
  window.dispatchEvent(event);
  await tick();
  expect(!!root.querySelector('#character-sheet'), 'a claimed Escape closed the sheet');
}

async function exerciseReplacements(
  root: HTMLElement,
  props: { bundle: EncounterBundle },
): Promise<void> {
  const initial = createDemoEncounter('fixture-place');
  await press(root, 'Show encounter · Fixture place');
  await editEncounter(root);
  props.bundle = { ...props.bundle, encounter: { ...props.bundle.encounter, revision: 2 } };
  await tick();
  expectEditsPreserved(root);
  await expectClaimedEscapeIgnored(root);
  props.bundle = { ...initial, encounter: { ...initial.encounter, id: 'another-encounter' } };
  await tick();
  expect(document.activeElement?.id === 'tactical-launcher', 'reset lost keyboard focus');
  await expectReset(root);
  await press(root, 'Close sheet');
  props.bundle = { ...props.bundle, encounter: { ...props.bundle.encounter, round_number: 5 } };
  await tick();
  await press(root, 'Undo local changes');
  await editEncounter(root);
  props.bundle = { ...initial, encounter: {
    ...initial.encounter, id: 'another-encounter', campaign_id: 'another-campaign',
  } };
  await tick();
  await expectReset(root);
}

/** Runs in Chrome through Vite, using the actual Svelte component and reactive props. */
export async function checkEncounterReplacement(): Promise<void> {
  const root = document.createElement('div');
  document.body.append(root);
  const initial = createDemoEncounter('fixture-place');
  const props = $state({
    bundle: { ...initial, encounter: { ...initial.encounter, round_number: 5 } },
  });
  const component = mount(TacticalOverlay, {
    target: root,
    props: {
      get bundle() { return props.bundle; },
      rules: createRuleBook(DEMO_RULE_ENTRIES),
      placeName: 'Fixture place',
      subscribePlace: () => () => {},
      effectsStorage: { getItem: () => null, setItem: () => {} },
    },
  });
  try {
    await tick();
    await exerciseReplacements(root, props);
    await expectRemovedOpenerReset(root, props);
  } finally {
    await unmount(component);
    root.remove();
  }
}
