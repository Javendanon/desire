//! Houses for the traced blocks of a region, ported from `tools/assets/generate-houses.ts`.
//! Houses stand only where the source map draws roofs, take their roof colour from the raster
//! underneath and a height within the given range. Blocks are independent, so they are filled
//! in parallel; the output keeps block order, which numbers the house ids.

use rayon::prelude::*;
use serde::Deserialize;

use crate::js;
use crate::lots::{BlockShape, House, Lot, LotRules, Plan, place_houses};
use crate::plan::footprint_point;
use crate::random::Mulberry32;
use crate::raster_ops::Size;
use crate::simplify::simplify_ring;
use crate::surface::Surface;

/// Tych scale: narrow medieval frontages, deeper plots.
const FRONTAGE_M: [f64; 2] = [4.5, 8.5];
const DEPTH_M: [f64; 2] = [6.5, 11.0];
const SEED_BASE: u32 = 0x5eed;
/// Lots are laid out along a block outline simplified to ~2.5 m: traced outlines follow every
/// building corner, and sides shorter than one frontage would get no houses.
const LOT_OUTLINE_TOLERANCE_M: f64 = 2.5;
/// Lots per block that fit in the house id (the largest Waterdeep block holds 1,412).
const LOTS_PER_BLOCK: usize = 4096;

/// One block of `blocks.json`, in map metres.
#[derive(Deserialize)]
pub struct BlockJson {
    pub id: u32,
    pub outer: Vec<[f64; 2]>,
    pub holes: Vec<Vec<[f64; 2]>>,
}

#[derive(Deserialize)]
pub struct BlocksLayer {
    pub metres_per_pixel: f64,
    pub blocks: Vec<BlockJson>,
}

/// The source raster the houses read: classes for built ground, colours for roofs.
pub struct HouseRaster<'a> {
    pub rgb: &'a [u8],
    pub classes: &'a [u8],
    pub size: Size,
    pub metres_per_pixel: f64,
}

/// A placed house with what the map says about it.
pub struct MapHouse {
    pub house: House,
    pub height_m: f64,
    pub roof_rgb: [u8; 3],
    pub block: u32,
    pub id: u32,
}

/// Generation settings: the region of interest in source pixels and the eave height range.
pub struct HouseSpec {
    pub region: [f64; 4],
    pub heights: [f64; 2],
}

impl HouseRaster<'_> {
    fn pixel_of(&self, point: Plan) -> Option<usize> {
        let x = js::round(point.x_m / self.metres_per_pixel);
        let y = js::round(point.z_m / self.metres_per_pixel);
        let inside = x >= 0.0 && y >= 0.0;
        let inside = inside && (x as usize) < self.size.width && (y as usize) < self.size.height;
        inside.then(|| y as usize * self.size.width + x as usize)
    }

    fn is_built(&self, point: Plan) -> bool {
        let built = [Surface::Roof, Surface::RedRoof, Surface::Outline].map(|s| s as u8);
        self.pixel_of(point)
            .is_some_and(|pixel| built.contains(&self.classes[pixel]))
    }

    /// Mean raster colour over a 3 × 3 grid inside the lot, from the corners it was placed with.
    fn roof_colour(&self, corners: &[Plan; 4]) -> [u8; 3] {
        let samples = (0..9).filter_map(|index| {
            let (u, v) = (
                f64::from(index % 3 + 1) / 4.0,
                f64::from(index / 3 + 1) / 4.0,
            );
            self.pixel_of(footprint_point(corners, [u, v]))
        });
        let (total, count) = samples.fold(([0u32; 3], 0u32), |(mut total, count), pixel| {
            (0..3).for_each(|c| total[c] += u32::from(self.rgb[pixel * 3 + c]));
            (total, count + 1)
        });
        total.map(|sum| js::round(f64::from(sum) / f64::from(count.max(1))) as u8)
    }

    fn in_region(&self, region: [f64; 4], point: Plan) -> bool {
        let [left, top, width, height] = region;
        let (x, y) = (
            point.x_m / self.metres_per_pixel,
            point.z_m / self.metres_per_pixel,
        );
        x >= left && y >= top && x < left + width && y < top + height
    }
}

fn lot_ring(ring: &[[f64; 2]]) -> Vec<Plan> {
    let simplified = simplify_ring(ring, LOT_OUTLINE_TOLERANCE_M);
    simplified
        .into_iter()
        .map(|[x_m, z_m]| Plan { x_m, z_m })
        .collect()
}

/// The block's outline and holes, simplified for laying out lots.
fn block_shape(block: &BlockJson) -> BlockShape {
    BlockShape {
        outer: lot_ring(&block.outer),
        holes: block.holes.iter().map(|hole| lot_ring(hole)).collect(),
    }
}

/// Block × 4096 + lot. Refused when the lot passes its block's share or the id passes 32 bits,
/// so ids never wrap into another house's.
pub fn house_id(block: u32, lot: usize) -> Result<u32, String> {
    if lot >= LOTS_PER_BLOCK {
        return Err(format!(
            "block {block}: lot {lot} does not fit the house id"
        ));
    }
    block
        .checked_mul(LOTS_PER_BLOCK as u32)
        .and_then(|base| base.checked_add(lot as u32))
        .ok_or_else(|| format!("block {block} does not fit a 32-bit house id"))
}

/// The houses of one block, numbered by their lot's place in the block (before any filter).
fn houses_of(
    raster: &HouseRaster,
    block: &BlockJson,
    heights: [f64; 2],
) -> Result<Vec<MapHouse>, String> {
    let is_built = |point: Plan| raster.is_built(point);
    let rules = LotRules {
        frontage: FRONTAGE_M,
        depth: DEPTH_M,
        seed: SEED_BASE.wrapping_add(block.id),
        is_built: &is_built,
    };
    let lots = place_houses(&block_shape(block), &rules);
    let mut random = Mulberry32::new(SEED_BASE ^ block.id);
    lots.into_iter()
        .enumerate()
        .map(|(index, Lot { house, corners })| {
            Ok(MapHouse {
                height_m: js::round(random.between(heights) * 10.0) / 10.0,
                roof_rgb: raster.roof_colour(&corners),
                block: block.id,
                id: house_id(block.id, index)?,
                house,
            })
        })
        .collect()
}

/// Houses of every block touching the region, kept when their centre is inside it.
/// O(blocks · lots · neighbouring lots), blocks in parallel. Fails when an id would not fit.
pub fn generate_houses(
    raster: &HouseRaster,
    layer: &BlocksLayer,
    spec: &HouseSpec,
) -> Result<Vec<MapHouse>, String> {
    let inside = |[x_m, z_m]: [f64; 2]| raster.in_region(spec.region, Plan { x_m, z_m });
    let per_block: Vec<Vec<MapHouse>> = layer
        .blocks
        .par_iter()
        .filter(|block| block.outer.iter().any(|&point| inside(point)))
        .map(|block| houses_of(raster, block, spec.heights))
        .collect::<Result<_, _>>()?;
    Ok(per_block
        .into_iter()
        .flatten()
        .filter(|house| raster.in_region(spec.region, house.house.center))
        .collect())
}
