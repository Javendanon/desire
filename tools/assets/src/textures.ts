/** Texture policy: only GPU/transport compressed formats may ship, inside a byte budget. */
import fs from 'node:fs';
import path from 'node:path';

import type { Manifest, Texture } from './types.ts';

export type TextureCheck = ReturnType<typeof inspect>;

const HEADER_BYTES = 12;
const WEBP_RIFF = { offset: 0, length: 4 };
const WEBP_TAG = { offset: 8, length: 4 };
const KTX2_TAG = { offset: 1, length: 6 };
const KTX2_IDENTIFIER_BYTE = 0xab;

function hasWebpMagic(header: Buffer) {
  const riff = header.toString('ascii', WEBP_RIFF.offset, WEBP_RIFF.offset + WEBP_RIFF.length);
  const tag = header.toString('ascii', WEBP_TAG.offset, WEBP_TAG.offset + WEBP_TAG.length);
  return header.length >= HEADER_BYTES && riff === 'RIFF' && tag === 'WEBP';
}

function hasKtx2Magic(header: Buffer) {
  const tag = header.toString('ascii', KTX2_TAG.offset, KTX2_TAG.offset + KTX2_TAG.length);
  return header.length >= HEADER_BYTES && header[0] === KTX2_IDENTIFIER_BYTE && tag === 'KTX 20';
}

function magicMatches(mime: string, header: Buffer) {
  if (mime === 'image/webp') return hasWebpMagic(header);
  if (mime === 'image/ktx2') return hasKtx2Magic(header);
  return false;
}

function resolution(mime: string, data: Buffer) {
  if (mime === 'image/ktx2' && data.length >= 80) {
    return { width_px: data.readUInt32LE(20), height_px: data.readUInt32LE(24) };
  }
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && data.length >= 30) {
    return { width_px: data.readUInt16LE(26) & 0x3fff, height_px: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width_px: (bits & 0x3fff) + 1, height_px: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && data.length >= 30) {
    return { width_px: data.readUIntLE(24, 3) + 1, height_px: data.readUIntLE(27, 3) + 1 };
  }
  return { width_px: 0, height_px: 0 };
}

function inspect(texture: Texture, baseDir: string) {
  const file = path.join(baseDir, texture.path);
  const exists = fs.existsSync(file);
  const data = exists ? fs.readFileSync(file) : Buffer.alloc(0);
  const bytes = data.length;
  const magic = magicMatches(texture.mime, data);
  const size = resolution(texture.mime, data);
  const matches = size.width_px === texture.width_px && size.height_px === texture.height_px;
  return {
    id: texture.id,
    mime: texture.mime,
    bytes,
    max_bytes: texture.max_bytes,
    ...size,
    pass: magic && matches && bytes <= texture.max_bytes,
    detail: !exists ? `missing ${texture.path}` : !magic ? `bytes are not ${texture.mime}`
      : `${texture.mime}, ${bytes} B, resolution ${matches ? 'matches' : 'mismatch'}`,
  };
}

/** Checks every declared texture against its magic bytes and byte budget. */
export function checkTextures(manifest: Pick<Manifest, 'textures'>, baseDir: string) {
  return manifest.textures.map((texture) => inspect(texture, baseDir));
}
