//! Plan geometry in metres (x east, z south): containment and overlap of polygons that may be
//! concave, and oriented footprints. Ported from `tools/assets/src/{polygon,footprint}.ts`.
//!
//! Rotation follows the engine (PlayCanvas `setFromEulerAngles(0, θ, 0)`): the width axis points
//! to (cos θ, −sin θ) in plan and the depth axis to (sin θ, cos θ).

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Plan {
    pub x_m: f64,
    pub z_m: f64,
}

impl Plan {
    /// `point + direction · distance`.
    pub fn offset(self, direction: Plan, distance: f64) -> Plan {
        Plan {
            x_m: self.x_m + direction.x_m * distance,
            z_m: self.z_m + direction.z_m * distance,
        }
    }
}

/// Consecutive pairs of a closed ring: (a, b) with b the previous point, as the TS loop takes.
fn edges_back(ring: &[Plan]) -> impl Iterator<Item = (Plan, Plan)> + '_ {
    let previous = ring.iter().cycle().skip(ring.len().saturating_sub(1));
    ring.iter().copied().zip(previous.copied())
}

/// Even-odd containment. Points on the boundary may go either way. O(n).
pub fn point_in_ring(point: Plan, ring: &[Plan]) -> bool {
    edges_back(ring).fold(false, |inside, (a, b)| {
        let crosses = (a.z_m > point.z_m) != (b.z_m > point.z_m);
        let left = || point.x_m < ((b.x_m - a.x_m) * (point.z_m - a.z_m)) / (b.z_m - a.z_m) + a.x_m;
        if crosses && left() { !inside } else { inside }
    })
}

fn cross(o: Plan, a: Plan, b: Plan) -> f64 {
    (a.x_m - o.x_m) * (b.z_m - o.z_m) - (a.z_m - o.z_m) * (b.x_m - o.x_m)
}

/// Proper crossing of two segments. Touching endpoints and collinear overlaps do not count.
fn segments_cross(first: [Plan; 2], second: [Plan; 2]) -> bool {
    let ([a, b], [c, d]) = (first, second);
    cross(c, d, a) * cross(c, d, b) < 0.0 && cross(a, b, c) * cross(a, b, d) < 0.0
}

/// Consecutive pairs of a closed ring, each point with the next.
fn edges_forward(ring: &[Plan]) -> impl Iterator<Item = [Plan; 2]> + '_ {
    ring.iter()
        .copied()
        .zip(ring.iter().cycle().skip(1).copied())
        .map(|(a, b)| [a, b])
}

fn centroid(ring: &[Plan]) -> Plan {
    let count = ring.len() as f64;
    Plan {
        x_m: ring.iter().fold(0.0, |sum, point| sum + point.x_m) / count,
        z_m: ring.iter().fold(0.0, |sum, point| sum + point.z_m) / count,
    }
}

/// Interiors intersect: an edge crossing, or one ring's centre inside the other. Rings that
/// only touch along an edge do not overlap. O(n · m).
pub fn rings_overlap(first: &[Plan], second: &[Plan]) -> bool {
    let crossing = edges_forward(first)
        .any(|edge| edges_forward(second).any(|other| segments_cross(edge, other)));
    crossing || point_in_ring(centroid(first), second) || point_in_ring(centroid(second), first)
}

/// An oriented rectangle: centre, width along the street, depth into the block.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Footprint {
    pub center: Plan,
    pub width_m: f64,
    pub depth_m: f64,
    pub rotation_radians: f64,
}

impl Footprint {
    /// Corners in order around the footprint.
    pub fn corners(&self) -> [Plan; 4] {
        let (cos, sin) = (self.rotation_radians.cos(), self.rotation_radians.sin());
        self.corners_on([[cos, -sin], [sin, cos]])
    }

    /// The same corners for a footprint laid along a unit tangent (rotation atan2(−tz, tx)):
    /// width axis the tangent, depth axis (−tz, tx). No trigonometry, so no last-bit
    /// differences with the TypeScript pipeline, whose engine's `cos`/`sin` no library matches.
    pub fn corners_along(&self, tangent: Plan) -> [Plan; 4] {
        let (tx, tz) = (tangent.x_m, tangent.z_m);
        self.corners_on([[tx, tz], [-tz, tx]])
    }

    /// The house this footprint stands for.
    pub fn house(&self, frontage: bool) -> crate::lots::House {
        crate::lots::House {
            center: self.center,
            width_m: self.width_m,
            depth_m: self.depth_m,
            rotation_radians: self.rotation_radians,
            frontage,
        }
    }

    fn corners_on(&self, [width, depth]: [[f64; 2]; 2]) -> [Plan; 4] {
        let (half_width, half_depth) = (self.width_m / 2.0, self.depth_m / 2.0);
        [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]].map(|[along, across]: [f64; 2]| Plan {
            x_m: self.center.x_m + along * half_width * width[0] + across * half_depth * depth[0],
            z_m: self.center.z_m + along * half_width * width[1] + across * half_depth * depth[1],
        })
    }
}

/// Point at fractions of a footprint: `u` along the width (corner 0 to 1), `v` along the depth.
pub fn footprint_point(corners: &[Plan; 4], [u, v]: [f64; 2]) -> Plan {
    let [origin, along_width, _, along_depth] = *corners;
    Plan {
        x_m: origin.x_m + (along_width.x_m - origin.x_m) * u + (along_depth.x_m - origin.x_m) * v,
        z_m: origin.z_m + (along_width.z_m - origin.z_m) * u + (along_depth.z_m - origin.z_m) * v,
    }
}
