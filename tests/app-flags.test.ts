// Browser runtime flags: the same `name = on|off` file the Rust core reads. Off by default, so an
// absent meta tag, an empty file or an unreadable one keeps the pre-flag shell.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CAMPAIGN_HUB, flagsFromPage, parseFlags } from '../src/app/flags.ts';

test('no flags file leaves the campaign hub off', () => {
  assert.equal(parseFlags('').has(CAMPAIGN_HUB), false);
  assert.equal(parseFlags('# only a comment\n').has(CAMPAIGN_HUB), false);
});

test('a line turns the campaign hub on', () => {
  assert.equal(parseFlags('campaign_hub = on\n').has(CAMPAIGN_HUB), true);
  assert.equal(parseFlags('  campaign_hub=on  ').has(CAMPAIGN_HUB), true);
});

test('later lines win and off removes a flag again', () => {
  assert.equal(parseFlags('campaign_hub = on\ncampaign_hub = off\n').has(CAMPAIGN_HUB), false);
});

test('a malformed line is an explicit error naming the line', () => {
  assert.throws(
    () => parseFlags('campaign_hub = on\ncampaign_hub = yes\n'),
    /line 2: "campaign_hub = yes"/,
  );
});

test('the page meta carries the flags', () => {
  const flags = flagsFromPage(() => '# gate\ncampaign_hub = on\n');
  assert.equal(flags.has(CAMPAIGN_HUB), true);
});

test('a page without the meta tag keeps the pre-flag shell', () => {
  assert.equal(flagsFromPage(() => null).has(CAMPAIGN_HUB), false);
});

test('an unreadable flags file falls back to the default instead of breaking the page', () => {
  assert.equal(flagsFromPage(() => 'campaign_hub = yes').has(CAMPAIGN_HUB), false);
});
