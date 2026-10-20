/** Texture policy: only GPU/transport compressed formats may ship, inside a byte budget. */
import fs from 'node:fs';
import path from 'node:path';

const HEADER_BYTES = 12;
const WEBP_RIFF = { offset: 0, length: 4 };
const WEBP_TAG = { offset: 8, length: 4 };
const KTX2_TAG = { offset: 1, length: 6 };
const KTX2_IDENTIFIER_BYTE = 0xab;

function hasWebpMagic(header) {
  const riff = header.toString('ascii', WEBP_RIFF.offset, WEBP_RIFF.offset + WEBP_RIFF.length);
  const tag = header.toString('ascii', WEBP_TAG.offset, WEBP_TAG.offset + WEBP_TAG.length);
  return header.length >= HEADER_BYTES && riff === 'RIFF' && tag === 'WEBP';
}

function hasKtx2Magic(header) {
  const tag = header.toString('ascii', KTX2_TAG.offset, KTX2_TAG.offset + KTX2_TAG.length);
  return header.length >= HEADER_BYTES && header[0] === KTX2_IDENTIFIER_BYTE && tag === 'KTX 20';
}

function magicMatches(mime, header) {
  if (mime === 'image/webp') return hasWebpMagic(header);
  if (mime === 'image/ktx2') return hasKtx2Magic(header);
  return false;
}

function inspect(texture, baseDir) {
  const file = path.join(baseDir, texture.path);
  if (!fs.existsSync(file)) {
    return {
      id: texture.id,
      mime: texture.mime,
      bytes: 0,
      max_bytes: texture.max_bytes,
      pass: false,
      detail: `missing ${texture.path}`,
    };
  }
  const header = fs.readFileSync(file).subarray(0, HEADER_BYTES);
  const bytes = fs.statSync(file).size;
  const magic = magicMatches(texture.mime, header);
  return {
    id: texture.id,
    mime: texture.mime,
    bytes,
    max_bytes: texture.max_bytes,
    pass: magic && bytes <= texture.max_bytes,
    detail: magic ? `${texture.mime}, ${bytes} B` : `bytes are not ${texture.mime}`,
  };
}

/** Checks every declared texture against its magic bytes and byte budget. */
export function checkTextures(manifest, baseDir) {
  return manifest.textures.map((texture) => inspect(texture, baseDir));
}
