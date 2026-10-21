// `desire.sector-render/1`: what the diorama draws for one map sector, in a typed binary layout.
// Offsets, strides and kinds come from ../../generated/sector-layout.ts, generated from the
// normative contracts/sector-render.json (tools/contracts/sector.py), as are the Rust twin's
// (crates/core/src/sector). Pure: no DOM, no Node APIs, so the viewer's Worker and the asset
// pipeline share it.

import * as L from '../../generated/sector-layout.ts';

export interface SectorHouse {
  /** Block index × 4096 + lot index: stable for one source raster and pipeline version. */
  id: number;
  x_m: number;
  z_m: number;
  width_m: number;
  depth_m: number;
  rotation_radians: number;
  height_m: number;
  roof_rgb: [number, number, number];
  frontage: boolean;
}

/** A house's shape and look without its id and position: what every house record shares. */
export type HouseBody = Omit<SectorHouse, 'id' | 'x_m' | 'z_m'>;

/** Houses positioned by a `center` point, as the layer and slice JSON files store them. */
export type CentredHouse = HouseBody & {
  center: {
    x_m: number;
    z_m: number;
  };
};

export interface SectorBerth {
  x_m: number;
  z_m: number;
  heading_radians: number;
}

export interface SectorTree {
  x_m: number;
  z_m: number;
  scale: number;
}

export interface Sector {
  /** `row * columns + column` in the sector grid. */
  index: number;
  /** North-west corner, absolute map metres. */
  origin_x_m: number;
  origin_z_m: number;
  size_m: number;
  houses: SectorHouse[];
  berths: SectorBerth[];
  trees: SectorTree[];
}

export class SectorFormatError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`sector payload: ${reason}`);
    this.reason = reason;
  }
}

const LITTLE = true;
const MAGIC_BYTES = [...L.MAGIC].map((letter) => letter.charCodeAt(0));

type Section = {
  kind: number;
  count: number;
  stride: number;
  offset: number;
};

/** Where a record starts: the payload's view and the record's byte offset. */
type Slot = {
  view: DataView;
  at: number;
};

/** One record kind: its section, its stride, and how a record sits at its offset. */
interface Codec<T> {
  kind: number;
  stride: number;
  list(sector: Sector): T[];
  write(slot: Slot, record: T): void;
  read(slot: Slot): T;
}

const f32 = ({ view, at }: Slot, field: number) => view.getFloat32(at + field, LITTLE);
const setF32 = ({ view, at }: Slot, field: number, value: number) =>
  view.setFloat32(at + field, value, LITTLE);

const HOUSES: Codec<SectorHouse> = {
  kind: L.HOUSES_KIND,
  stride: L.HOUSES_STRIDE,
  list: (sector) => sector.houses,
  write(slot, house) {
    slot.view.setUint32(slot.at + L.HOUSES_ID, house.id, LITTLE);
    setF32(slot, L.HOUSES_X_M, house.x_m);
    setF32(slot, L.HOUSES_Z_M, house.z_m);
    setF32(slot, L.HOUSES_WIDTH_M, house.width_m);
    setF32(slot, L.HOUSES_DEPTH_M, house.depth_m);
    setF32(slot, L.HOUSES_ROTATION_RADIANS, house.rotation_radians);
    setF32(slot, L.HOUSES_HEIGHT_M, house.height_m);
    house.roof_rgb.forEach((channel, offset) =>
      slot.view.setUint8(slot.at + L.HOUSES_ROOF_RGB + offset, channel));
    slot.view.setUint8(slot.at + L.HOUSES_FLAGS, house.frontage ? L.HOUSES_FRONTAGE_BIT : 0);
  },
  read(slot) {
    const byte = (field: number) => slot.view.getUint8(slot.at + field);
    return {
      id: slot.view.getUint32(slot.at + L.HOUSES_ID, LITTLE),
      x_m: f32(slot, L.HOUSES_X_M),
      z_m: f32(slot, L.HOUSES_Z_M),
      width_m: f32(slot, L.HOUSES_WIDTH_M),
      depth_m: f32(slot, L.HOUSES_DEPTH_M),
      rotation_radians: f32(slot, L.HOUSES_ROTATION_RADIANS),
      height_m: f32(slot, L.HOUSES_HEIGHT_M),
      roof_rgb: [byte(L.HOUSES_ROOF_RGB), byte(L.HOUSES_ROOF_RGB + 1), byte(L.HOUSES_ROOF_RGB + 2)],
      frontage: (byte(L.HOUSES_FLAGS) & L.HOUSES_FRONTAGE_BIT) !== 0,
    };
  },
};

const BERTHS: Codec<SectorBerth> = {
  kind: L.BERTHS_KIND,
  stride: L.BERTHS_STRIDE,
  list: (sector) => sector.berths,
  write(slot, berth) {
    setF32(slot, L.BERTHS_X_M, berth.x_m);
    setF32(slot, L.BERTHS_Z_M, berth.z_m);
    setF32(slot, L.BERTHS_HEADING_RADIANS, berth.heading_radians);
  },
  read: (slot) => ({ x_m: f32(slot, L.BERTHS_X_M), z_m: f32(slot, L.BERTHS_Z_M),
    heading_radians: f32(slot, L.BERTHS_HEADING_RADIANS) }),
};

const TREES: Codec<SectorTree> = {
  kind: L.TREES_KIND,
  stride: L.TREES_STRIDE,
  list: (sector) => sector.trees,
  write(slot, tree) {
    setF32(slot, L.TREES_X_M, tree.x_m);
    setF32(slot, L.TREES_Z_M, tree.z_m);
    setF32(slot, L.TREES_SCALE, tree.scale);
  },
  read: (slot) => ({ x_m: f32(slot, L.TREES_X_M), z_m: f32(slot, L.TREES_Z_M),
    scale: f32(slot, L.TREES_SCALE) }),
};

/** Every known kind, in kind order: the order sections are written in. */
const CODECS = [HOUSES, BERTHS, TREES] as const;
/** Dispatch table for reading: kind → codec. Kinds missing here are skipped. */
const BY_KIND = new Map<number, Codec<unknown>>(CODECS.map((codec) => [codec.kind, codec]));

/** Section table entries for a sector: known kinds in order, records after the table. */
function layout(sector: Sector): Section[] {
  let offset = L.HEADER_BYTES + CODECS.length * L.ENTRY_BYTES;
  return CODECS.map((codec) => {
    const section = { kind: codec.kind, count: codec.list(sector).length, stride: codec.stride,
      offset };
    offset += section.count * section.stride;
    return section;
  });
}

/** Serialises a sector, sections in kind order with their known strides. O(records). */
export function writeSector(sector: Sector): Uint8Array {
  const sections = layout(sector);
  const last = sections[sections.length - 1];
  const view = new DataView(new ArrayBuffer(last.offset + last.count * last.stride));
  writeHeader(view, sector, sections);
  CODECS.forEach((codec: Codec<unknown>, number) => {
    const { offset, stride } = sections[number];
    codec.list(sector).forEach((record, index) =>
      codec.write({ view, at: offset + index * stride }, record));
  });
  return new Uint8Array(view.buffer);
}

function writeHeader(view: DataView, sector: Sector, sections: Section[]) {
  MAGIC_BYTES.forEach((byte, at) => view.setUint8(L.HEADER_MAGIC + at, byte));
  view.setUint16(L.HEADER_VERSION, L.VERSION, LITTLE);
  view.setUint16(L.HEADER_SECTION_COUNT, sections.length, LITTLE);
  view.setUint32(L.HEADER_INDEX, sector.index, LITTLE);
  view.setFloat32(L.HEADER_ORIGIN_X_M, sector.origin_x_m, LITTLE);
  view.setFloat32(L.HEADER_ORIGIN_Z_M, sector.origin_z_m, LITTLE);
  view.setFloat32(L.HEADER_SIZE_M, sector.size_m, LITTLE);
  sections.forEach((section, entry) => {
    const at = L.HEADER_BYTES + entry * L.ENTRY_BYTES;
    view.setUint32(at + L.ENTRY_KIND, section.kind, LITTLE);
    view.setUint32(at + L.ENTRY_COUNT, section.count, LITTLE);
    view.setUint32(at + L.ENTRY_STRIDE, section.stride, LITTLE);
    view.setUint32(at + L.ENTRY_OFFSET, section.offset, LITTLE);
  });
}

/** The magic and the major version, before anything else is trusted. */
function checkIdentity(bytes: Uint8Array, view: DataView) {
  if (bytes.length < L.HEADER_VERSION + 2) throw new SectorFormatError('truncated');
  if (MAGIC_BYTES.some((byte, at) => bytes[L.HEADER_MAGIC + at] !== byte)) {
    throw new SectorFormatError('bad magic');
  }
  const version = view.getUint16(L.HEADER_VERSION, LITTLE);
  if (version !== L.VERSION) throw new SectorFormatError(`unsupported version ${version}`);
}

/** Parses and validates a sector payload. Throws SectorFormatError. O(bytes). */
export function readSector(bytes: Uint8Array): Sector {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  checkIdentity(bytes, view);
  if (bytes.length < L.HEADER_BYTES) throw new SectorFormatError('truncated');
  const sector: Sector = {
    index: view.getUint32(L.HEADER_INDEX, LITTLE),
    origin_x_m: view.getFloat32(L.HEADER_ORIGIN_X_M, LITTLE),
    origin_z_m: view.getFloat32(L.HEADER_ORIGIN_Z_M, LITTLE),
    size_m: view.getFloat32(L.HEADER_SIZE_M, LITTLE),
    houses: [],
    berths: [],
    trees: [],
  };
  for (const section of sectionTable(view)) readSection(view, section, sector);
  return sector;
}

/** Appends a validated section's records to the sector. Unknown kinds are skipped. */
function readSection(view: DataView, section: Section, sector: Sector) {
  const codec = BY_KIND.get(section.kind);
  if (!codec) return;
  const records = codec.list(sector);
  for (let record = 0; record < section.count; record += 1) {
    records.push(codec.read({ view, at: section.offset + record * section.stride }));
  }
}

function sectionTable(view: DataView): Section[] {
  const count = view.getUint16(L.HEADER_SECTION_COUNT, LITTLE);
  if (view.byteLength < L.HEADER_BYTES + count * L.ENTRY_BYTES) {
    throw new SectorFormatError('truncated');
  }
  return Array.from({ length: count }, (_, entry) => {
    const at = L.HEADER_BYTES + entry * L.ENTRY_BYTES;
    const section = {
      kind: view.getUint32(at + L.ENTRY_KIND, LITTLE),
      count: view.getUint32(at + L.ENTRY_COUNT, LITTLE),
      stride: view.getUint32(at + L.ENTRY_STRIDE, LITTLE),
      offset: view.getUint32(at + L.ENTRY_OFFSET, LITTLE),
    };
    validate(view, section);
    return section;
  });
}

function validate(view: DataView, section: Section) {
  const { kind } = section;
  if (section.offset % L.ALIGNMENT !== 0) {
    throw new SectorFormatError(`section ${kind} misaligned`);
  }
  const known = BY_KIND.get(kind);
  if (known && section.stride < known.stride) {
    throw new SectorFormatError(`section ${kind} stride too small`);
  }
  if (section.offset + section.count * section.stride > view.byteLength) {
    throw new SectorFormatError(`section ${kind} out of bounds`);
  }
}
