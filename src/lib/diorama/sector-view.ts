// One streamed city sector's ground on stage: its tile mesh (built in the Worker) under its
// albedo, with the cobble detail overlay. Houses, ships and ambience are drawn city-wide from
// every sector's plans (city-life.ts). Releasing a sector frees what its tile put on the GPU and
// keeps the stage's shared textures.

import * as pc from 'playcanvas';

import type { Textures } from '../engine/render/textures.ts';
import { releaseGpu } from './gpu-release.ts';
import type { GroundGrid, GroundTile } from './sector-streaming.ts';
import type { Arrival } from './sector-worker.ts';
import { groundEntity } from './terrain.ts';

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
  release(): void;
}

function groundTile(kit: SectorKit, tile: GroundTile, arrival: Arrival) {
  const { ground } = kit;
  const { assets, geometry } = arrival;
  const extent_m: [number, number] = [tile.width_px * ground.metres_per_pixel,
    tile.height_px * ground.metres_per_pixel];
  return groundEntity(kit.app, geometry, { albedo: assets.albedo, detail: kit.textures.cobble,
    extent_m });
}

/** Builds a loaded sector's ground under one root, added to the scene by the caller. */
export function buildSectorView(kit: SectorKit, arrival: Arrival): SectorView {
  const { assets } = arrival;
  const tile = kit.ground.tiles[assets.index];
  const root = new pc.Entity(`sector-${assets.index}`);
  root.addChild(groundTile(kit, tile, arrival));
  const shared = new Set(Object.values(kit.textures));
  return {
    root,
    houses: assets.sector?.houses.length ?? 0,
    release: () => {
      releaseGpu(root, shared);
      assets.albedo.close();
    },
  };
}
