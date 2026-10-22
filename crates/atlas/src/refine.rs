//! Turns raw per-pixel classes into surfaces, ported from `tools/assets/src/raster/refine.ts`:
//! open water only, streets forced from vector centrelines, squares told from pale roof facets,
//! piers told from roofs. Order: speckle filter, open water, squares, land, streets, piers.

use rayon::prelude::*;
use serde::Deserialize;

use crate::raster_ops::{Size, components, dilate, erode, majority, neighbours4};
use crate::surface::Surface;
use crate::vectors::{Polyline, paint_polylines};

/// The raster to refine and the vector layers that guide it.
pub struct RefineInput<'a> {
    pub classes: &'a [u8],
    pub size: Size,
    pub streets: &'a [Polyline],
    /// 1 inside the city. Outside it, roof browns are fields and terrain. `None`: all urban.
    pub urban: Option<&'a [u8]>,
}

/// Tuning, in source pixels. The defaults are the TypeScript pipeline's for the z18 map.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RefineParams {
    pub majority_radius: usize,
    /// Water components smaller than this share of the sea are puddles, forests and parks.
    pub min_water_share_of_sea: f64,
    /// Street-coloured areas off the centrelines are squares only when at least this large
    /// (about 180 m² at z18) and touching the painted streets.
    pub min_square_px: usize,
    /// Land narrower than twice this radius is a pier candidate (morphological opening).
    pub pier_radius: usize,
    /// Drawn outlines ring every pier: water is dilated by this much to bridge them.
    pub pier_gap_pixels: usize,
    /// A candidate is a pier when more than this share of its border is near water.
    pub pier_wet_share: f64,
}

impl Default for RefineParams {
    fn default() -> Self {
        RefineParams {
            majority_radius: 2,
            min_water_share_of_sea: 0.05,
            min_square_px: 800,
            pier_radius: 20,
            pier_gap_pixels: 3,
            pier_wet_share: 0.4,
        }
    }
}

/// A roof patch bordered mostly by water or pier is a pier junction, not a building. Measured
/// on Dock Ward: the cross-pier junction scores 0.77, the most exposed coastal block 0.44.
const PIER_JUNCTION_SHARE: f64 = 0.6;

fn mask_where(values: &[u8], test: impl Fn(u8) -> bool + Sync) -> Vec<u8> {
    values
        .par_iter()
        .map(|&value| u8::from(test(value)))
        .collect()
}

fn is(surface: Surface) -> impl Fn(u8) -> bool + Sync {
    move |value| value == surface as u8
}

/// The sea and water bodies comparable to it. O(pixels).
fn open_water(classes: &[u8], size: Size, min_share: f64) -> Vec<u8> {
    let found = components(&mask_where(classes, is(Surface::Water)), size);
    let sea = found.sizes.iter().copied().max().unwrap_or(0);
    let minimum = min_share * sea as f64;
    let open: Vec<bool> = found
        .sizes
        .iter()
        .map(|&count| count as f64 >= minimum)
        .collect();
    found
        .labels
        .par_iter()
        .map(|&label| u8::from(label >= 0 && open[label as usize]))
        .collect()
}

/// What decides one pixel's surface once water and streets are known.
struct Settling {
    class: u8,
    water: bool,
    street: bool,
    urban: bool,
}

impl Settling {
    fn was(&self, surface: Surface) -> bool {
        self.class == surface as u8
    }
}

/// One settling rule: when it applies, the surface it gives.
type SettleRule = (fn(&Settling) -> bool, Surface);

/// Ordered rules, first match wins, otherwise the class stays: open water stays, street
/// centrelines win over land, green that is not open water is a garden in the city and
/// terrain outside, and roof browns outside the city are terrain.
const SETTLE: [SettleRule; 5] = [
    (|p| p.water, Surface::Water),
    (|p| p.street, Surface::Street),
    (|p| p.was(Surface::Water) && p.urban, Surface::Garden),
    (|p| p.was(Surface::Water), Surface::Ground),
    (
        |p| !p.urban && (p.was(Surface::Roof) || p.was(Surface::RedRoof)),
        Surface::Ground,
    ),
];

fn settle(pixel: &Settling) -> u8 {
    SETTLE
        .iter()
        .find(|(applies, _)| applies(pixel))
        .map_or(pixel.class, |&(_, surface)| surface as u8)
}

/// Share of each component's border that touches `near`. O(pixels).
fn wet_shares(candidates: &[u8], size: Size, near: &[u8]) -> WetComponents {
    let found = components(candidates, size);
    let mut border = vec![0.0f64; found.sizes.len()];
    let mut wet = vec![0.0f64; found.sizes.len()];
    let labelled = found
        .labels
        .iter()
        .enumerate()
        .filter(|&(_, &label)| label >= 0);
    for (index, &label) in labelled {
        for next in neighbours4(index, size).filter(|&next| found.labels[next] != label) {
            border[label as usize] += 1.0;
            wet[label as usize] += f64::from(near[next]);
        }
    }
    let shares = border
        .iter()
        .zip(&wet)
        .map(|(&count, &touching)| if count > 0.0 { touching / count } else { 0.0 })
        .collect();
    WetComponents {
        labels: found.labels,
        shares,
    }
}

/// Components with the share of their border that lies near water.
struct WetComponents {
    labels: Vec<i32>,
    shares: Vec<f64>,
}

/// The classes being refined, with the size and tuning every stage reads.
struct Refinery<'a> {
    classes: Vec<u8>,
    size: Size,
    params: &'a RefineParams,
}

impl Refinery<'_> {
    /// Street colour away from the centrelines: keeps squares, demotes roof facets to ground.
    fn keep_squares(&mut self, painted: &[u8]) {
        let found = components(&mask_where(&self.classes, is(Surface::Street)), self.size);
        let reach = dilate(painted, self.size, 1);
        let mut touching = vec![false; found.sizes.len()];
        for (&label, _) in found
            .labels
            .iter()
            .zip(&reach)
            .filter(|&(&l, &r)| l >= 0 && r == 1)
        {
            touching[label as usize] = true;
        }
        let min_square = self.params.min_square_px;
        let facet = |label: usize| !touching[label] || found.sizes[label] < min_square;
        let labels = found.labels.par_iter();
        self.classes
            .par_iter_mut()
            .zip(labels)
            .for_each(|(class, &label)| {
                if label >= 0 && facet(label as usize) {
                    *class = Surface::Ground as u8;
                }
            });
    }

    /// Marks as pier every pixel of a component whose wet share passes the threshold.
    fn mark_wet(&mut self, wet: &WetComponents, threshold: f64) {
        let labels = wet.labels.par_iter();
        self.classes
            .par_iter_mut()
            .zip(labels)
            .for_each(|(class, &label)| {
                if label >= 0 && wet.shares[label as usize] > threshold {
                    *class = Surface::Pier as u8;
                }
            });
    }

    /// Narrow land (removed by a morphological opening) of roof, outline or ground colour.
    fn pier_candidates(&self, water: &[u8]) -> Vec<u8> {
        let radius = self.params.pier_radius;
        let land = mask_where(water, |value| value == 0);
        let opened = dilate(&erode(&land, self.size, radius), self.size, radius);
        let sources = [Surface::Roof, Surface::Outline, Surface::Ground].map(|s| s as u8);
        (0..self.classes.len())
            .into_par_iter()
            .map(|index| {
                let narrow = land[index] == 1 && opened[index] == 0;
                u8::from(narrow && sources.contains(&self.classes[index]))
            })
            .collect()
    }

    /// Piers: candidates bordered mostly by water. Then the wide junctions, roof patches ringed
    /// by water and pier.
    fn mark_piers(&mut self, water: &[u8]) {
        let gap = self.params.pier_gap_pixels;
        let near = dilate(water, self.size, gap);
        let piers = wet_shares(&self.pier_candidates(water), self.size, &near);
        self.mark_wet(&piers, self.params.pier_wet_share);
        let wet_or_pier: Vec<u8> = water
            .par_iter()
            .zip(&self.classes)
            .map(|(&wet, &class)| u8::from(wet == 1 || class == Surface::Pier as u8))
            .collect();
        let near = dilate(&wet_or_pier, self.size, gap);
        let roofs = mask_where(&self.classes, is(Surface::Roof));
        self.mark_wet(&wet_shares(&roofs, self.size, &near), PIER_JUNCTION_SHARE);
    }
}

/// Refines raw classes into surfaces. O(pixels · (majority radius + 1)).
pub fn refine_surfaces(input: &RefineInput, params: &RefineParams) -> Vec<u8> {
    let size = input.size;
    let classes = majority(input.classes, size, params.majority_radius);
    let water = open_water(&classes, size, params.min_water_share_of_sea);
    let mut streets = vec![0; classes.len()];
    paint_polylines(&mut streets, size, input.streets);
    let mut refinery = Refinery {
        classes,
        size,
        params,
    };
    refinery.keep_squares(&streets);
    refinery
        .classes
        .par_iter_mut()
        .enumerate()
        .for_each(|(index, class)| {
            *class = settle(&Settling {
                class: *class,
                water: water[index] == 1,
                street: streets[index] == 1,
                urban: input.urban.is_none_or(|urban| urban[index] == 1),
            });
        });
    refinery.mark_piers(&water);
    refinery.classes
}
