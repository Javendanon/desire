/** Preflight local images, decode WebP offline, and validate the exact buffers exported. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Manifest, Texture } from './types.ts';
import { MAX_TEXTURE_BYTES, MAX_TEXTURE_PIXELS } from './surface-manifest.ts';

export const MAX_TOTAL_TEXTURE_BYTES = 16 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 5000;
const PNG = {
  signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  widthOffset: 16, heightOffset: 20, headerBytes: 24,
};
const WEBP = {
  chunkStart: 12, chunkEnd: 16, lossyWidth: 26, lossyHeight: 28,
  losslessSignature: 20, losslessBits: 21, losslessHeader: 25,
  extendedWidth: 24, extendedHeight: 27, frameHeader: 30,
  dimensionMask: 0x3fff, dimensionBits: 14, losslessMagic: 0x2f,
};
type TextureFile = { file: string; bytes: number; error?: string };
export type TextureCheck = {
  id: string; mime: string; bytes: number; max_bytes: number; pass: boolean; detail: string;
  width_px: number; height_px: number;
};
type TextureFileSize = { width_px: number; height_px: number };

function probeTexture(texture: Texture, baseDir: string): TextureFile {
  let bytes = 0;
  try {
    const root = fs.realpathSync(baseDir);
    const file = fs.realpathSync(path.resolve(root, texture.path));
    const relative = path.relative(root, file);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('texture resolves outside the asset directory');
    }
    const stat = fs.statSync(file);
    bytes = stat.size;
    if (!stat.isFile()) throw new Error('texture must be a regular file');
    if (bytes > texture.max_bytes || bytes > MAX_TEXTURE_BYTES) {
      throw new Error('texture byte budget');
    }
    return { file, bytes };
  } catch (cause) {
    return { file: '', bytes, error: `texture ${texture.id}: ${String(cause)}` };
  }
}

function webpDimensions(data: Buffer): TextureFileSize {
  const chunk = data.toString('ascii', WEBP.chunkStart, WEBP.chunkEnd);
  if (chunk === 'VP8 ' && data.length >= WEBP.frameHeader) {
    return { width_px: data.readUInt16LE(WEBP.lossyWidth) & WEBP.dimensionMask,
      height_px: data.readUInt16LE(WEBP.lossyHeight) & WEBP.dimensionMask };
  }
  if (chunk === 'VP8L' && data.length >= WEBP.losslessHeader
    && data[WEBP.losslessSignature] === WEBP.losslessMagic) {
    const bits = data.readUInt32LE(WEBP.losslessBits);
    return { width_px: (bits & WEBP.dimensionMask) + 1,
      height_px: ((bits >>> WEBP.dimensionBits) & WEBP.dimensionMask) + 1 };
  }
  if (chunk === 'VP8X' && data.length >= WEBP.frameHeader) {
    return { width_px: data.readUIntLE(WEBP.extendedWidth, 3) + 1,
      height_px: data.readUIntLE(WEBP.extendedHeight, 3) + 1 };
  }
  return { width_px: 0, height_px: 0 };
}

function pngDimensions(file: string): TextureFileSize | null {
  const header = Buffer.alloc(PNG.headerBytes);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, header, 0, PNG.headerBytes, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (!header.subarray(0, PNG.signature.length).equals(PNG.signature)) return null;
  return { width_px: header.readUInt32BE(PNG.widthOffset),
    height_px: header.readUInt32BE(PNG.heightOffset) };
}

function decodeError(error: Error & { code?: string }) {
  if (error.code === 'ETIMEDOUT') return `dwebp decode exceeded ${DECODE_TIMEOUT_MS} ms`;
  return `dwebp decoder unavailable or failed: ${error.message}`;
}

function readRaster(file: string): { raster?: TextureFileSize | null; problem?: string } {
  try {
    return { raster: pngDimensions(file) };
  } catch (cause) {
    return { problem: `decoded raster cannot be read: ${String(cause)}` };
  }
}

/**
 * Decode stdin to a temporary PNG. A file target keeps large rasters away from the child
 * stdout buffer, so a 4096x4096 texture cannot be mistaken for an unavailable decoder.
 */
function decodeRaster(data: Buffer): { raster?: TextureFileSize | null; problem?: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-webp-'));
  try {
    const file = path.join(directory, 'decoded.png');
    const decoded = spawnSync('dwebp', ['-quiet', '-o', file, '--', '-'], {
      input: data, timeout: DECODE_TIMEOUT_MS,
    });
    if (decoded.error) return { problem: decodeError(decoded.error) };
    if (decoded.status !== 0) {
      return { problem: `invalid WebP payload: ${String(decoded.stderr).trim()}` };
    }
    return readRaster(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function declaredProblem(texture: Texture, data: Buffer, size: TextureFileSize) {
  const magic = data.toString('ascii', 0, 4) === 'RIFF'
    && data.toString('ascii', 8, 12) === 'WEBP';
  if (texture.mime !== 'image/webp' || !magic) return `bytes are not ${texture.mime}`;
  if (size.width_px !== texture.width_px || size.height_px !== texture.height_px) {
    return 'texture resolution mismatch';
  }
  const pixels = size.width_px * size.height_px;
  if (!(pixels > 0 && pixels <= MAX_TEXTURE_PIXELS)) return 'texture pixel budget';
  return null;
}

function rasterProblem(data: Buffer, size: TextureFileSize) {
  const { raster, problem } = decodeRaster(data);
  if (problem) return problem;
  if (!raster) return 'decoded raster is not a PNG image';
  if (raster.width_px !== size.width_px || raster.height_px !== size.height_px) {
    return 'decoded raster does not match the declared resolution';
  }
  return null;
}

function decodeProblem(texture: Texture, data: Buffer, size: TextureFileSize) {
  return declaredProblem(texture, data, size) ?? rasterProblem(data, size);
}

function inspect(texture: Texture, data: Buffer, file: TextureFile): TextureCheck {
  const size = webpDimensions(data);
  const error = file.error ?? decodeProblem(texture, data, size);
  return {
    id: texture.id, mime: texture.mime, bytes: file.bytes, max_bytes: texture.max_bytes,
    ...size, pass: error === null,
    detail: error ?? `${texture.mime}, ${file.bytes} B, resolution matches; dwebp decoded PNG`,
  };
}

/** O(textures + bytes); preflight all file sizes before any reads, then decode each buffer once. */
export function prepareTextures(manifest: Pick<Manifest, 'textures'>, baseDir: string) {
  const files = manifest.textures.map((texture) => probeTexture(texture, baseDir));
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > MAX_TOTAL_TEXTURE_BYTES) {
    for (const file of files) file.error = 'aggregate texture byte budget';
  }
  const images = files.map((file) => file.error ? Buffer.alloc(0) : fs.readFileSync(file.file));
  const checks = manifest.textures.map((texture, index) =>
    inspect(texture, images[index], files[index]));
  return { images, checks };
}

/** Checks local image containment, budgets, dimensions and actual decoder acceptance. */
export function checkTextures(
  manifest: Pick<Manifest, 'textures'>, baseDir: string
): TextureCheck[] {
  return prepareTextures(manifest, baseDir).checks;
}
