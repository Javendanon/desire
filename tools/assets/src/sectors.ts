/**
 * Cuts the map's features into sectors of 1024 × 1024 source pixels (docs/waterdeep-3d/
 * sector-format.md). A feature belongs to the sector holding its point. Houses keep the stable
 * id their layer gave them (block × 4096 + lot), so a house's look never depends on which other
 * houses are loaded or exported. Pure.
 */
import type {
  CentredHouse, Sector, SectorBerth, SectorHouse, SectorTree,
} from '../../../src/lib/map/sector-format.ts';
import type { RasterSize } from './raster/raster-ops.ts';

export const SECTOR_PX = 1024;
/** Lots per block that fit in the id: the largest Waterdeep block holds 1,412. */
const LOTS_PER_BLOCK = 4096;

export interface SectorGrid {
  columns: number;
  rows: number;
  size_px: number;
  size_m: number;
  metres_per_pixel: number;
}

/**
 * A house as generate-houses writes it: its block and stable id (given from the lot index when
 * the lot is placed, before any region filter), then the shared house fields.
 */
export type LayerHouse = CentredHouse & {
  block: number;
  id: number;
};

export interface SectorInput {
  grid: SectorGrid;
  houses: LayerHouse[];
  berths: SectorBerth[];
  trees: SectorTree[];
}

export function houseId(block: number, lot: number): number {
  if (lot >= LOTS_PER_BLOCK) {
    throw new Error(`block ${block}: lot ${lot} does not fit the house id`);
  }
  return block * LOTS_PER_BLOCK + lot;
}

export function sectorGrid(raster: RasterSize, metresPerPixel: number): SectorGrid {
  return {
    columns: Math.ceil(raster.width / SECTOR_PX),
    rows: Math.ceil(raster.height / SECTOR_PX),
    size_px: SECTOR_PX,
    size_m: SECTOR_PX * metresPerPixel,
    metres_per_pixel: metresPerPixel,
  };
}

function sectorOf(grid: SectorGrid, x: number, z: number): number {
  const column = Math.min(grid.columns - 1, Math.max(0, Math.floor(x / grid.size_m)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(z / grid.size_m)));
  return row * grid.columns + column;
}

function toSectorHouses(houses: LayerHouse[]): SectorHouse[] {
  return houses.map((house) => ({
    id: house.id,
    x_m: house.center.x_m,
    z_m: house.center.z_m,
    width_m: house.width_m,
    depth_m: house.depth_m,
    rotation_radians: house.rotation_radians,
    height_m: house.height_m,
    roof_rgb: house.roof_rgb,
    frontage: house.frontage,
  }));
}

/** Non-empty sectors in index order. O(features + sectors). */
export function partitionSectors(input: SectorInput): Sector[] {
  const { grid } = input;
  const sectors = new Map<number, Sector>();
  const sectorAt = (x: number, z: number) => {
    const index = sectorOf(grid, x, z);
    let sector = sectors.get(index);
    if (!sector) {
      sector = {
        index,
        origin_x_m: (index % grid.columns) * grid.size_m,
        origin_z_m: Math.floor(index / grid.columns) * grid.size_m,
        size_m: grid.size_m,
        houses: [],
        berths: [],
        trees: [],
      };
      sectors.set(index, sector);
    }
    return sector;
  };
  for (const house of toSectorHouses(input.houses)) {
    sectorAt(house.x_m, house.z_m).houses.push(house);
  }
  for (const berth of input.berths) sectorAt(berth.x_m, berth.z_m).berths.push(berth);
  for (const tree of input.trees) sectorAt(tree.x_m, tree.z_m).trees.push(tree);
  return [...sectors.values()].sort((a, b) => a.index - b.index);
}
