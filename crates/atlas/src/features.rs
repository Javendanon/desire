//! Point features read from the surface classes, ported from `tools/assets/src/features.ts`:
//! berths where ships moor alongside piers, and trees in gardens. Pixel coordinates. Decisions
//! use no trigonometry. The heading's `atan2` is written for the viewer only.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::js;
use crate::random::Mulberry32;
use crate::raster_ops::Size;
use crate::spatial::{Bounds, SpatialGrid};
use crate::surface::Surface;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
pub struct Berth {
    pub x_px: f64,
    pub y_px: f64,
    /// Keel direction for a rotation about +Y: local +Z maps to (sin θ, cos θ) in plan.
    pub heading_radians: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
pub struct Tree {
    pub x_px: f64,
    pub y_px: f64,
    pub scale: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipSpec {
    pub length_px: f64,
    pub beam_px: f64,
    pub spacing_px: f64,
    pub seed: u32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSpec {
    pub spacing_px: f64,
    pub seed: u32,
}

impl ShipSpec {
    /// A caravel at z18: about 22 m long and 6.5 m in the beam, 26 m between moored bows.
    pub fn caravel_z18(seed: u32) -> Self {
        ShipSpec {
            length_px: 48.0,
            beam_px: 14.0,
            spacing_px: 56.0,
            seed,
        }
    }
}

impl TreeSpec {
    /// One tree per 12 px (about 5.6 m) square of garden at most.
    pub fn orchard_z18(seed: u32) -> Self {
        TreeSpec {
            spacing_px: 12.0,
            seed,
        }
    }
}

const NEIGHBOURS: [[f64; 2]; 4] = [[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0]];
/// Radius of the window that estimates a pier edge's outward normal.
const NORMAL_RADIUS_PX: i32 = 6;
/// Gap between the pier edge and the hull.
const FENDER_PX: f64 = 1.0;
const HULL_STEP_PX: f64 = 2.0;
/// Share of the hull's length that must lie alongside the pier.
const ALONGSIDE_SHARE: f64 = 0.5;
/// Hulls further apart across the keel than this many beams never clash.
const ABREAST_BEAMS: f64 = 1.5;
const TREE_SCALE: [f64; 2] = [0.8, 1.3];

/// A moored hull: its centre, and the unit vector from the pier toward it.
#[derive(Clone, Copy)]
struct Hull {
    x: f64,
    y: f64,
    out: [f64; 2],
}

/// The class raster the features are read from.
struct Grid<'a> {
    classes: &'a [u8],
    size: Size,
}

impl Grid<'_> {
    /// The class under a point, or `None` off the raster.
    fn surface_at(&self, x: f64, y: f64) -> Option<u8> {
        let (column, row) = (x.floor(), y.floor());
        let inside = column >= 0.0 && row >= 0.0;
        let inside =
            inside && (column as usize) < self.size.width && (row as usize) < self.size.height;
        inside.then(|| self.classes[row as usize * self.size.width + column as usize])
    }

    fn is(&self, point: [f64; 2], surface: Surface) -> bool {
        self.surface_at(point[0], point[1]) == Some(surface as u8)
    }

    /// Outward normal of the pier edge at (x, y): the mean offset of the water around it.
    fn edge_normal(&self, x: f64, y: f64) -> Option<[f64; 2]> {
        let r = NORMAL_RADIUS_PX;
        let offsets = (-r..=r).flat_map(|dy| (-r..=r).map(move |dx| (dx, dy)));
        let wet = offsets.filter(|&(dx, dy)| {
            let near = dx * dx + dy * dy <= r * r;
            near && self.is([x + f64::from(dx), y + f64::from(dy)], Surface::Water)
        });
        let (nx, ny) = wet.fold((0.0, 0.0), |(nx, ny), (dx, dy)| {
            (nx + f64::from(dx), ny + f64::from(dy))
        });
        let length = js::hypot(&[nx, ny]);
        (length > 0.0).then(|| [nx / length, ny / length])
    }

    /// The hull moored off the pier edge pixel at `index`, if that pixel touches water.
    fn hull_at(&self, index: usize, ship: &ShipSpec) -> Option<Hull> {
        let x = (index % self.size.width) as f64 + 0.5;
        let y = (index / self.size.width) as f64 + 0.5;
        let wet = NEIGHBOURS
            .iter()
            .any(|[dx, dy]| self.is([x + dx, y + dy], Surface::Water));
        let out = wet.then(|| self.edge_normal(x, y)).flatten()?;
        let offset = ship.beam_px / 2.0 + FENDER_PX;
        Some(Hull {
            x: x + out[0] * offset,
            y: y + out[1] * offset,
            out,
        })
    }

    /// The whole hull on water, and the pier along at least half of its pierside flank.
    fn mooring_fits(&self, hull: &Hull, ship: &ShipSpec) -> bool {
        let [ox, oy] = hull.out;
        let half = ship.beam_px / 2.0;
        let at = |t: f64, s: f64| [hull.x + -oy * t + ox * s, hull.y + ox * t + oy * s];
        let keel = keel_samples(ship.length_px);
        let afloat = keel.iter().all(|&t| {
            [-half, 0.0, half]
                .iter()
                .all(|&s| self.is(at(t, s), Surface::Water))
        });
        let flank = -(half + FENDER_PX + 1.0);
        let alongside = keel
            .iter()
            .filter(|&&t| self.is(at(t, flank), Surface::Pier))
            .count();
        afloat && alongside as f64 >= keel.len() as f64 * ALONGSIDE_SHARE
    }
}

/// Samples along the keel, from bow to stern, inclusive.
fn keel_samples(length_px: f64) -> Vec<f64> {
    let mut samples = Vec::new();
    let mut t = -length_px / 2.0;
    while t < length_px / 2.0 {
        samples.push(t);
        t += HULL_STEP_PX;
    }
    samples.push(length_px / 2.0);
    samples
}

/// Two moored hulls clash when they are both within the spacing along the keel and abreast.
fn clashes(hull: &Hull, other: &Hull, ship: &ShipSpec) -> bool {
    let [ox, oy] = other.out;
    let (dx, dy) = (hull.x - other.x, hull.y - other.y);
    let along = (dx * -oy + dy * ox).abs();
    let across = (dx * ox + dy * oy).abs();
    along < ship.spacing_px && across < ship.beam_px * ABREAST_BEAMS
}

/// Fisher–Yates from the end, as the TypeScript shuffle draws.
fn shuffle<T>(items: &mut [T], random: &mut Mulberry32) {
    for index in (1..items.len()).rev() {
        let other = (random.next_f64() * (index + 1) as f64).floor() as usize;
        items.swap(index, other);
    }
}

/// Every hull that fits off a pier edge pixel, in pixel order (found in parallel).
fn moorings(grid: &Grid, ship: &ShipSpec) -> Vec<Hull> {
    (0..grid.classes.len())
        .into_par_iter()
        .filter(|&index| grid.classes[index] == Surface::Pier as u8)
        .filter_map(|index| grid.hull_at(index, ship))
        .filter(|hull| grid.mooring_fits(hull, ship))
        .collect()
}

/// Greedy choice in a seeded shuffle: a hull is kept unless it clashes with one already kept.
/// No hull clashes with one farther than this: the corner of the keel-by-abreast rectangle.
fn clash_reach(ship: &ShipSpec) -> f64 {
    ship.spacing_px.hypot(ship.beam_px * ABREAST_BEAMS)
}

/// Keeps hulls in shuffled order unless one already kept clashes. Kept hulls sit in a grid one
/// clash reach wide, so each is tested against its neighbours only. O(hulls · neighbours).
fn spaced(mut fits: Vec<Hull>, ship: &ShipSpec, random: &mut Mulberry32) -> Vec<Hull> {
    shuffle(&mut fits, random);
    let reach = clash_reach(ship);
    let mut grid = SpatialGrid::new(reach);
    let mut chosen: Vec<Hull> = Vec::new();
    for hull in fits {
        let around = Bounds {
            min: [hull.x - reach, hull.y - reach],
            max: [hull.x + reach, hull.y + reach],
        };
        if !grid
            .near(&around)
            .any(|other| clashes(&hull, &chosen[other], ship))
        {
            grid.insert(&Bounds::around([[hull.x, hull.y]]), chosen.len());
            chosen.push(hull);
        }
    }
    chosen
}

/// Ships alongside pier edges, spaced along the keel. Each moors bow either way, at random.
/// O(pier edge · hull samples).
pub fn find_berths(classes: &[u8], size: Size, ship: &ShipSpec) -> Vec<Berth> {
    let mut random = Mulberry32::new(ship.seed);
    let chosen = spaced(moorings(&Grid { classes, size }, ship), ship, &mut random);
    let turn = |flip: bool| if flip { std::f64::consts::PI } else { 0.0 };
    chosen
        .iter()
        .map(|hull| Berth {
            x_px: hull.x,
            y_px: hull.y,
            heading_radians: (-hull.out[1]).atan2(hull.out[0]) + turn(random.next_f64() < 0.5),
        })
        .collect()
}

/// One tree per jittered grid cell whose random point falls on a garden. O(pixels / spacing²).
pub fn plant_trees(classes: &[u8], size: Size, spec: &TreeSpec) -> Vec<Tree> {
    let grid = Grid { classes, size };
    let mut random = Mulberry32::new(spec.seed);
    let mut trees = Vec::new();
    let mut top = 0.0;
    while top < size.height as f64 {
        let mut left = 0.0;
        while left < size.width as f64 {
            let x = left + random.next_f64() * spec.spacing_px;
            let y = top + random.next_f64() * spec.spacing_px;
            let scale = random.between(TREE_SCALE);
            if grid.is([x, y], Surface::Garden) {
                trees.push(Tree {
                    x_px: x,
                    y_px: y,
                    scale,
                });
            }
            left += spec.spacing_px;
        }
        top += spec.spacing_px;
    }
    trees
}
