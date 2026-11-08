// Flat PBR materials shared by the shell, the slide and the props. Blender builds them by name;
// `variant` is the part of a prop the engine tints per catalogue variant at runtime.
import type { MaterialKind } from '../../../src/generated/contracts.ts';

export interface MaterialSpec {
  color: string;
  roughness: number;
  metallic: number;
  /** 1 is opaque. */
  alpha: number;
}

const matte = (color: string, roughness = 0.85): MaterialSpec => ({
  color,
  roughness,
  metallic: 0,
  alpha: 1,
});

const SURFACES: Record<MaterialKind, MaterialSpec> = {
  wood_plank: matte('#8a6242', 0.7),
  flagstone: matte('#7d7a72'),
  stone: matte('#8e8a82', 0.9),
  plaster: matte('#d9cfbd', 0.95),
  earth: matte('#6b5a45', 1),
  tile: matte('#b8b2a6', 0.5),
  deck: matte('#a57c52', 0.75),
};

const DETAILS: Record<string, MaterialSpec> = {
  glass: { color: '#9fc4d6', roughness: 0.05, metallic: 0, alpha: 0.35 },
  trim: matte('#5a3b26', 0.6),
  iron: { color: '#3b3a38', roughness: 0.45, metallic: 0.8, alpha: 1 },
  ember: matte('#2a1d16', 1),
  linen: matte('#e6dccb', 0.95),
  slide: matte('#b07a45', 0.35),
  /** Neutral base the engine multiplies by the catalogue variant tint. */
  variant: matte('#ffffff', 0.7),
};

export const MATERIALS: Readonly<Record<string, MaterialSpec>> = { ...SURFACES, ...DETAILS };
