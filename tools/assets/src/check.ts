/** Acceptance checks over the artifact: scale, fidelity, collision, textures, navigation. */
import path from 'node:path';

import { evaluateScaleChecks } from './calibration.ts';
import { collisionBlockers } from './gltf-read.ts';
import { navigate } from './nav.ts';
import type { Blocker, Finding, Manifest, Solid } from './types.ts';
import type { Accessor, AssetExtras, Gltf, GltfJson, Primitive } from './gltf-types.ts';
import type { Scene } from './scene.ts';
import type { TextureCheck } from './textures.ts';

export type Artifact = {
  path: string; bytes: number; generator: string; written: boolean; stale_path?: string;
};
type ReportSpec = { manifest: Manifest; scene: Scene; gltf: Gltf; textures: TextureCheck[];
  bytes: number; artifactPath: string };
type Context = ReturnType<typeof buildContext>;
type Collision = ReturnType<typeof collisionState>;
export type BuildReport = ReturnType<typeof buildReport>;

const LOD_PREFIX = 'render/lod0/';
const VERTICES_PER_TRIANGLE = 3;
const COVERAGE_TOLERANCE_M = 0.01;
const ATTRIBUTE_TYPES: Record<string, string> = {
  POSITION: 'VEC3', NORMAL: 'VEC3', COLOR_0: 'VEC3', TEXCOORD_0: 'VEC2',
};

const finding = (id: string, pass: boolean, detail: string): Finding => ({ id, pass, detail });

/** Committed reports stay portable: only the file name is recorded, never a worktree path. */
export const reportedArtifactName = (file: string) => path.basename(file);

function nodesByName(json: GltfJson) {
  return new Map(json.nodes.map((node) => [node.name, node]));
}

function collisionState(gltf: Gltf) {
  const json = gltf.json;
  const nodes = nodesByName(json);
  const collision = nodes.get('collision');
  const lod0 = json.nodes.filter((node) => node.name.startsWith(LOD_PREFIX));
  const lod1 = nodes.get('render/lod1');
  const primitives = collision ? json.meshes[collision.mesh].primitives : [];
  const materialless = primitives.length > 0
    && primitives.every((item) => item.material === undefined);
  return {
    separate: Boolean(collision) && lod0.length > 0 && Boolean(lod1),
    materialless,
    blockers: collisionBlockers(gltf),
    lod0_nodes: lod0.length,
    lod1: Boolean(lod1),
  };
}

function triangleCount(json: GltfJson, meshIndex: number) {
  return json.meshes[meshIndex].primitives.reduce((sum, primitive) => {
    const accessor = json.accessors[primitive.indices];
    return sum + accessor.count / VERTICES_PER_TRIANGLE;
  }, 0);
}

function lodState(gltf: Gltf) {
  const lod0 = gltf.json.nodes.filter((node) => node.name.startsWith(LOD_PREFIX));
  const lod1 = gltf.json.nodes.find((node) => node.name === 'render/lod1');
  return {
    lod0_nodes: lod0.length,
    lod1_nodes: lod1 ? 1 : 0,
    lod0_triangles: lod0.reduce((sum, node) => sum + triangleCount(gltf.json, node.mesh), 0),
    lod1_triangles: lod1 ? triangleCount(gltf.json, lod1.mesh) : 0,
  };
}

function blockerContains(blocker: Blocker, solid: Solid) {
  const halfWidth = solid.width_m / 2;
  const halfDepth = solid.depth_m / 2;
  const west = solid.center.x_m - halfWidth + COVERAGE_TOLERANCE_M;
  const east = solid.center.x_m + halfWidth - COVERAGE_TOLERANCE_M;
  const north = solid.center.z_m - halfDepth + COVERAGE_TOLERANCE_M;
  const south = solid.center.z_m + halfDepth - COVERAGE_TOLERANCE_M;
  return blocker.min_x <= west && blocker.max_x >= east
    && blocker.min_z <= north && blocker.max_z >= south;
}

/** O(solids × blockers); returns footprints not covered by any collision quad. */
// ponytail: bounded to 1024 authored places; use a spatial index for larger scene chunks.
export function uncoveredSolids(blockers: Blocker[], solids: Solid[]): string[] {
  const missing = solids.filter((solid) => {
    return !blockers.some((blocker) => blockerContains(blocker, solid));
  });
  return missing.map((solid) => solid.id);
}

function collisionFindings(collision: Collision, scene: Scene) {
  const missing = uncoveredSolids(collision.blockers, scene.solids);
  const covered = missing.length === 0 && collision.blockers.length > 0;
  const detail = missing.length > 0
    ? `uncovered ${missing.join(', ')}`
    : `${scene.solids.length} solid footprints covered`;
  return [
    finding('collision.separate', collision.separate, 'collision node apart from render LODs'),
    finding('collision.materialless', collision.materialless, 'collision has no material'),
    finding('collision.covers_solids', covered, detail),
  ];
}

/** The accessor fields the layout check reads. */
type AccessorShape = Pick<Accessor, 'type' | 'count'>;
type AccessorLayout = { json: { accessors: AccessorShape[]; meshes: { primitives: Primitive[] }[] } };

function attributeProblem(
  accessors: AccessorShape[], attributes: Record<string, number>, position: AccessorShape
) {
  for (const [name, index] of Object.entries(attributes)) {
    const accessor = accessors[index];
    const whole = Number.isInteger(accessor.count) && accessor.count > 0;
    if (!whole || accessor.count !== position.count) return `${name} count ${accessor.count}`;
    if (accessor.type !== ATTRIBUTE_TYPES[name]) return `${name} type ${accessor.type}`;
  }
  return null;
}

function indicesProblem(accessors: AccessorShape[], primitive: Primitive) {
  if (primitive.indices === undefined) return null;
  const indices = accessors[primitive.indices];
  if (indices.type !== 'SCALAR') return `indices type ${indices.type}`;
  if (indices.count % VERTICES_PER_TRIANGLE !== 0) return `indices count ${indices.count}`;
  return null;
}

/** Structural check of the written accessors; exported so tests can feed broken input. */
export function accessorFinding(gltf: AccessorLayout): Finding {
  const broken: string[] = [];
  for (const mesh of gltf.json.meshes) {
    for (const primitive of mesh.primitives) {
      const position = gltf.json.accessors[primitive.attributes.POSITION];
      const problem = attributeProblem(gltf.json.accessors, primitive.attributes, position)
        ?? indicesProblem(gltf.json.accessors, primitive);
      if (problem) broken.push(problem);
    }
  }
  return finding('artifact.accessors', broken.length === 0,
    broken.join(', ') || 'attribute layout matches POSITION');
}

function lodFinding(collision: Collision, scene: Scene) {
  return finding('lod.levels', collision.lod1 && collision.lod0_nodes === scene.solids.length,
    `lod0 ${collision.lod0_nodes}/${scene.solids.length}, lod1 ${collision.lod1}`);
}

function renderSelectionFinding(json: GltfJson, scene: Scene) {
  const selected = json.scenes[json.scene]?.nodes ?? [];
  const names = selected.map((index) => json.nodes[index].name);
  const expected = ['render/ground', ...scene.solids.map((solid) => `render/lod0/${solid.id}`)];
  const pass = names.length === expected.length && expected.every((name) => names.includes(name));
  return finding('render.default_scene', pass, 'default scene contains only ground and LOD0');
}

function artifactFindings(gltf: Gltf, scene: Scene) {
  const json = gltf.json;
  // A parsed artifact is untrusted: any recorded field may be missing.
  const extras: Partial<AssetExtras> = json.asset.extras?.desire ?? {};
  const externalBuffers = (json.buffers ?? []).filter((buffer) => buffer.uri !== undefined);
  const listed = extras.unknown_places ?? [];
  const expected = scene.unknown.map((place) => place.id);
  return [
    accessorFinding(gltf),
    renderSelectionFinding(json, scene),
    finding('artifact.embedded', externalBuffers.length === 0
      && (json.images ?? []).every((image) => image.uri === undefined
        && Number.isInteger(image.bufferView)), 'geometry and compressed images are embedded'),
    finding('artifact.provenance',
      Boolean(extras.provenance?.source) && extras.network_allowed === false,
      `source ${extras.provenance?.source ?? 'missing'}, network ${extras.network_allowed}`),
    finding('artifact.unknown_places', JSON.stringify(listed) === JSON.stringify(expected),
      `listed ${listed.join(', ') || 'none'}`),
  ];
}

function fidelityFinding(scene: Scene, placeCount: number) {
  const counted = Object.values(scene.fidelity).reduce((sum, value) => sum + value, 0);
  const tally = scene.fidelity;
  return finding('fidelity.tally', counted === placeCount,
    `verified ${tally.verified}, interpretation ${tally.interpretation}, `
    + `synthetic ${tally.synthetic}, unknown ${tally.unknown}`);
}

function textureFinding(textures: TextureCheck[]) {
  const detail = textures.map((texture) => `${texture.id}: ${texture.detail}`).join('; ');
  return finding('textures.compressed', textures.every((texture) => texture.pass),
    detail || 'none declared');
}

function acceptanceChecks(context: Context) {
  const { manifest, scene, gltf, textures, collision, scaleChecks, navigation } = context;
  return [
    finding('scale.checks', scaleChecks.length > 0 && scaleChecks.every((entry) => entry.pass),
      `${scaleChecks.length} reference distances`),
    fidelityFinding(scene, manifest.places.length),
    ...collisionFindings(collision, scene),
    lodFinding(collision, scene),
    ...artifactFindings(gltf, scene),
    textureFinding(textures),
    finding('navigation.waypoints', navigation.pass,
      `${navigation.reachable_cells}/${navigation.total_cells} reached`),
  ];
}

function buildContext(spec: ReportSpec) {
  const { manifest, scene, gltf, textures } = spec;
  const scaleChecks = evaluateScaleChecks(manifest.calibration, manifest.scale_checks);
  const collision = collisionState(gltf);
  const navigation = navigate({
    ground: scene.ground,
    blockers: collision.blockers,
    spawn: scene.spawn,
    waypoints: scene.waypoints,
  });
  return { manifest, scene, gltf, textures, scaleChecks, collision, navigation };
}

function reportSections(context: Context) {
  const { manifest, scene, gltf, textures, scaleChecks, collision, navigation } = context;
  return {
    scale: {
      meters_per_pixel: manifest.calibration.meters_per_pixel,
      evidence: manifest.calibration.provenance.evidence,
      checks: scaleChecks,
    },
    fidelity: scene.fidelity,
    unknown_places: scene.unknown.map((place) => place.id),
    collision: {
      separate: collision.separate,
      materialless: collision.materialless,
      triangles: collision.blockers.length,
    },
    lod: lodState(gltf),
    textures,
    navigation,
  };
}

/** Builds the acceptance report; `pass` is true only when every check passes. */
export function buildReport(spec: ReportSpec) {
  const { manifest, artifactPath, bytes } = spec;
  const context = buildContext(spec);
  const checks = acceptanceChecks(context);
  return {
    id: context.scene.id,
    label: context.scene.label,
    pass: checks.every((entry) => entry.pass),
    checks,
    ...reportSections(context),
    artifact: {
      path: reportedArtifactName(artifactPath),
      bytes,
      generator: context.gltf.json.asset.generator,
      written: false,
    } as Artifact,
    provenance: manifest.illustration.provenance,
    network_allowed: false,
  };
}
