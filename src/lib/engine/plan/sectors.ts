// Sector streaming as data: which square sectors stay resident around a map focus, and how much
// detail each one gets. Pure, map-agnostic, and tested without a GPU.

import type { Point2 } from '../math/hex.ts';

/** 0 is the far shell, 1 adds walls and a flat roof, 2 adds gable roofs. */
export type DetailLevel = 0 | 1 | 2;

/** Bytes of one 4 x 4 instance matrix, the dominant per-building GPU cost. */
export const MATRIX_BYTES = 64;

/** Rough per-sector entity and buffer overhead, reported so the budget is not optimistic. */
export const SECTOR_OVERHEAD_BYTES = 3072;

export interface SectorGrid {
  sizeM: number;
  originX: number;
  originZ: number;
  columns: number;
  rows: number;
}

export interface SectorBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DetailThresholds {
  nearM: number;
  midM: number;
}

export interface SectorRequest {
  radiusM: number;
  limit: number;
}

interface SectorDistance {
  index: number;
  distance: number;
}

export function createGrid(sizeM: number, bounds: SectorBounds): SectorGrid {
  if (!(sizeM > 0)) throw new Error(`createGrid: sizeM must be positive, got ${sizeM}`);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  if (!(width > 0 && depth > 0)) throw new Error('createGrid: bounds must have area');
  return {
    sizeM,
    originX: bounds.minX,
    originZ: bounds.minZ,
    columns: Math.ceil(width / sizeM),
    rows: Math.ceil(depth / sizeM),
  };
}

export function sectorCount(grid: SectorGrid): number {
  return grid.columns * grid.rows;
}

interface Cell {
  column: number;
  row: number;
}

function cellAt(grid: SectorGrid, point: Point2): Cell | null {
  const column = Math.floor((point.x - grid.originX) / grid.sizeM);
  const row = Math.floor((point.z - grid.originZ) / grid.sizeM);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null;
  return { column, row };
}

/** Sector index at a point, or null when the point is outside the map. */
export function sectorIndexAt(grid: SectorGrid, point: Point2): number | null {
  const cell = cellAt(grid, point);
  return cell ? cell.row * grid.columns + cell.column : null;
}

function cellOfIndex(grid: SectorGrid, index: number): Cell {
  if (!Number.isInteger(index) || index < 0 || index >= sectorCount(grid)) {
    throw new Error(`sector ${index} is not in a ${grid.columns} x ${grid.rows} grid`);
  }
  return { column: index % grid.columns, row: Math.floor(index / grid.columns) };
}

export function sectorBounds(grid: SectorGrid, index: number): SectorBounds {
  const { column, row } = cellOfIndex(grid, index);
  const minX = grid.originX + column * grid.sizeM;
  const minZ = grid.originZ + row * grid.sizeM;
  return { minX, maxX: minX + grid.sizeM, minZ, maxZ: minZ + grid.sizeM };
}

export function sectorCenter(grid: SectorGrid, index: number): Point2 {
  const bounds = sectorBounds(grid, index);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function candidates(grid: SectorGrid, cell: Cell, reach: number): number[] {
  const indices: number[] = [];
  for (let row = cell.row - reach; row <= cell.row + reach; row++) {
    for (let column = cell.column - reach; column <= cell.column + reach; column++) {
      const inside = column >= 0 && row >= 0 && column < grid.columns && row < grid.rows;
      if (inside) indices.push(row * grid.columns + column);
    }
  }
  return indices;
}

function nearest(grid: SectorGrid, focus: Point2, indices: readonly number[]): number[] {
  const picked: SectorDistance[] = indices.map((index) => {
    const centre = sectorCenter(grid, index);
    return { index, distance: Math.hypot(centre.x - focus.x, centre.z - focus.z) };
  });
  picked.sort((left, right) => left.distance - right.distance || left.index - right.index);
  return picked.map((entry) => entry.index);
}

/** Sectors within `radiusM` of the focus, nearest first, focus sector pinned to slot 0. */
export function activeSectors(grid: SectorGrid, focus: Point2, request: SectorRequest): number[] {
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new Error(`activeSectors: limit must be a positive integer, got ${request.limit}`);
  }
  if (!(request.radiusM > 0)) {
    throw new Error(`activeSectors: radiusM must be positive, got ${request.radiusM}`);
  }
  const cell = cellAt(grid, focus);
  if (!cell) return [];
  const reach = Math.ceil(request.radiusM / grid.sizeM);
  const focusIndex = cell.row * grid.columns + cell.column;
  const ordered = nearest(grid, focus, candidates(grid, cell, reach)).filter((index) => {
    const centre = sectorCenter(grid, index);
    return Math.hypot(centre.x - focus.x, centre.z - focus.z) <= request.radiusM;
  });
  return [focusIndex, ...ordered.filter((index) => index !== focusIndex)].slice(
    0,
    request.limit,
  );
}

/** Detail level for one sector, given its distance to the focus in metres. */
export function detailFor(distanceM: number, thresholds: DetailThresholds): DetailLevel {
  if (!(thresholds.nearM > 0 && thresholds.midM > thresholds.nearM)) {
    throw new Error('detailFor: thresholds need 0 < nearM < midM');
  }
  if (distanceM <= thresholds.nearM) return 2;
  if (distanceM <= thresholds.midM) return 1;
  return 0;
}

/** Reported resident GPU bytes for a sector set and its instanced buildings. */
export function residentBytes(sectors: number, buildings: number): number {
  return sectors * SECTOR_OVERHEAD_BYTES + buildings * MATRIX_BYTES;
}
