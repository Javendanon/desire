// desire.sector-render/1 (docs/waterdeep-3d/sector-format.md) against the fixture that the Rust
// tests also use, built independently from the spec.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { readSector, SectorFormatError, writeSector, type Sector } from '../src/lib/map/sector-format.ts';

const FIXTURE = new Uint8Array(fs.readFileSync('crates/core/tests/fixtures/sector-v1.bin'));

const sample = (): Sector => ({
  index: 7,
  origin_x_m: 512.5,
  origin_z_m: 1024,
  size_m: 479.5,
  houses: [
    { id: 0x00030002, x_m: 600.25, z_m: 1100.5, width_m: 6.5, depth_m: 9.75,
      rotation_radians: 1.5, height_m: 7.25, roof_rgb: [120, 90, 70], frontage: true },
    { id: 0x00030003, x_m: 610, z_m: 1101, width_m: 5, depth_m: 8, rotation_radians: -0.25,
      height_m: 4, roof_rgb: [90, 100, 110], frontage: false },
  ],
  berths: [{ x_m: 700.5, z_m: 1200.25, heading_radians: 3 }],
  trees: [],
});

const failure = (bytes: Uint8Array) => {
  try {
    readSector(bytes);
  } catch (error) {
    if (error instanceof SectorFormatError) return error.reason;
    throw error;
  }
  return 'no error';
};

test('writing the sample gives the fixture bytes, and the fixture reads as the sample', () => {
  assert.deepEqual(writeSector(sample()), FIXTURE);
  assert.deepEqual(readSector(FIXTURE), sample());
});

test('a written sector reads back unchanged', () => {
  const sector = { ...sample(), trees: [{ x_m: 1.5, z_m: 2.5, scale: 0.75 }] };
  assert.deepEqual(readSector(writeSector(sector)), sector);
});

test('wrong magic, a future version and truncation are rejected', () => {
  const badMagic = FIXTURE.slice();
  badMagic[0] = 0x58;
  assert.equal(failure(badMagic), 'bad magic');
  const future = FIXTURE.slice();
  future[4] = 2;
  assert.equal(failure(future), 'unsupported version 2');
  assert.equal(failure(FIXTURE.slice(0, 20)), 'truncated');
  assert.equal(failure(FIXTURE.slice(0, 60)), 'truncated');
  assert.equal(failure(FIXTURE.slice(0, 150)), 'section 2 out of bounds');
});

test('misaligned or too narrow sections are rejected', () => {
  const misaligned = FIXTURE.slice();
  misaligned[44] = 0x51;
  assert.equal(failure(misaligned), 'section 1 misaligned');
  const narrow = FIXTURE.slice();
  narrow[40] = 16;
  assert.equal(failure(narrow), 'section 1 stride too small');
});

test('unknown kinds are skipped and wider strides read their known fields', () => {
  const unknown = FIXTURE.slice();
  unknown[64] = 9;
  assert.deepEqual(readSector(unknown), sample());
  const wider = new Uint8Array(160);
  wider.set(FIXTURE.subarray(0, 156));
  wider.fill(0xaa, 156);
  wider[56] = 16;
  wider[76] = 0xa0;
  assert.deepEqual(readSector(wider), sample());
});
