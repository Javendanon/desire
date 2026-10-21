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

/** Serialises a sector, sections in kind order with their known strides. O(records). */
export function writeSector(sector: Sector): Uint8Array {
  const sections: Section[] = [
    { kind: L.HOUSES_KIND, count: sector.houses.length, stride: L.HOUSES_STRIDE, offset: 0 },
    { kind: L.BERTHS_KIND, count: sector.berths.length, stride: L.BERTHS_STRIDE, offset: 0 },
    { kind: L.TREES_KIND, count: sector.trees.length, stride: L.TREES_STRIDE, offset: 0 },
  ];
  let offset = L.HEADER_BYTES + sections.length * L.ENTRY_BYTES;
  for (const section of sections) {
    section.offset = offset;
    offset += section.count * section.stride;
  }
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  writeHeader(view, sector, sections);
  const [houses, berths, trees] = sections;
  sector.houses.forEach((house, record) =>
    writeHouse(view, house, houses.offset + record * houses.stride));
  sector.berths.forEach((berth, record) => {
    const at = berths.offset + record * berths.stride;
    view.setFloat32(at + L.BERTHS_X_M, berth.x_m, LITTLE);
    view.setFloat32(at + L.BERTHS_Z_M, berth.z_m, LITTLE);
    view.setFloat32(at + L.BERTHS_HEADING_RADIANS, berth.heading_radians, LITTLE);
  });
  sector.trees.forEach((tree, record) => {
    const at = trees.offset + record * trees.stride;
    view.setFloat32(at + L.TREES_X_M, tree.x_m, LITTLE);
    view.setFloat32(at + L.TREES_Z_M, tree.z_m, LITTLE);
    view.setFloat32(at + L.TREES_SCALE, tree.scale, LITTLE);
  });
  return bytes;
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

function writeHouse(view: DataView, house: SectorHouse, at: number) {
  view.setUint32(at + L.HOUSES_ID, house.id, LITTLE);
  view.setFloat32(at + L.HOUSES_X_M, house.x_m, LITTLE);
  view.setFloat32(at + L.HOUSES_Z_M, house.z_m, LITTLE);
  view.setFloat32(at + L.HOUSES_WIDTH_M, house.width_m, LITTLE);
  view.setFloat32(at + L.HOUSES_DEPTH_M, house.depth_m, LITTLE);
  view.setFloat32(at + L.HOUSES_ROTATION_RADIANS, house.rotation_radians, LITTLE);
  view.setFloat32(at + L.HOUSES_HEIGHT_M, house.height_m, LITTLE);
  house.roof_rgb.forEach((channel, field) =>
    view.setUint8(at + L.HOUSES_ROOF_RGB + field, channel));
  view.setUint8(at + L.HOUSES_FLAGS, house.frontage ? L.HOUSES_FRONTAGE_BIT : 0);
}

/** Parses and validates a sector payload. Throws SectorFormatError. O(bytes). */
export function readSector(bytes: Uint8Array): Sector {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < L.HEADER_VERSION + 2) throw new SectorFormatError('truncated');
  if (MAGIC_BYTES.some((byte, at) => bytes[L.HEADER_MAGIC + at] !== byte)) {
    throw new SectorFormatError('bad magic');
  }
  const version = view.getUint16(L.HEADER_VERSION, LITTLE);
  if (version !== L.VERSION) throw new SectorFormatError(`unsupported version ${version}`);
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

const KNOWN_STRIDES = new Map<number, number>([
  [L.HOUSES_KIND, L.HOUSES_STRIDE],
  [L.BERTHS_KIND, L.BERTHS_STRIDE],
  [L.TREES_KIND, L.TREES_STRIDE],
]);

function validate(view: DataView, section: Section) {
  const { kind } = section;
  if (section.offset % L.ALIGNMENT !== 0) {
    throw new SectorFormatError(`section ${kind} misaligned`);
  }
  const minimum = KNOWN_STRIDES.get(kind);
  if (minimum !== undefined && section.stride < minimum) {
    throw new SectorFormatError(`section ${kind} stride too small`);
  }
  if (section.offset + section.count * section.stride > view.byteLength) {
    throw new SectorFormatError(`section ${kind} out of bounds`);
  }
}

/** Appends a validated section's records. Unknown kinds are skipped. */
function readSection(view: DataView, section: Section, sector: Sector) {
  for (let record = 0; record < section.count; record += 1) {
    const at = section.offset + record * section.stride;
    const float = (field: number) => view.getFloat32(at + field, LITTLE);
    if (section.kind === L.HOUSES_KIND) sector.houses.push(readHouse(view, at));
    if (section.kind === L.BERTHS_KIND) {
      sector.berths.push({ x_m: float(L.BERTHS_X_M), z_m: float(L.BERTHS_Z_M),
        heading_radians: float(L.BERTHS_HEADING_RADIANS) });
    }
    if (section.kind === L.TREES_KIND) {
      sector.trees.push({ x_m: float(L.TREES_X_M), z_m: float(L.TREES_Z_M),
        scale: float(L.TREES_SCALE) });
    }
  }
}

function readHouse(view: DataView, at: number): SectorHouse {
  const float = (field: number) => view.getFloat32(at + field, LITTLE);
  const rgb = at + L.HOUSES_ROOF_RGB;
  return {
    id: view.getUint32(at + L.HOUSES_ID, LITTLE),
    x_m: float(L.HOUSES_X_M),
    z_m: float(L.HOUSES_Z_M),
    width_m: float(L.HOUSES_WIDTH_M),
    depth_m: float(L.HOUSES_DEPTH_M),
    rotation_radians: float(L.HOUSES_ROTATION_RADIANS),
    height_m: float(L.HOUSES_HEIGHT_M),
    roof_rgb: [view.getUint8(rgb), view.getUint8(rgb + 1), view.getUint8(rgb + 2)],
    frontage: (view.getUint8(at + L.HOUSES_FLAGS) & L.HOUSES_FRONTAGE_BIT) !== 0,
  };
}
