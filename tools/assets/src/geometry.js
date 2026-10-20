/** Flat-shaded box and ground meshes for the export; pure geometry, no engine. */

const COORDS_PER_VERTEX = 3;
const TOP_SHADE = 1;
const SIDE_SHADE = 0.82;
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3];
const COLOR_CHANNELS = 3;

const UP = [0, 1, 0];
const DOWN_IN_Z = [0, 0, -1];
const UP_IN_Z = [0, 0, 1];
const EAST = [1, 0, 0];
const WEST = [-1, 0, 0];

/** Quad corners as [x, y, z] keys resolved against a box corner record. */
const CUBE_FACES = [
  {
    normal: UP,
    shade: TOP_SHADE,
    corners: [['x0', 'y1', 'z0'], ['x0', 'y1', 'z1'], ['x1', 'y1', 'z1'], ['x1', 'y1', 'z0']],
  },
  {
    normal: WEST,
    shade: SIDE_SHADE,
    corners: [['x0', 'y0', 'z0'], ['x0', 'y0', 'z1'], ['x0', 'y1', 'z1'], ['x0', 'y1', 'z0']],
  },
  {
    normal: EAST,
    shade: SIDE_SHADE,
    corners: [['x1', 'y0', 'z1'], ['x1', 'y0', 'z0'], ['x1', 'y1', 'z0'], ['x1', 'y1', 'z1']],
  },
  {
    normal: DOWN_IN_Z,
    shade: SIDE_SHADE,
    corners: [['x1', 'y0', 'z0'], ['x0', 'y0', 'z0'], ['x0', 'y1', 'z0'], ['x1', 'y1', 'z0']],
  },
  {
    normal: UP_IN_Z,
    shade: SIDE_SHADE,
    corners: [['x0', 'y0', 'z1'], ['x1', 'y0', 'z1'], ['x1', 'y1', 'z1'], ['x0', 'y1', 'z1']],
  },
];

function emptyMesh() {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function addQuad(mesh, quad, look) {
  const base = mesh.positions.length / COORDS_PER_VERTEX;
  for (const point of quad) {
    mesh.positions.push(...point);
    mesh.normals.push(...look.normal);
    mesh.colors.push(...look.color);
  }
  for (const offset of QUAD_TRIANGLES) mesh.indices.push(base + offset);
}

/** Keeps only the RGB channels: COLOR_0 is declared as VEC3 in the artifact. */
function rgb(color) {
  return color.slice(0, COLOR_CHANNELS);
}

function shaded(color, factor) {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function boxCorners(solid) {
  const halfWidth = solid.width_m / 2;
  const halfDepth = solid.depth_m / 2;
  return {
    x0: solid.center.x_m - halfWidth,
    x1: solid.center.x_m + halfWidth,
    z0: solid.center.z_m - halfDepth,
    z1: solid.center.z_m + halfDepth,
    y0: 0,
    y1: solid.height_m,
  };
}

function resolveCorners(corners, keys) {
  return keys.map(([x, y, z]) => [corners[x], corners[y], corners[z]]);
}

/** Extrudes one footprint into a flat-shaded box of the declared height. */
export function buildBox(solid, color) {
  const mesh = emptyMesh();
  const corners = boxCorners(solid);
  const baseColor = rgb(color);
  for (const face of CUBE_FACES) {
    addQuad(mesh, resolveCorners(corners, face.corners), {
      normal: face.normal,
      color: shaded(baseColor, face.shade),
    });
  }
  return mesh;
}

/** Ground quad spanning the calibrated illustration frame, x east and z south. */
export function buildGround(ground, color) {
  const mesh = emptyMesh();
  const width = ground.width_m;
  const depth = ground.height_m;
  const quad = [[0, 0, 0], [0, 0, depth], [width, 0, depth], [width, 0, 0]];
  addQuad(mesh, quad, { normal: UP, color: rgb(color) });
  return mesh;
}

/** Concatenates meshes into one buffer, offsetting indices per part. */
export function mergeMeshes(meshes) {
  const merged = emptyMesh();
  for (const mesh of meshes) {
    const offset = merged.positions.length / COORDS_PER_VERTEX;
    merged.positions.push(...mesh.positions);
    merged.normals.push(...mesh.normals);
    merged.colors.push(...mesh.colors);
    for (const index of mesh.indices) merged.indices.push(index + offset);
  }
  return merged;
}
