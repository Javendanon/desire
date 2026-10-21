// Fails when the checked-in Wasm declarations drift from the wasm-pack output.
// `pnpm check` types the worker against the checked-in copy, so a clean checkout
// type-checks without building Wasm; this guard keeps that copy honest.
import { readFileSync, writeFileSync } from 'node:fs';

const GENERATED = 'src/generated/wasm/desire_wasm.d.ts';
const CHECKED_IN = 'src/generated/desire_wasm.d.ts';
// wasm-bindgen emits linter pragmas; the repository forbids adding them.
const PRAGMA = /^\/\* (tslint|eslint)-?:?disable \*\/\n/gm;

const generated = readFileSync(GENERATED, 'utf8').replace(PRAGMA, '');
if (process.argv.includes('--write')) {
  writeFileSync(CHECKED_IN, generated);
} else if (readFileSync(CHECKED_IN, 'utf8') !== generated) {
  console.error(`${CHECKED_IN} differs from ${GENERATED}.`);
  console.error('Review the Wasm API change, then run: node tools/routing/check-wasm-types.mjs --write');
  process.exit(1);
}
