// Content contract for the optional prologue: every beat has copy in the message catalog and an
// illustration that is really in `public/`, so the entry screen cannot ship a broken scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { t } from '../src/app/messages.ts';
import { PROLOGUE_SECTIONS } from '../src/features/prologue/content.ts';

test('the prologue has at least one beat', () => {
  assert.ok(PROLOGUE_SECTIONS.length >= 1);
});

test('every beat names existing copy and an existing illustration', () => {
  for (const section of PROLOGUE_SECTIONS) {
    assert.match(section.still, /^\/assets\/[a-z0-9._-]+$/i, `${section.id} still path`);
    const file = new URL(`../public${section.still}`, import.meta.url);
    assert.ok(existsSync(file), `${section.id} is missing ${file.pathname}`);
    for (const key of [section.eyebrow, section.title, section.body]) {
      assert.ok(t(key).trim().length > 0, `${section.id} is missing copy for ${key}`);
    }
  }
});

test('the skip control never depends on the scroll experience', () => {
  assert.equal(t('prologue.skip'), 'Saltar a la mesa');
  assert.ok(t('prologue.label').trim().length > 0);
});
