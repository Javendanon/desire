// The test city as PlayCanvas entities. Repeated things are instanced and grouped by material:
// one draw call per district ground, per wall type, per roof tint.

import * as pc from 'playcanvas';

import {
  coastX,
  HARBOR_BASIN,
  ROOF_TINTS,
  TILE_SIZE,
  type Building,
  type CityPlan,
  type DistrictSeed,
} from '../plan/test-city.ts';
import { gableMesh, geometryMesh, instancedEntity, material, part, trs } from './kit.ts';
import type { Textures } from './textures.ts';

const ROOF_COLORS = ['#7c8792', '#b8714f', '#5f6a74', '#8f8770', '#a35f45'];
const TREE_GREEN = '#2f4a33';
const LAND_GREEN = '#6d7556';
const LAND_EAST = 260;

export interface CityEntities {
  root: pc.Entity;
  /** Wall materials whose window glow follows the time of day. */
  windowMaterials: pc.StandardMaterial[];
}

function buildGround(
  app: pc.AppBase,
  plan: CityPlan,
  districts: readonly DistrictSeed[],
  tx: Textures,
) {
  const root = new pc.Entity('ground');
  const geometry = new pc.CylinderGeometry({
    radius: TILE_SIZE * 0.995,
    height: 1,
    capSegments: 6,
  });
  const prism = geometryMesh(app.graphicsDevice, geometry);
  for (const district of districts) {
    // Masonry reads as terrace walls on the tile sides and as paving on top.
    const map = district.id === 'graveyard' ? tx.turf : tx.stone;
    const matrices = plan.tiles
      .filter((t) => t.district === district.id)
      .map((t) => trs([t.x, t.height / 2 - 0.5, t.z], Math.PI / 6, [1, t.height, 1]));
    const mat = material({ map, color: district.tint, gloss: 0.15, tiling: 2 });
    root.addChild(instancedEntity(app, prism, mat, matrices));
  }
  return root;
}

function wallMatrix(b: Building): pc.Mat4 {
  return trs([b.x, b.y + b.height / 2, b.z], b.rotation, [b.width, b.height, b.depth]);
}

function roofMatrix(b: Building): pc.Mat4 {
  const scale = [b.width * 1.18, 0.9 + b.width * 0.35, b.depth * 1.1] as const;
  return trs([b.x, b.y + b.height, b.z], b.rotation, scale);
}

function windowedWall(map: pc.Texture, windows: pc.Texture): pc.StandardMaterial {
  return material({
    map,
    emissive: '#ffffff',
    emissiveMap: windows,
    emissiveIntensity: 0.9,
    gloss: 0.1,
  });
}

function buildHouses(app: pc.AppBase, plan: CityPlan, tx: Textures) {
  const root = new pc.Entity('houses');
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const timber = windowedWall(tx.timber, tx.windows);
  const stone = windowedWall(tx.stone, tx.windows);
  const timberHouses = plan.buildings.filter((b) => !b.stone).map(wallMatrix);
  const stoneHouses = plan.buildings.filter((b) => b.stone).map(wallMatrix);
  root.addChild(instancedEntity(app, cube, timber, timberHouses));
  root.addChild(instancedEntity(app, cube, stone, stoneHouses));
  const gable = gableMesh(app.graphicsDevice);
  for (let tint = 0; tint < ROOF_TINTS; tint++) {
    const roofs = plan.buildings.filter((b) => b.roof === tint).map(roofMatrix);
    const mat = material({
      map: tx.shingle,
      color: ROOF_COLORS[tint],
      gloss: 0.3,
      twoSided: true,
    });
    root.addChild(instancedEntity(app, gable, mat, roofs));
  }
  return { root, windowMaterials: [timber, stone] };
}

function buildGraveyardAndTrees(app: pc.AppBase, plan: CityPlan, tx: Textures) {
  const root = new pc.Entity('green');
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const tombs = plan.tombs.map((t) => trs([t.x, t.y + 0.35, t.z], t.x * 3, [0.4, 0.7, 0.14]));
  root.addChild(instancedEntity(app, cube, material({ map: tx.stone, gloss: 0.1 }), tombs));
  const coneGeometry = new pc.ConeGeometry({
    baseRadius: 1.1,
    height: 4.2,
    capSegments: 9,
  });
  const cone = geometryMesh(app.graphicsDevice, coneGeometry);
  const trees = plan.trees.map((t) =>
    trs([t.x, 1.9 * t.scale, t.z], 0, [t.scale, t.scale, t.scale]),
  );
  root.addChild(instancedEntity(app, cone, material({ color: TREE_GREEN, gloss: 0.1 }), trees));
  return root;
}

function buildWalls(app: pc.AppBase, plan: CityPlan, tx: Textures) {
  const root = new pc.Entity('walls');
  const stone = material({ map: tx.stone, gloss: 0.1 });
  const segment = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const towerGeometry = new pc.CylinderGeometry({
    radius: 1.4,
    height: 5,
    capSegments: 10,
  });
  const tower = geometryMesh(app.graphicsDevice, towerGeometry);
  const pieces = plan.walls.map((w) => trs([w.x, 1.2, w.z], w.rotation, [3.9, 3.4, 1.1]));
  const towers = plan.walls.filter((w) => w.tower).map((w) => trs([w.x, 2, w.z], 0, [1, 1, 1]));
  root.addChild(instancedEntity(app, segment, stone, pieces));
  root.addChild(instancedEntity(app, tower, stone, towers));
  return root;
}

function buildKeep(plan: CityPlan, tx: Textures): pc.Entity {
  const keep = new pc.Entity('keep');
  keep.setLocalPosition(plan.keep.x, plan.keep.base, plan.keep.z);
  const stone = material({ map: tx.stone, gloss: 0.1 });
  const slate = material({ map: tx.shingle, color: '#68737d', gloss: 0.3 });
  part(keep, {
    type: 'box',
    material: stone,
    position: [0, 3, 0],
    scale: [5, 6, 5],
  });
  for (const [dx, dz] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ]) {
    part(keep, {
      type: 'cylinder',
      material: stone,
      position: [dx, 4, dz],
      scale: [2.2, 8, 2.2],
    });
    part(keep, {
      type: 'cone',
      material: slate,
      position: [dx, 9.3, dz],
      scale: [2.9, 2.6, 2.9],
    });
  }
  return keep;
}

/** The [west, east] stretches of land on one row of z, cut around the harbour basin. */
function landRuns(z: number): [number, number][] {
  const west = coastX(z);
  const dz = z - HARBOR_BASIN.z;
  if (Math.abs(dz) >= HARBOR_BASIN.radius) return [[west, LAND_EAST]];
  const half = Math.sqrt(HARBOR_BASIN.radius ** 2 - dz ** 2);
  const runs: [number, number][] = [[HARBOR_BASIN.x + half, LAND_EAST]];
  if (HARBOR_BASIN.x - half > west) runs.push([west, HARBOR_BASIN.x - half]);
  return runs;
}

/** Countryside: strips per row of z from the coast to the east edge, open over the harbour. */
function landMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (x0: number, x1: number, z0: number, z1: number) => {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
    uvs.push(x0 / 9, z0 / 9, x1 / 9, z0 / 9, x1 / 9, z1 / 9, x0 / 9, z1 / 9);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (let z = -220; z < 220; z += 2) {
    for (const [x0, x1] of landRuns(z + 1)) quad(x0, x1, z, z + 2);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function buildLand(app: pc.AppBase, tx: Textures): pc.Entity {
  const land = new pc.Entity('land');
  const mat = material({ map: tx.turf, color: LAND_GREEN });
  const instance = new pc.MeshInstance(landMesh(app.graphicsDevice), mat);
  land.addComponent('render', {
    meshInstances: [instance],
    receiveShadows: true,
  });
  land.setLocalPosition(0, -0.15, 0);
  return land;
}

export function buildCity(
  app: pc.AppBase,
  plan: CityPlan,
  districts: readonly DistrictSeed[],
  tx: Textures,
): CityEntities {
  const root = new pc.Entity('test-city');
  const houses = buildHouses(app, plan, tx);
  root.addChild(buildGround(app, plan, districts, tx));
  root.addChild(houses.root);
  root.addChild(buildGraveyardAndTrees(app, plan, tx));
  root.addChild(buildWalls(app, plan, tx));
  root.addChild(buildKeep(plan, tx));
  root.addChild(buildLand(app, tx));
  return { root, windowMaterials: houses.windowMaterials };
}
