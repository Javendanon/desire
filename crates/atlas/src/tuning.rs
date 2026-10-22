//! The tuning of the z18 Waterdeep map: fallback street widths, which traced shapes count as
//! blocks, and the ground tile grid. Values measured on the map, kept apart from the command
//! line so both read as what they are.

use crate::blocks::TraceOptions;
use crate::vectors::StreetPolicy;

/// The street policy of the z18 map: fallback widths by street type, and measured bounds.
pub fn street_policy() -> StreetPolicy {
    let fallback = [("Main", 40.0), ("Major", 30.0), ("Minor", 20.0)];
    StreetPolicy {
        fallback_px: fallback.map(|(kind, px)| (kind.to_owned(), px)).into(),
        default_px: 20.0,
        min_px: 6.0,
        max_px: 90.0,
    }
}

/// Blocks smaller than about 10 m² are noise, open holes under about 45 m² are misread roof
/// patches, and outlines are simplified to about 0.7 m (under a wall's thickness).
pub const BLOCK_TRACE: TraceOptions = TraceOptions {
    min_area_px: 45,
    tolerance_px: 1.5,
    min_hole_area_px: 200.0,
};

/// Ground tiles match the sector grid: 1024 px, cells of 4 px (about 1.9 m at z18).
pub const TILE_PX: usize = 1024;
pub const CELL_PX: usize = 4;
/// Box-blur passes over the height field, so shores slope instead of stepping.
pub const SMOOTH_PASSES: usize = 2;
pub const JPEG_QUALITY: u8 = 85;
