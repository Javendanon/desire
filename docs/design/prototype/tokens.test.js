// Guards the shipped theme tokens: every documented text pair must reach WCAG AA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const WCAG_AA = 4.5;
const SRGB_LINEAR_THRESHOLD = 0.03928;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722];

// foreground, background, minimum ratio taken from the accessibility note.
const PAIRS = [
  ['text', 'bg', WCAG_AA],
  ['muted', 'bg', WCAG_AA],
  ['text', 'panel', WCAG_AA],
  ['muted', 'panel', WCAG_AA],
  ['accent', 'panel', WCAG_AA],
  ['bg', 'accent', WCAG_AA],
  ['text', 'accent-deep', WCAG_AA],
  ['danger', 'panel', WCAG_AA],
  ['warn', 'panel', WCAG_AA],
  ['muted', 'raised', WCAG_AA],
];

function token(name) {
  const matches = [...css.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))];
  assert.equal(matches.length, 1, `tokens.css must define --color-${name} exactly once`);
  return matches[0][1];
}

function linearize(channel) {
  if (channel <= SRGB_LINEAR_THRESHOLD) return channel / 12.92;
  return ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
  return channels
    .map(linearize)
    .reduce((sum, value, index) => sum + value * LUMINANCE_WEIGHTS[index], 0);
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test('theme tokens keep WCAG AA contrast for the documented text pairs', () => {
  for (const [foreground, background, minimum] of PAIRS) {
    const ratio = contrast(token(foreground), token(background));
    const detail = `${foreground} on ${background} is ${ratio.toFixed(2)}, needs ${minimum}`;
    assert.ok(ratio >= minimum, detail);
  }
});
