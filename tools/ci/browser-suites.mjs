// The browser suites the gate runs, listed in tests/browser/gate-suites.json. Cards add their own
// suites there, inside their scope, instead of editing this runner. A manual tool such as
// engine-smoke.mjs stays out of the gate by not being listed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SUITES_DIR = 'tests/browser';
export const SUITES_FILE = join(SUITES_DIR, 'gate-suites.json');

export function loadSuites(file = SUITES_FILE, dir = SUITES_DIR) {
  const names = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`${file} must list at least one suite`);
  }
  return names.map((name) => suitePath(name, dir));
}

function suitePath(name, dir) {
  if (typeof name !== 'string' || !/^[\w.-]+\.mjs$/.test(name)) {
    throw new Error(`invalid suite name in ${SUITES_FILE}: ${JSON.stringify(name)}`);
  }
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`listed suite does not exist: ${path}`);
  return path;
}
