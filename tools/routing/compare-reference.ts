// Compares the native Rust core against the independent TypeScript reference
// on the same fixture. It proves cost parity, not a performance improvement.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { referenceFixtureCost } from './reference.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = execFileSync(
  'cargo',
  ['run', '--quiet', '--offline', '-p', 'desire-core', '--example', 'routing_reference'],
  { cwd: repoRoot, encoding: 'utf8' },
);
const match = /cost=(\d+)/.exec(output);
if (match === null) {
  throw new Error(`routing reference produced no cost: ${output.trim()}`);
}
const rustCost = Number(match[1]);
const typescriptCost = referenceFixtureCost();
if (rustCost !== typescriptCost) {
  console.error(`routing cost mismatch: rust=${rustCost} typescript=${typescriptCost}`);
  process.exit(1);
}
console.log(`routing reference parity: rust=${rustCost} typescript=${typescriptCost}`);
