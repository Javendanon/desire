//! House lots inside a city block, ported from `tools/assets/src/lots.ts`: a row along every
//! frontage, then the interior filled on a grid aligned to the block's longest side. Seeded, so a
//! block always gets the same houses. Every lot draws its width, then its depth, from one
//! mulberry32 stream: the draw order is part of the result.

use serde::Deserialize;

use crate::js;
pub use crate::plan::Plan;
use crate::plan::{Footprint, footprint_point, point_in_ring, rings_overlap};
use crate::random::Mulberry32;

/// Half a step back from the block edge, so a house never straddles it.
const SETBACK_M: f64 = 0.3;
/// Search step along a frontage when a lot does not fit.
const SEARCH_STEP_M: f64 = 1.0;
const INTERIOR_GAP_M: f64 = 0.6;
/// Centre plus the four points halfway to each corner. Most must stand on built ground, so a
/// ridge line or an outline under the centre does not reject a house.
const BUILT_SAMPLES: [[f64; 2]; 5] = [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
];
const BUILT_MAJORITY: usize = 3;

pub struct LotRules<'a> {
    /// Street frontage of a house in metres, [min, max].
    pub frontage: [f64; 2],
    /// Depth from the street in metres, [min, max].
    pub depth: [f64; 2],
    pub seed: u32,
    /// False where the source map draws open ground.
    pub is_built: &'a (dyn Fn(Plan) -> bool + Sync),
}

pub struct BlockShape {
    pub outer: Vec<Plan>,
    pub holes: Vec<Vec<Plan>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct House {
    pub center: Plan,
    pub width_m: f64,
    pub depth_m: f64,
    pub rotation_radians: f64,
    pub frontage: bool,
}

/// A placed house with the corners it was placed with, built from its edge tangent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lot {
    pub house: House,
    pub corners: [Plan; 4],
}

/// Where a lot goes: the axis it is laid along, how far along it, and whether it faces a street.
#[derive(Clone, Copy)]
struct Slot {
    axis: Axis,
    along: f64,
    frontage: bool,
}

/// An edge to place lots along: its start, unit tangent, and the normal into the block.
#[derive(Clone, Copy)]
struct Axis {
    origin: Plan,
    tangent: Plan,
    normal: Plan,
}

fn length(from: Plan, to: Plan) -> f64 {
    js::hypot(&[to.x_m - from.x_m, to.z_m - from.z_m])
}

/// The houses placed so far in one block, and what placing more needs.
struct Placement<'a> {
    block: &'a BlockShape,
    rules: &'a LotRules<'a>,
    lots: Vec<Lot>,
    random: Mulberry32,
}

impl Placement<'_> {
    fn on_built_ground(&self, corners: &[Plan; 4]) -> bool {
        let built = BUILT_SAMPLES
            .iter()
            .filter(|&&sample| (self.rules.is_built)(footprint_point(corners, sample)))
            .count();
        built >= BUILT_MAJORITY
    }

    fn fits(&self, corners: &[Plan; 4]) -> bool {
        let inside = corners
            .iter()
            .all(|&corner| point_in_ring(corner, &self.block.outer));
        inside
            && !self
                .block
                .holes
                .iter()
                .any(|hole| rings_overlap(corners, hole))
            && self.on_built_ground(corners)
            && !self
                .lots
                .iter()
                .any(|other| rings_overlap(corners, &other.corners))
    }

    fn try_place(&mut self, lot: Lot) -> bool {
        if !self.fits(&lot.corners) {
            return false;
        }
        self.lots.push(lot);
        true
    }

    /// Unit tangent of an edge and the normal that points into the block.
    fn edge_axis(&self, from: Plan, to: Plan) -> Option<Axis> {
        let span = length(from, to);
        if span == 0.0 {
            return None;
        }
        let tangent = Plan {
            x_m: (to.x_m - from.x_m) / span,
            z_m: (to.z_m - from.z_m) / span,
        };
        let normal = self.inward_normal(from.offset(tangent, span / 2.0), tangent);
        Some(Axis {
            origin: from,
            tangent,
            normal,
        })
    }

    /// The edge normal on the block's side: the left one when a point just left of the edge's
    /// middle lies in the block, else the right one.
    fn inward_normal(&self, middle: Plan, tangent: Plan) -> Plan {
        let left = Plan {
            x_m: -tangent.z_m,
            z_m: tangent.x_m,
        };
        if point_in_ring(middle.offset(left, SETBACK_M), &self.block.outer) {
            left
        } else {
            Plan {
                x_m: -left.x_m,
                z_m: -left.z_m,
            }
        }
    }

    /// A lot of random size at `along` metres on the axis, set back from it.
    fn lot_at(&mut self, slot: Slot) -> Lot {
        let Slot {
            axis,
            along,
            frontage,
        } = slot;
        let width = self.random.between(self.rules.frontage);
        let depth = self.random.between(self.rules.depth);
        let front = axis.origin.offset(axis.tangent, along + width / 2.0);
        let footprint = Footprint {
            center: front.offset(axis.normal, SETBACK_M + depth / 2.0),
            width_m: width,
            depth_m: depth,
            rotation_radians: (-axis.tangent.z_m).atan2(axis.tangent.x_m),
        };
        Lot {
            house: footprint.house(frontage),
            corners: footprint.corners_along(axis.tangent),
        }
    }

    /// One row of houses along an edge, searching forward when a lot does not fit. O(length).
    fn line_frontage(&mut self, from: Plan, to: Plan) {
        let Some(axis) = self.edge_axis(from, to) else {
            return;
        };
        let span = length(from, to);
        let mut along = 0.0;
        while along + self.rules.frontage[0] <= span {
            let lot = self.lot_at(Slot {
                axis,
                along,
                frontage: true,
            });
            let placed = along + lot.house.width_m <= span && self.try_place(lot);
            along += if placed {
                lot.house.width_m
            } else {
                SEARCH_STEP_M
            };
        }
    }

    /// The block's extent along the axis and across it, from the axis origin: the grid the
    /// interior lots are laid on.
    fn interior_extent(&self, axis: &Axis) -> [[f64; 2]; 2] {
        let from = axis.origin;
        let project = |point: &Plan, direction: Plan| {
            (point.x_m - from.x_m) * direction.x_m + (point.z_m - from.z_m) * direction.z_m
        };
        let outer = &self.block.outer;
        [
            extent(outer.iter().map(|p| project(p, axis.tangent))),
            extent(outer.iter().map(|p| project(p, axis.normal))),
        ]
    }

    /// Grid over the block aligned to its longest side. O(cells · houses).
    fn fill_interior(&mut self) {
        let [from, to] = longest_edge(&self.block.outer);
        let Some(axis) = self.edge_axis(from, to) else {
            return;
        };
        let [alongs, depths] = self.interior_extent(&axis);
        let step_along = self.rules.frontage[1] + INTERIOR_GAP_M;
        let step_depth = self.rules.depth[1] + INTERIOR_GAP_M;
        let mut depth = depths[0];
        while depth < depths[1] {
            let row = Axis {
                origin: from.offset(axis.normal, depth),
                ..axis
            };
            let mut along = alongs[0];
            while along < alongs[1] {
                let lot = self.lot_at(Slot {
                    axis: row,
                    along,
                    frontage: false,
                });
                self.try_place(lot);
                along += step_along;
            }
            depth += step_depth;
        }
    }
}

/// Minimum and maximum of a sequence of numbers.
fn extent(values: impl Iterator<Item = f64>) -> [f64; 2] {
    values.fold([f64::INFINITY, f64::NEG_INFINITY], |[min, max], value| {
        [min.min(value), max.max(value)]
    })
}

/// The first longest edge of a closed ring.
fn longest_edge(ring: &[Plan]) -> [Plan; 2] {
    let mut best = ([ring[0], ring[1]], 0.0);
    for (index, &point) in ring.iter().enumerate() {
        let next = ring[(index + 1) % ring.len()];
        let span = length(point, next);
        if span > best.1 {
            best = ([point, next], span);
        }
    }
    best.0
}

/// Houses for one block: frontage rows first, then the interior.
pub fn place_houses(block: &BlockShape, rules: &LotRules) -> Vec<Lot> {
    let mut placement = Placement {
        block,
        rules,
        lots: Vec::new(),
        random: Mulberry32::new(rules.seed),
    };
    let ring = &block.outer;
    for (index, &point) in ring.iter().enumerate() {
        placement.line_frontage(point, ring[(index + 1) % ring.len()]);
    }
    placement.fill_interior();
    placement.lots
}
