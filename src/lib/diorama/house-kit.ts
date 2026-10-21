// Extra house meshes for the diorama, in unit space like the D11 kit: footprint 1 × 1 centred on
// the origin, eaves at y = 0, ridge at y = 1.

import * as pc from 'playcanvas';

type Vertex = [number, number, number];

/** Half the ridge length of a hip roof, as a share of the depth. */
const HIP_RIDGE_HALF = 0.22;

function meshOf(device: pc.GraphicsDevice, triangles: Vertex[][], uvs: number[][]): pc.Mesh {
  const positions = triangles.flat(2);
  const indices = Array.from({ length: positions.length / 3 }, (_, index) => index);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs.flat());
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Hip roof: four sloped faces, a short ridge along Z. */
export function hipMesh(device: pc.GraphicsDevice): pc.Mesh {
  const a: Vertex = [-0.5, 0, -0.5];
  const b: Vertex = [0.5, 0, -0.5];
  const c: Vertex = [0.5, 0, 0.5];
  const d: Vertex = [-0.5, 0, 0.5];
  const front: Vertex = [0, 1, -HIP_RIDGE_HALF];
  const back: Vertex = [0, 1, HIP_RIDGE_HALF];
  const triangles: Vertex[][] = [
    [d, a, front], [d, front, back],
    [b, c, back], [b, back, front],
    [a, b, front],
    [c, d, back],
  ];
  const slope = [0, 0, 1, 0, 0.5, 1];
  const quad = [0, 0, 1, 0, 0.5, 1];
  return meshOf(device, triangles, [quad, slope, quad, slope, slope, slope]);
}
