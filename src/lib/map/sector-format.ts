// `desire.sector-render/1`: what the diorama draws for one map sector, in a typed binary layout.
// The contract is docs/waterdeep-3d/sector-format.md and the Rust twin is crates/core/src/sector.
// Both are tested against one fixture built from the spec. Pure: no DOM, no Node APIs, so the
// viewer's Worker and the asset pipeline share it.

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

const MAGIC = [0x44, 0x53, 0x45, 0x43]; // "DSEC"
const VERSION = 1;
const HEADER_BYTES = 32;
const TABLE_ENTRY_BYTES = 16;
const ALIGNMENT = 4;
const KIND = { houses: 1, berths: 2, trees: 3 } as const;
const HOUSE_STRIDE = 32;
const POINT_STRIDE = 12;
const FRONTAGE_FLAG = 1;
const LITTLE = true;

type Section = {
  kind: number;
  count: number;
  stride: number;
  offset: number;
};

/** Serialises a sector, sections in kind order with their known strides. O(records). */
export function writeSector(sector: Sector): Uint8Array {
  const sections: Section[] = [
    { kind: KIND.houses, count: sector.houses.length, stride: HOUSE_STRIDE, offset: 0 },
    { kind: KIND.berths, count: sector.berths.length, stride: POINT_STRIDE, offset: 0 },
    { kind: KIND.trees, count: sector.trees.length, stride: POINT_STRIDE, offset: 0 },
  ];
  let offset = HEADER_BYTES + sections.length * TABLE_ENTRY_BYTES;
  for (const section of sections) {
    section.offset = offset;
    offset += section.count * section.stride;
  }
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  writeHeader(view, sector, sections);
  sector.houses.forEach((house, record) =>
    writeHouse(view, house, sections[0].offset + record * HOUSE_STRIDE));
  writePoints(view, sections[1].offset,
    sector.berths.map((berth) => [berth.x_m, berth.z_m, berth.heading_radians]));
  writePoints(view, sections[2].offset,
    sector.trees.map((tree) => [tree.x_m, tree.z_m, tree.scale]));
  return bytes;
}

function writeHeader(view: DataView, sector: Sector, sections: Section[]) {
  MAGIC.forEach((byte, at) => view.setUint8(at, byte));
  view.setUint16(4, VERSION, LITTLE);
  view.setUint16(6, sections.length, LITTLE);
  view.setUint32(8, sector.index, LITTLE);
  view.setFloat32(12, sector.origin_x_m, LITTLE);
  view.setFloat32(16, sector.origin_z_m, LITTLE);
  view.setFloat32(20, sector.size_m, LITTLE);
  sections.forEach((section, entry) => {
    const at = HEADER_BYTES + entry * TABLE_ENTRY_BYTES;
    [section.kind, section.count, section.stride, section.offset].forEach((value, field) =>
      view.setUint32(at + field * 4, value, LITTLE));
  });
}

function writeHouse(view: DataView, house: SectorHouse, at: number) {
  view.setUint32(at, house.id, LITTLE);
  [house.x_m, house.z_m, house.width_m, house.depth_m, house.rotation_radians, house.height_m]
    .forEach((value, field) => view.setFloat32(at + 4 + field * 4, value, LITTLE));
  house.roof_rgb.forEach((channel, field) => view.setUint8(at + 28 + field, channel));
  view.setUint8(at + 31, house.frontage ? FRONTAGE_FLAG : 0);
}

function writePoints(view: DataView, offset: number, points: number[][]) {
  points.forEach((values, record) => values.forEach((value, field) =>
    view.setFloat32(offset + record * POINT_STRIDE + field * 4, value, LITTLE)));
}

/** Parses and validates a sector payload. Throws SectorFormatError. O(bytes). */
export function readSector(bytes: Uint8Array): Sector {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < MAGIC.length + 2) throw new SectorFormatError('truncated');
  if (MAGIC.some((byte, at) => bytes[at] !== byte)) throw new SectorFormatError('bad magic');
  const version = view.getUint16(4, LITTLE);
  if (version !== VERSION) throw new SectorFormatError(`unsupported version ${version}`);
  if (bytes.length < HEADER_BYTES) throw new SectorFormatError('truncated');
  const sector: Sector = {
    index: view.getUint32(8, LITTLE),
    origin_x_m: view.getFloat32(12, LITTLE),
    origin_z_m: view.getFloat32(16, LITTLE),
    size_m: view.getFloat32(20, LITTLE),
    houses: [],
    berths: [],
    trees: [],
  };
  for (const section of sectionTable(view)) readSection(view, section, sector);
  return sector;
}

function sectionTable(view: DataView): Section[] {
  const count = view.getUint16(6, LITTLE);
  if (view.byteLength < HEADER_BYTES + count * TABLE_ENTRY_BYTES) {
    throw new SectorFormatError('truncated');
  }
  return Array.from({ length: count }, (_, entry) => {
    const at = HEADER_BYTES + entry * TABLE_ENTRY_BYTES;
    const [kind, records, stride, offset] = [0, 1, 2, 3].map((field) =>
      view.getUint32(at + field * 4, LITTLE));
    const section = { kind, count: records, stride, offset };
    validate(view, section);
    return section;
  });
}

const knownStride = (kind: number) =>
  ({ [KIND.houses]: HOUSE_STRIDE, [KIND.berths]: POINT_STRIDE, [KIND.trees]: POINT_STRIDE })[kind];

function validate(view: DataView, section: Section) {
  const { kind } = section;
  if (section.offset % ALIGNMENT !== 0) throw new SectorFormatError(`section ${kind} misaligned`);
  const minimum = knownStride(kind);
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
    const float = (field: number) => view.getFloat32(at + field * 4, LITTLE);
    if (section.kind === KIND.houses) sector.houses.push(readHouse(view, at));
    if (section.kind === KIND.berths) {
      sector.berths.push({ x_m: float(0), z_m: float(1), heading_radians: float(2) });
    }
    if (section.kind === KIND.trees) {
      sector.trees.push({ x_m: float(0), z_m: float(1), scale: float(2) });
    }
  }
}

function readHouse(view: DataView, at: number): SectorHouse {
  const float = (field: number) => view.getFloat32(at + 4 + field * 4, LITTLE);
  return {
    id: view.getUint32(at, LITTLE),
    x_m: float(0),
    z_m: float(1),
    width_m: float(2),
    depth_m: float(3),
    rotation_radians: float(4),
    height_m: float(5),
    roof_rgb: [view.getUint8(at + 28), view.getUint8(at + 29), view.getUint8(at + 30)],
    frontage: (view.getUint8(at + 31) & FRONTAGE_FLAG) !== 0,
  };
}
