/** Writes a map package directory and reads it back. The package's only file access. */
import fs from 'node:fs';
import path from 'node:path';

import type { MapPackage, SectorFile } from './map-types.ts';
import { outputPath } from './output.ts';
import type { WrittenPackage } from './package-check.ts';

export const MAP_FILE = 'map.json';
const SECTOR_DIR = 'sectors';
const SECTOR_URI = /^sectors\/(\d+)\.json$/;
const U32_BYTES = 4;

/** Row-major u32 costs, little-endian whatever the host byte order. */
function encodeCosts(costs: Uint32Array): Buffer {
  const bytes = Buffer.alloc(costs.length * U32_BYTES);
  costs.forEach((value, index) => bytes.writeUInt32LE(value, index * U32_BYTES));
  return bytes;
}

function decodeCosts(bytes: Buffer): Uint32Array {
  if (bytes.length % U32_BYTES !== 0) throw new Error('cost buffer is not a whole number of u32');
  const costs = new Uint32Array(bytes.length / U32_BYTES);
  for (let index = 0; index < costs.length; index += 1) {
    costs[index] = bytes.readUInt32LE(index * U32_BYTES);
  }
  return costs;
}

function writeFile(directory: string, name: string, data: string | Buffer) {
  fs.writeFileSync(outputPath(directory, name), data);
  return Buffer.byteLength(data);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Writes map.json, one file per sector and the cost grid. Returns size and file count. */
export function writePackage(directory: string, written: WrittenPackage) {
  fs.mkdirSync(directory);
  const sectorDir = outputPath(directory, SECTOR_DIR);
  fs.mkdirSync(sectorDir);
  let bytes = writeFile(directory, MAP_FILE, json(written.map));
  bytes += writeFile(directory, written.map.nav.asset_uri, encodeCosts(written.costs));
  for (const sector of written.sectors) {
    bytes += writeFile(sectorDir, `${sector.index}.json`, json(sector));
  }
  return { bytes, files: written.sectors.length + 2 };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readSector(directory: string, uri: string): SectorFile {
  const match = SECTOR_URI.exec(uri);
  if (!match) throw new Error(`chunk asset_uri must be sectors/<index>.json, got ${uri}`);
  return readJson<SectorFile>(outputPath(path.join(directory, SECTOR_DIR), `${match[1]}.json`));
}

/** Reads a package exactly as a consumer would: through map.json and its chunk URIs. */
export function readPackage(directory: string): WrittenPackage {
  const map = readJson<MapPackage>(outputPath(directory, MAP_FILE));
  const sectors = map.chunks.map((chunk) => readSector(directory, chunk.asset_uri));
  const costs = decodeCosts(fs.readFileSync(outputPath(directory, map.nav.asset_uri)));
  return { map, sectors, costs };
}
