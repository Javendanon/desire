/**
 * The whole map cut into sector payloads (docs/waterdeep-3d/sector-format.md) and the index that
 * describes them: grid, city-wide roof tone centres and per-sector counts. Berths and trees are
 * found over the full class raster. Pure: the CLI (export-sectors.ts) writes the files. The Rust
 * twin is `export` in crates/atlas/src/sectors.rs.
 */
import { roofCentres } from '../../../src/lib/diorama/roof-palette.ts';
import { writeSector } from '../../../src/lib/map/sector-format.ts';
import { featuresInMetres } from './features.ts';
import type { RasterSize } from './raster/raster-ops.ts';
import { partitionSectors, sectorGrid, type LayerHouse, type SectorGrid } from './sectors.ts';

const FORMAT = 'desire.sector-render/1';
/** The seed both exporters give berths and trees. */
export const FEATURE_SEED = 0xd0c4;

export type SectorSource = {
  classes: Uint8Array;
  size: RasterSize;
  houses: LayerHouse[];
  metresPerPixel: number;
};

export type SectorEntry = {
  index: number;
  houses: number;
  berths: number;
  trees: number;
  bytes: number;
};

export type SectorIndex = {
  format: string;
  grid: SectorGrid;
  roof_centres: number[][];
  sectors: SectorEntry[];
};

export type Payload = {
  index: number;
  bytes: Uint8Array;
};

export type SectorExport = {
  payloads: Payload[];
  index: SectorIndex;
};

/** One palette for the whole city: a house's roof tone then depends on its own colour only. */
const cityTones = (houses: LayerHouse[]) => roofCentres(houses.map((house) => house.roof_rgb))
  .map((centre) => centre.map((channel) => Math.round(channel)));

/** Every sector's payload, and the index describing them. */
export function exportSectors(source: SectorSource): SectorExport {
  const grid = sectorGrid(source.size, source.metresPerPixel);
  const found = featuresInMetres(source, source.metresPerPixel, FEATURE_SEED);
  const sectors = partitionSectors({ grid, houses: source.houses, ...found });
  const payloads = sectors.map((sector) => ({ index: sector.index, bytes: writeSector(sector) }));
  const sectorsIndex = sectors.map((sector, at): SectorEntry => ({ index: sector.index,
    houses: sector.houses.length, berths: sector.berths.length, trees: sector.trees.length,
    bytes: payloads[at].bytes.length }));
  const index = { format: FORMAT, grid, roof_centres: cityTones(source.houses),
    sectors: sectorsIndex };
  return { payloads, index };
}

/** `index.json`, as written. */
export const indexJson = (index: SectorIndex) => `${JSON.stringify(index, null, 2)}\n`;
