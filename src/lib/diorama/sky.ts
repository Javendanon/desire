// Golden-hour light for the diorama, after the Dragon Heist reference art: a low warm sun over the
// sea, a violet zenith, a glowing horizon toward the sun, and a cool fill so shadows keep colour.

import * as pc from 'playcanvas';

/** Sun direction as yaw/pitch of the light entity (a directional light shines along −Y). */
export const SUN_ANGLES: [number, number] = [52, -125];
const SUN_COLOUR = '#ffc994';
const SUN_INTENSITY = 3.1;
const FILL_COLOUR = '#7d93b8';
const FILL_INTENSITY = 0.85;
const AMBIENT = '#948ca6';
export const HORIZON = '#d29a76';
const ZENITH = [0.3, 0.27, 0.4];
const GLOW = [1, 0.66, 0.38];
const SKY_SEGMENTS = 48;

export function lightScene(app: pc.AppBase, sun: pc.Entity): pc.Entity {
  app.scene.ambientLight = new pc.Color().fromString(AMBIENT);
  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = new pc.Color().fromString(HORIZON);
  sun.setEulerAngles(SUN_ANGLES[0], SUN_ANGLES[1], 0);
  if (sun.light) {
    sun.light.color = new pc.Color().fromString(SUN_COLOUR);
    sun.light.intensity = SUN_INTENSITY;
  }
  const fill = new pc.Entity('fill');
  fill.addComponent('light', {
    type: 'directional',
    color: new pc.Color().fromString(FILL_COLOUR),
    intensity: FILL_INTENSITY,
    castShadows: false,
  });
  fill.setEulerAngles(120, SUN_ANGLES[1] + 180, 0);
  app.root.addChild(fill);
  return fill;
}

/** Colour of the sky in a direction: horizon to zenith, warmer and brighter toward the sun. */
function skyColour(direction: pc.Vec3, toSun: pc.Vec3): number[] {
  const horizon = new pc.Color().fromString(HORIZON);
  const height = Math.max(0, direction.y);
  const glow = Math.max(0, direction.dot(toSun)) ** 6;
  const lift = (1 - height) ** 1.6;
  return [horizon.r, horizon.g, horizon.b].map((channel, index) => {
    const base = ZENITH[index] + (channel - ZENITH[index]) * lift;
    return Math.min(1, base + GLOW[index] * glow * 0.85);
  });
}

const BYTE_MAX = 255;
const GAMMA = 2.2;
/**
 * `Mesh.fromGeometry` stores colours with `setColors32`: bytes, not 0–1 floats. Vertex colours
 * are linear while the palette is sRGB (as the fog colour is read), so they are linearised to
 * meet the fog at the horizon without a seam.
 */
const toByte = (channel: number) => Math.round(channel ** GAMMA * BYTE_MAX);

/** An unlit dome with per-vertex colours, drawn behind everything and ignoring fog. */
export function buildSky(app: pc.AppBase, sun: pc.Entity, radius: number): pc.Entity {
  const bands = { latitudeBands: SKY_SEGMENTS, longitudeBands: SKY_SEGMENTS };
  const sphere = new pc.SphereGeometry({ radius, ...bands });
  const toSun = sun.up.clone().mulScalar(1).normalize();
  const colours: number[] = [];
  const positions = sphere.positions;
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
    const direction = new pc.Vec3(x, y, z).normalize();
    colours.push(...skyColour(direction, toSun).map(toByte), BYTE_MAX);
  }
  sphere.colors = colours;
  const mesh = pc.Mesh.fromGeometry(app.graphicsDevice, sphere);
  const dome = new pc.StandardMaterial();
  dome.useLighting = false;
  dome.useFog = false;
  dome.useSkybox = false;
  dome.diffuse = new pc.Color(0, 0, 0);
  dome.emissive = new pc.Color(1, 1, 1);
  dome.emissiveVertexColor = true;
  dome.cull = pc.CULLFACE_FRONT;
  dome.depthWrite = false;
  dome.update();
  const entity = new pc.Entity('sky');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, dome)],
    castShadows: false,
  });
  app.root.addChild(entity);
  return entity;
}
