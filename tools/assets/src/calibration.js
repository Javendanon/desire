/** D04 calibration: pixel frame to world meters (x east, z south, y never inferred). */

export const DEFAULT_TOLERANCE_M = 1;
export const MILLIMETERS = 1000;

const roundMm = (value) => Math.round(value * MILLIMETERS) / MILLIMETERS;

/** Applies the D04 transform to one pixel anchor. */
export function pixelToPlan(calibration, pixel) {
  const scale = calibration.meters_per_pixel;
  const a = (pixel.u - calibration.origin_px_x) * scale;
  const b = (pixel.v - calibration.origin_px_y) * scale;
  const theta = calibration.rotation_radians;
  return {
    x_m: a * Math.cos(theta) - b * Math.sin(theta),
    z_m: a * Math.sin(theta) + b * Math.cos(theta),
  };
}

/** Straight-line plan distance between two meter anchors. */
export function planDistance(from, to) {
  return Math.hypot(to.x_m - from.x_m, to.z_m - from.z_m);
}

/** Compares each declared reference distance with the distance implied by the calibration. */
export function evaluateScaleChecks(calibration, checks) {
  return checks.map((check) => {
    const computed = planDistance(
      pixelToPlan(calibration, check.from_px),
      pixelToPlan(calibration, check.to_px),
    );
    const tolerance = check.tolerance_m ?? DEFAULT_TOLERANCE_M;
    const computed_m = roundMm(computed);
    const delta_m = roundMm(computed - check.expected_m);
    return {
      id: check.id,
      computed_m,
      expected_m: check.expected_m,
      delta_m,
      tolerance_m: tolerance,
      pass: Math.abs(delta_m) <= tolerance,
    };
  });
}
