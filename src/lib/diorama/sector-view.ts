// One streamed city sector on stage: its ground tile, and when its payload holds features, its
// town, ships, lanterns, smoke and fog. Each part is its own instanced batch with bounds, so a
// sector off screen costs no draw calls. Releasing a sector frees what it put on the GPU, and
// keeps the stage's shared textures.

import * as pc from 'playcanvas';

import type { Textures } from '../engine/render/textures.ts';
import type { Sector } from '../map/sector-format.ts';
import { animateAmbience, buildAmbience, type WaterField } from './ambience.ts';
import { centred } from './sector-slice.ts';
import type { GroundGrid, GroundTile } from './sector-streaming.ts';
import type { Arrival } from './sector-worker.ts';
import { animateFleet, buildFleet } from './ships.ts';
import { glowWindows, type Mover } from './stage.ts';
import { groundEntity } from './terrain.ts';
import { buildTown } from './town.ts';

/** What every sector is built with. */
export interface SectorKit {
  app: pc.AppBase;
  textures: Textures;
  ground: GroundGrid & { tiles: GroundTile[] };
  roofCentres: [number, number, number][];
}

export interface SectorView {
  root: pc.Entity;
  houses: number;
  mover: Mover;
  release(): void;
}

const TEXTURE_SLOTS = ['diffuseMap', 'opacityMap', 'emissiveMap'] as const;

/** The tile's north-west corner in map metres. */
function tileOrigin(ground: GroundGrid, index: number) {
  const metres = ground.tile_px * ground.metres_per_pixel;
  return { x_m: (index % ground.columns) * metres, z_m: Math.floor(index / ground.columns) * metres };
}

/** The tile's vertex heights as the fog reads them, placed at the tile corner. */
function waterField(kit: SectorKit, tile: GroundTile, heights: Int16Array): WaterField {
  const { ground } = kit;
  return {
    heights,
    meta: { columns: tile.cells_x + 1, cell_m: ground.cell_px * ground.metres_per_pixel },
    origin: tileOrigin(ground, tile.index),
  };
}

function groundTile(kit: SectorKit, tile: GroundTile, arrival: Arrival) {
  const { ground } = kit;
  const { assets, geometry } = arrival;
  const extent_m: [number, number] = [tile.width_px * ground.metres_per_pixel,
    tile.height_px * ground.metres_per_pixel];
  return groundEntity(kit.app, geometry, { albedo: assets.albedo, detail: kit.textures.cobble,
    extent_m });
}

/** Houses, ships and ambience of a sector with features; returns what moves them. */
function populate(kit: SectorKit, sector: Sector, water: WaterField): { parts: pc.Entity[];
  mover: Mover; } {
  const { app, textures } = kit;
  const town = buildTown(app, { houses: sector.houses.map(centred),
    roofCentres: kit.roofCentres }, textures);
  glowWindows(town.windowMaterials);
  const fleet = buildFleet(app, sector.berths, textures);
  const ambience = buildAmbience(app, { water, town });
  const mover: Mover = (moment) => {
    animateFleet(fleet, moment.time);
    const { right, up } = moment.camera;
    animateAmbience(ambience, { time: moment.time, right, up });
  };
  return { parts: [town.root, fleet.root, ambience.root], mover };
}

/** Instance buffers, materials and the textures they own; meshes go with their entities. */
function releaseGpu(root: pc.Entity, shared: Set<pc.Texture>) {
  const renders = root.findComponents('render') as pc.RenderComponent[];
  const instances = renders.flatMap((render) => render.meshInstances);
  const buffers = new Set(instances.map((instance) => instance.instancingData?.vertexBuffer));
  const materials = new Set(instances.map((instance) => instance.material as pc.StandardMaterial));
  const textures = new Set([...materials].flatMap((material) =>
    TEXTURE_SLOTS.map((slot) => material[slot])));
  root.destroy();
  buffers.forEach((buffer) => buffer?.destroy());
  materials.forEach((material) => material.destroy());
  textures.forEach((texture) => texture && !shared.has(texture) && texture.destroy());
}

const still: Mover = () => {};

/** Builds a loaded sector's entities under one root, added to the scene by the caller. */
export function buildSectorView(kit: SectorKit, arrival: Arrival): SectorView {
  const { assets } = arrival;
  const tile = kit.ground.tiles[assets.index];
  const root = new pc.Entity(`sector-${assets.index}`);
  root.addChild(groundTile(kit, tile, arrival));
  const water = waterField(kit, tile, assets.heights);
  const life = assets.sector ? populate(kit, assets.sector, water) : { parts: [], mover: still };
  life.parts.forEach((part) => root.addChild(part));
  const shared = new Set(Object.values(kit.textures));
  return {
    root,
    houses: assets.sector?.houses.length ?? 0,
    mover: life.mover,
    release: () => {
      releaseGpu(root, shared);
      assets.albedo.close();
    },
  };
}
