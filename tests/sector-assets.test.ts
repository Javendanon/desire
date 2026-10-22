import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { loadSectorAssets } from '../src/lib/diorama/sector-assets.ts';

const FIXTURE = fs.readFileSync('crates/core/tests/fixtures/sector-v1.bin');
const HEIGHTS = Int16Array.from([100, 80, -250, 100]);

/** A fetch over an in-memory directory: missing paths answer 404, as a static server does. */
function fakeFetch(files: Record<string, Uint8Array>) {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const body = files[url];
    return body
      ? new Response(body)
      : new Response(null, { status: 404, statusText: 'Not Found' });
  };
  return { fetcher, requested };
}

const decode = async (blob: Blob) => ({ bytes: blob.size });

test('a sector with houses loads its payload, ground heights and albedo', async () => {
  const { fetcher, requested } = fakeFetch({
    '/city/sectors/7.render.bin': FIXTURE,
    '/city/ground/7.heights.bin': new Uint8Array(HEIGHTS.buffer),
    '/city/ground/7.jpg': new Uint8Array([1, 2, 3]),
  });
  const assets = await loadSectorAssets({ base: '/city', index: 7, hasSector: true }, { fetcher, decode });
  assert.equal(assets.sector?.houses.length, 2);
  assert.deepEqual([...assets.heights], [...HEIGHTS]);
  assert.deepEqual(assets.albedo, { bytes: 3 });
  assert.equal(requested.length, 3);
});

test('open sea has ground only: no payload is requested', async () => {
  const { fetcher, requested } = fakeFetch({
    '/city/ground/3.heights.bin': new Uint8Array(HEIGHTS.buffer),
    '/city/ground/3.jpg': new Uint8Array([9]),
  });
  const assets = await loadSectorAssets({ base: '/city', index: 3, hasSector: false }, { fetcher, decode });
  assert.equal(assets.sector, null);
  assert.ok(!requested.some((url) => url.includes('render.bin')));
});

test('a missing file is an error naming it', async () => {
  const { fetcher } = fakeFetch({});
  await assert.rejects(
    loadSectorAssets({ base: '/city', index: 2, hasSector: false }, { fetcher, decode }),
    /\/city\/ground\/2\.heights\.bin: HTTP 404/,
  );
});
