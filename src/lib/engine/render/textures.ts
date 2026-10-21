// Procedural textures painted on a 2D canvas: no image files, no network. Light, mostly grey
// paintings so a material tint can colour them per district or roof.

import * as pc from 'playcanvas';

import { createRandom, type Random } from '../math/rng.ts';

type Painter = (g: CanvasRenderingContext2D, size: number, random: Random) => void;

export interface Textures {
  timber: pc.Texture;
  windows: pc.Texture;
  stone: pc.Texture;
  shingle: pc.Texture;
  cobble: pc.Texture;
  turf: pc.Texture;
  planks: pc.Texture;
}

const BEAM = '#3b2a1f';
const WINDOW_GLASS = '#211c19';
const WINDOW_LIGHT = '#ffb35a';
// Window rectangles as fractions of the wall texture, shared by the wall and its glow map.
const WINDOWS: readonly [number, number, number, number][] = [
  [0.43, 0.15, 0.14, 0.2],
  [0.1, 0.6, 0.14, 0.2],
  [0.43, 0.6, 0.14, 0.2],
];

function speckle(g: CanvasRenderingContext2D, random: Random, count: number, base: number) {
  const size = g.canvas.width;
  for (let i = 0; i < count; i++) {
    const v = base + Math.floor((random() - 0.5) * 50);
    g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.3)`;
    g.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
  }
}

const paintTimber: Painter = (g, n, random) => {
  g.fillStyle = '#e4d6b8';
  g.fillRect(0, 0, n, n);
  speckle(g, random, 2600, 215);
  const b = n * 0.055;
  g.fillStyle = BEAM;
  g.fillRect(0, 0, n, b);
  g.fillRect(0, n - b, n, b);
  g.fillRect(0, n * 0.48, n, b * 0.8);
  [0, n * 0.33, n * 0.66, n - b].forEach((x) => g.fillRect(x, 0, b, n));
  g.strokeStyle = BEAM;
  g.lineWidth = b * 0.65;
  g.beginPath();
  g.moveTo(b, n * 0.47);
  g.lineTo(n * 0.33, b);
  g.moveTo(n * 0.66 + b, n * 0.52);
  g.lineTo(n - b, n - b);
  g.stroke();
  g.fillStyle = WINDOW_GLASS;
  WINDOWS.forEach(([x, y, w, h]) => g.fillRect(x * n, y * n, w * n, h * n));
};

const paintWindows: Painter = (g, n) => {
  g.fillStyle = '#000000';
  g.fillRect(0, 0, n, n);
  g.fillStyle = WINDOW_LIGHT;
  WINDOWS.slice(0, 2).forEach(([x, y, w, h]) => g.fillRect(x * n, y * n, w * n, h * n));
};

const paintStone: Painter = (g, n, random) => {
  g.fillStyle = '#5a5650';
  g.fillRect(0, 0, n, n);
  const rows = 8;
  const h = n / rows;
  for (let r = 0; r < rows; r++) {
    for (let x = (r % 2) * -h; x < n; ) {
      const w = h * (1.2 + random() * 1.2);
      const v = 150 + Math.floor(random() * 45);
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
      x += w;
    }
  }
  speckle(g, random, 1800, 120);
};

const paintShingle: Painter = (g, n, random) => {
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, n, n);
  const rows = 12;
  const h = n / rows;
  const w = n / 10;
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c < 11; c++) {
      const v = 175 + Math.floor(random() * 60);
      const x = c * w + ((r % 2) * w) / 2;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.moveTo(x + 1, r * h);
      g.lineTo(x + w - 1, r * h);
      g.lineTo(x + w - 1, r * h + h * 0.75);
      g.quadraticCurveTo(x + w / 2, r * h + h * 1.15, x + 1, r * h + h * 0.75);
      g.fill();
    }
  }
};

const paintCobble: Painter = (g, n, random) => {
  g.fillStyle = '#5c5852';
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 520; i++) {
    const v = 170 + Math.floor(random() * 60);
    g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
    g.beginPath();
    const radiusX = 5 + random() * 6;
    const radiusY = 4 + random() * 5;
    g.ellipse(random() * n, random() * n, radiusX, radiusY, random() * 3, 0, Math.PI * 2);
    g.fill();
  }
};

const paintTurf: Painter = (g, n, random) => {
  g.fillStyle = '#9fa98a';
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 4000; i++) {
    const v = 140 + Math.floor(random() * 90);
    g.fillStyle = `rgba(${v - 30},${v},${v - 50},0.5)`;
    g.fillRect(random() * n, random() * n, 1, 2 + random() * 3);
  }
};

const paintPlanks: Painter = (g, n, random) => {
  const rows = 8;
  const h = n / rows;
  for (let r = 0; r < rows; r++) {
    const v = 110 + Math.floor(random() * 40);
    g.fillStyle = `rgb(${v},${Math.floor(v * 0.75)},${Math.floor(v * 0.52)})`;
    g.fillRect(0, r * h, n, h);
    g.fillStyle = 'rgba(30,20,12,.8)';
    g.fillRect(0, r * h, n, 2);
    g.fillRect(random() * n, r * h, 2, h);
  }
  speckle(g, random, 1200, 90);
};

function paintTexture(
  device: pc.GraphicsDevice,
  painter: Painter,
  random: Random,
  name: string,
): pc.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error(`Could not paint the ${name} texture: no 2D canvas context.`);
  painter(g, size, random);
  const texture = new pc.Texture(device, {
    name,
    width: size,
    height: size,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    anisotropy: 4,
  });
  texture.setSource(canvas);
  return texture;
}

export function paintTextures(device: pc.GraphicsDevice, seed: number): Textures {
  const random = createRandom(seed);
  return {
    timber: paintTexture(device, paintTimber, random, 'timber'),
    windows: paintTexture(device, paintWindows, random, 'windows'),
    stone: paintTexture(device, paintStone, random, 'stone'),
    shingle: paintTexture(device, paintShingle, random, 'shingle'),
    cobble: paintTexture(device, paintCobble, random, 'cobble'),
    turf: paintTexture(device, paintTurf, random, 'turf'),
    planks: paintTexture(device, paintPlanks, random, 'planks'),
  };
}

export function destroyTextures(textures: Textures): void {
  Object.values(textures).forEach((texture) => texture.destroy());
}
