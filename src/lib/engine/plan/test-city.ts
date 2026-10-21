// Procedural TEST city: a deterministic layout for developing the viewer. It is NOT Waterdeep's
// cartography (that is D05/D13). Pure data, no engine: tested in tests/test-city.test.ts.

import { axialToWorld, hexesWithin, type Point2 } from '../math/hex.ts';
import { between, createRandom, type Random } from '../math/rng.ts';

export const TEST_CITY_LABEL = 'Geometría de prueba: no es la cartografía de Waterdeep';

export interface DistrictSeed {
  id: string;
  center: Point2;
  /** Ground tint multiplied over the paving texture. */
  tint: string;
  baseHeight: number;
}

export interface Tile extends Point2 {
  height: number;
  top: number;
  district: string;
}

export interface Building extends Point2 {
  y: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  stone: boolean;
  roof: number;
}

export interface WallPiece extends Point2 {
  rotation: number;
  tower: boolean;
}

export interface TreeSpot {
  x: number;
  z: number;
  scale: number;
}

export interface CityPlan {
  tiles: Tile[];
  buildings: Building[];
  tombs: (Point2 & { y: number })[];
  trees: TreeSpot[];
  walls: WallPiece[];
  spot: Point2 & { y: number };
  keep: Point2 & { base: number };
}

export interface CityInput {
  seed: number;
  districts: readonly DistrictSeed[];
  hill: string;
  graveyard: string;
  harbor: string;
  /** Districts built mostly in stone. The rest are timber-framed. */
  stone: readonly string[];
  /** Districts whose houses are taller. */
  tall: readonly string[];
}

export const TILE_SIZE = 3;
export const CITY_RADIUS = 33;
export const WALL_RADIUS = 34.5;
export const ROOF_TINTS = 5;
export const HARBOR_BASIN = { x: 4, z: 25, radius: 13 };
const SPOT_CLEARANCE = 10;

export const TEST_DISTRICTS: readonly DistrictSeed[] = [
  { id: 'castle', center: { x: 0, z: -5 }, tint: '#c4bdb0', baseHeight: 2.6 },
  {
    id: 'graveyard',
    center: { x: -7, z: -17 },
    tint: '#8d9a76',
    baseHeight: 0.9,
  },
  { id: 'north', center: { x: 9, z: -21 }, tint: '#c2b39b', baseHeight: 1.2 },
  { id: 'sea', center: { x: -13, z: -6 }, tint: '#b8bbbb', baseHeight: 1.4 },
  { id: 'trade', center: { x: 11, z: -4 }, tint: '#c8ad8d', baseHeight: 1.1 },
  { id: 'harbor', center: { x: 3, z: 13 }, tint: '#ad9b85', baseHeight: 0.7 },
  { id: 'south', center: { x: 17, z: 9 }, tint: '#c0a784', baseHeight: 0.9 },
];

export const TEST_CITY: CityInput = {
  seed: 7,
  districts: TEST_DISTRICTS,
  hill: 'castle',
  graveyard: 'graveyard',
  harbor: 'harbor',
  stone: ['sea', 'castle'],
  tall: ['north', 'sea'],
};

export function coastX(z: number): number {
  return -21 + 5 * Math.sin(z * 0.09);
}

export function isLand(x: number, z: number): boolean {
  const inBasin = Math.hypot(x - HARBOR_BASIN.x, z - HARBOR_BASIN.z) < HARBOR_BASIN.radius;
  return x >= coastX(z) && !inBasin;
}

function nearestDistrict(point: Point2, districts: readonly DistrictSeed[]): DistrictSeed {
  let best = districts[0];
  let bestDistance = Infinity;
  for (const district of districts) {
    const distance = Math.hypot(point.x - district.center.x, point.z - district.center.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = district;
    }
  }
  return best;
}

function planTiles(input: CityInput, random: Random): Tile[] {
  const hill = input.districts.find((d) => d.id === input.hill);
  const tiles: Tile[] = [];
  for (const cell of hexesWithin(11)) {
    const { x, z } = axialToWorld(cell, TILE_SIZE);
    if (!isLand(x, z) || Math.hypot(x, z) > CITY_RADIUS) continue;
    const district = nearestDistrict({ x, z }, input.districts);
    const fromHill = hill ? Math.hypot(x - hill.center.x, z - hill.center.z) : Infinity;
    const mount = Math.max(0, 5.5 - fromHill * 0.42);
    const height = district.baseHeight + mount + random() * 0.35;
    tiles.push({ x, z, height, top: height - 0.5, district: district.id });
  }
  return tiles;
}

function findSpot(tiles: readonly Tile[], harbor: DistrictSeed): Point2 & { y: number } {
  let best = tiles[0];
  let bestDistance = Infinity;
  for (const tile of tiles) {
    if (tile.district !== harbor.id) continue;
    const distance = Math.hypot(tile.x - harbor.center.x + 1, tile.z - harbor.center.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  }
  return { x: best.x, z: best.z, y: best.top };
}

function housesOn(tile: Tile, input: CityInput, random: Random): Building[] {
  const count = 2 + Math.floor(random() * 3);
  const tall = input.tall.includes(tile.district) ? 1.35 : 1;
  const stone = input.stone.includes(tile.district);
  return Array.from({ length: count }, () => ({
    x: tile.x + between(random, -1.6, 1.6),
    z: tile.z + between(random, -1.6, 1.6),
    y: tile.top,
    width: between(random, 1.1, 2),
    depth: between(random, 1.5, 2.7),
    height: between(random, 1.6, 3.7) * tall,
    rotation: Math.floor(random() * 6) * (Math.PI / 3) + between(random, -0.1, 0.1),
    stone: stone || random() < 0.18,
    roof: Math.floor(random() * ROOF_TINTS),
  }));
}

function planBuildings(input: CityInput, tiles: readonly Tile[], spot: Point2, random: Random) {
  const hill = input.districts.find((d) => d.id === input.hill);
  const buildings: Building[] = [];
  const tombs: CityPlan['tombs'] = [];
  for (const tile of tiles) {
    if (Math.hypot(tile.x - spot.x, tile.z - spot.z) < SPOT_CLEARANCE) continue;
    if (tile.district === input.graveyard) {
      for (let i = 0; i < 4; i++) {
        const x = tile.x + between(random, -2, 2);
        tombs.push({ x, z: tile.z + between(random, -2, 2), y: tile.top });
      }
      continue;
    }
    if (hill && Math.hypot(tile.x - hill.center.x, tile.z - hill.center.z) < 4) continue;
    buildings.push(...housesOn(tile, input, random));
  }
  return { buildings, tombs };
}

function planWalls(): WallPiece[] {
  const pieces: WallPiece[] = [];
  for (let degrees = 0; degrees < 360; degrees += 6) {
    const angle = (degrees * Math.PI) / 180;
    const x = Math.cos(angle) * WALL_RADIUS;
    const z = Math.sin(angle) * WALL_RADIUS;
    if (!isLand(x, z)) continue;
    pieces.push({
      x,
      z,
      rotation: Math.PI / 2 - angle,
      tower: pieces.length % 5 === 0,
    });
  }
  return pieces;
}

function planTrees(random: Random, graveyard: DistrictSeed | undefined) {
  const trees: CityPlan['trees'] = [];
  for (let i = 0; i < 520; i++) {
    const angle = random() * Math.PI * 2;
    const distance = between(random, WALL_RADIUS + 4, WALL_RADIUS + 90);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (isLand(x, z)) trees.push({ x, z, scale: between(random, 0.8, 1.7) });
  }
  if (graveyard) {
    for (let i = 0; i < 40; i++) {
      const x = graveyard.center.x + between(random, -6, 6);
      const z = graveyard.center.z + between(random, -5, 5);
      trees.push({ x, z, scale: between(random, 0.6, 1) });
    }
  }
  return trees;
}

function district(input: CityInput, id: string): DistrictSeed {
  const found = input.districts.find((d) => d.id === id);
  if (!found) throw new Error(`planCity: district "${id}" is not in the input`);
  return found;
}

function closestTile(tiles: readonly Tile[], point: Point2): Tile {
  const distance = (t: Tile): number => Math.hypot(t.x - point.x, t.z - point.z);
  return tiles.reduce((best, t) => (distance(t) < distance(best) ? t : best));
}

export function planCity(input: CityInput = TEST_CITY): CityPlan {
  const random = createRandom(input.seed);
  const harbor = district(input, input.harbor);
  const hill = district(input, input.hill);
  const tiles = planTiles(input, random);
  const spot = findSpot(tiles, harbor);
  const { buildings, tombs } = planBuildings(input, tiles, spot, random);
  const hillTile = closestTile(tiles, hill.center);
  return {
    tiles,
    buildings,
    tombs,
    trees: planTrees(
      random,
      input.districts.find((d) => d.id === input.graveyard),
    ),
    walls: planWalls(),
    spot,
    keep: { x: hill.center.x, z: hill.center.z, base: hillTile.top },
  };
}
