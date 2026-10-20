/** Authored manifest contract; runtime validation is still required for untrusted JSON. */
export type Evidence = 'verified' | 'interpretation' | 'synthetic';
export type Pixel = { u: number; v: number };
export type Plan = { x_m: number; z_m: number };
export type Anchor = Plan & { id: string };
export type Provenance = { source: string; attribution: string; evidence: Evidence };
export type Calibration = {
  origin_px_x: number;
  origin_px_y: number;
  meters_per_pixel: number;
  rotation_radians: number;
  provenance: Provenance;
};
export type Illustration = {
  title: string;
  width_px: number;
  height_px: number;
  license: string;
  attribution: string;
  provenance: Provenance;
};
export type ScaleCheck = {
  id: string;
  from_px: Pixel;
  to_px: Pixel;
  expected_m: number;
  tolerance_m?: number;
};
export type Material = {
  id: string;
  base_color: number[];
  metallic: number;
  roughness: number;
  texture?: string;
};
export type Texture = {
  id: string;
  path: string;
  mime: string;
  max_bytes: number;
  width_px: number;
  height_px: number;
};
export type Place = {
  id: string;
  name: string;
  pixel: Pixel;
  footprint_m: { width_m: number; depth_m: number };
  height_m: number | null;
  height_evidence?: Evidence;
  source_ref?: string;
  rationale?: string;
  material: string;
  provenance: string[];
};
export type Manifest = {
  schema: string;
  id: string;
  label: string;
  network_allowed: boolean;
  illustration: Illustration;
  calibration: Calibration;
  scale_checks: ScaleCheck[];
  ground: { material: string };
  spawn: Plan;
  waypoints: Anchor[];
  materials: Material[];
  textures: Texture[];
  places: Place[];
};
export type Ground = {
  origin_x_m: number;
  origin_z_m: number;
  width_m: number;
  height_m: number;
};
export type Solid = {
  id: string;
  name: string;
  center: Plan;
  width_m: number;
  depth_m: number;
  height_m: number;
  height_evidence: Evidence;
  material: string;
  provenance: string[];
};
export type Blocker = { min_x: number; max_x: number; min_z: number; max_z: number };
export type Mesh = {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
};
export type Finding = { id: string; pass: boolean; detail: string };
