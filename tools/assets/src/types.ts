/** Authored manifest contract. Runtime validation is still required for untrusted JSON. */
export type Evidence = 'verified' | 'interpretation' | 'synthetic';
export type Pixel = {
  u: number;
  v: number;
};
export type Plan = {
  x_m: number;
  z_m: number;
};
export type Anchor = Plan & { id: string };
export type Provenance = {
  source: string;
  attribution: string;
  evidence: Evidence;
};
/** The geometric part of a calibration: what the D04 transform reads. */
export type PixelTransform = {
  origin_px_x: number;
  origin_px_y: number;
  meters_per_pixel: number;
  rotation_radians: number;
};
export type Calibration = PixelTransform & {
  provenance: Provenance;
};
/** Raster extent of an illustration in pixels. */
export type Frame = {
  width_px: number;
  height_px: number;
};
export type Illustration = Frame & {
  title: string;
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
/** The D04 map version the package belongs to. Ids are UUIDs, the revision is positive. */
export type MapVersionRef = {
  id: string;
  map_id: string;
  revision: number;
};
/** How the engine kit draws a building: roof tint, ward tone and wall material. */
export type BuildingStyle = {
  roof: number;
  tone: number;
  stone: boolean;
};
export type Place = {
  id: string;
  name: string;
  pixel: Pixel;
  footprint_m: {
    width_m: number;
    depth_m: number;
  };
  /** Building rotation around Y; not a calibration rotation. */
  rotation_radians?: number;
  height_m: number | null;
  height_evidence?: Evidence;
  source_ref?: string;
  rationale?: string;
  style: BuildingStyle;
  provenance: string[];
};
export type Manifest = {
  schema: string;
  id: string;
  label: string;
  network_allowed: boolean;
  map_version: MapVersionRef;
  illustration: Illustration;
  calibration: Calibration;
  scale_checks: ScaleCheck[];
  sector_size_m: number;
  nav_cell_m?: number;
  spawn: Plan;
  waypoints: Anchor[];
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
  rotation_radians: number;
  height_m: number;
  height_evidence: Evidence;
  style: BuildingStyle;
  provenance: string[];
};
export type Finding = {
  id: string;
  pass: boolean;
  detail: string;
};
