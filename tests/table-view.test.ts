import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hpPercent,
  initials,
  initiativeOrder,
  medalLabel,
  ringDash,
  statLine,
  toMedal,
  toneColor,
  type Combatant,
} from '../src/lib/ui/table-view.ts';

const aubrey: Combatant = {
  id: 'aubrey', name: 'Aubrey', fullName: 'Aubrey Valcourt', role: 'Exploradora', side: 'ally',
  initiative: 18, hp: 22, maxHp: 26, armorClass: 16, condition: 'Concentrada',
};
const thug: Combatant = {
  id: 'thug', name: 'Matón', fullName: 'Matón de Xanathar', role: 'Hostil', side: 'enemy',
  initiative: 12, hp: 11, maxHp: 16, armorClass: 13, condition: '',
};

test('the HP ring is empty, partial or full in proportion to HP', () => {
  assert.equal(ringDash(0, 24), '0.0 150.8');
  assert.equal(ringDash(0.5, 24), '75.4 150.8');
  assert.equal(ringDash(1, 24), '150.8 150.8');
});

test('the HP ring clamps out-of-range ratios instead of overflowing', () => {
  assert.equal(ringDash(-1, 24), '0.0 150.8');
  assert.equal(ringDash(3, 24), '150.8 150.8');
});

test('zero max HP does not divide by zero', () => {
  assert.equal(hpPercent({ ...aubrey, hp: 0, maxHp: 0 }), '0%');
});

test('side and turn are spoken in the label, not only shown by colour', () => {
  assert.match(medalLabel(thug, false), /enemigo/);
  assert.match(medalLabel(aubrey, true), /aliado.*su turno$/);
  assert.doesNotMatch(medalLabel(aubrey, false), /su turno/);
});

test('a medal marks the current and the selected combatant independently', () => {
  const medal = toMedal(thug, 'aubrey', 'thug');
  assert.equal(medal.current, false);
  assert.equal(medal.selected, true);
  assert.equal(medal.enemy, true);
  assert.equal(medal.caption, '12 · 11/16');
});

test('initiative order is highest first and stable on ties', () => {
  const tie = { ...thug, id: 'tie', initiative: 18 };
  const ids = initiativeOrder([thug, aubrey, tie]).map((c) => c.id);
  assert.deepEqual(ids, ['aubrey', 'tie', 'thug']);
});

test('initials keep two letters with a capital first', () => {
  assert.equal(initials('celeste'), 'Ce');
  assert.equal(initials(' Sera '), 'Se');
});

test('the stat line includes the condition only when there is one', () => {
  assert.equal(statLine(aubrey), '22/26 PV · CA 16 · Concentrada');
  assert.equal(statLine(thug), '11/16 PV · CA 13');
});

test('tones map to the design tokens', () => {
  assert.equal(toneColor('failure'), 'var(--color-ember)');
  assert.equal(toneColor('voice'), 'var(--color-lantern)');
});
