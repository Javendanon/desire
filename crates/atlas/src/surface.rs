//! Per-pixel surface classes for an illustrated city raster, ported from
//! `tools/assets/src/raster/surface.ts`. Thresholds were measured on the label-free Tych Maps
//! Waterdeep raster (9 × 9 pixel means at known points). Water is the only surface where green
//! clearly dominates red while blue stays near red. Vegetation is also green but has far less
//! blue. Parity with the TypeScript rules is checked over every 24-bit colour.

use rayon::prelude::*;

/// Surface class ids, shared with the TypeScript pipeline and the class raster files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Surface {
    Ground = 0,
    Water = 1,
    Roof = 2,
    Street = 3,
    Outline = 4,
    RedRoof = 5,
    Pier = 6,
    Garden = 7,
}

impl Surface {
    pub const ALL: [Surface; 8] = [
        Surface::Ground,
        Surface::Water,
        Surface::Roof,
        Surface::Street,
        Surface::Outline,
        Surface::RedRoof,
        Surface::Pier,
        Surface::Garden,
    ];

    /// The name the TypeScript `Surface` object uses.
    pub fn name(self) -> &'static str {
        match self {
            Surface::Ground => "Ground",
            Surface::Water => "Water",
            Surface::Roof => "Roof",
            Surface::Street => "Street",
            Surface::Outline => "Outline",
            Surface::RedRoof => "RedRoof",
            Surface::Pier => "Pier",
            Surface::Garden => "Garden",
        }
    }
}

const OUTLINE_MAX_CHANNEL: i32 = 50;
const WATER_GREEN_OVER_RED: i32 = 8;
const WATER_BLUE_BELOW_RED: i32 = 12;
const RED_ROOF_RED_OVER_GREEN: i32 = 35;
const RED_ROOF_RED_OVER_BLUE: i32 = 45;
const ROOF_RED_OVER_BLUE: i32 = 18;
const ROOF_RED_OVER_GREEN: i32 = 4;
const ROOF_MAX_CHANNEL: i32 = 125;
const STREET_MAX_SATURATION: i32 = 22;
/// Yellow courtyards (North Ward): warm and bright, blue well below green.
const GARDEN_MIN_RED: i32 = 140;
const GARDEN_MIN_GREEN: i32 = 130;
const GARDEN_BLUE_BELOW_GREEN: i32 = 35;
const STREET_MIN_CHANNEL: i32 = 100;
const RGB: usize = 3;

/// Ordered rules: the first match wins, anything else is ground.
pub fn classify_pixel(r: u8, g: u8, b: u8) -> Surface {
    let (r, g, b) = (i32::from(r), i32::from(g), i32::from(b));
    let max = r.max(g).max(b);
    let saturation = max - r.min(g).min(b);
    if max < OUTLINE_MAX_CHANNEL {
        Surface::Outline
    } else if g > r + WATER_GREEN_OVER_RED && b >= r - WATER_BLUE_BELOW_RED {
        Surface::Water
    } else if r > g + RED_ROOF_RED_OVER_GREEN && r > b + RED_ROOF_RED_OVER_BLUE {
        Surface::RedRoof
    } else if r > b + ROOF_RED_OVER_BLUE && r > g + ROOF_RED_OVER_GREEN && max < ROOF_MAX_CHANNEL {
        Surface::Roof
    } else if r > GARDEN_MIN_RED && g > GARDEN_MIN_GREEN && b < g - GARDEN_BLUE_BELOW_GREEN {
        Surface::Garden
    } else if saturation < STREET_MAX_SATURATION && max > STREET_MIN_CHANNEL {
        Surface::Street
    } else {
        Surface::Ground
    }
}

/// The class of every 24-bit colour, indexed by `r << 16 | g << 8 | b`. 16 MiB, built in
/// parallel: the rules then run once per colour rather than once per pixel.
fn colour_table() -> Vec<u8> {
    (0..1u32 << 24)
        .into_par_iter()
        .map(|colour| {
            let [_, r, g, b] = colour.to_be_bytes();
            classify_pixel(r, g, b) as u8
        })
        .collect()
}

/// Classifies a row-major RGB buffer, one class id per pixel. O(pixels), in parallel.
///
/// # Panics
/// When the buffer length is not a multiple of three.
pub fn classify_rgb(rgb: &[u8]) -> Vec<u8> {
    assert!(
        rgb.len().is_multiple_of(RGB),
        "classify_rgb needs 3 bytes per pixel, got {} bytes",
        rgb.len()
    );
    let table = colour_table();
    rgb.par_chunks_exact(RGB)
        .map(|pixel| {
            let colour = (usize::from(pixel[0]) << 16) | (usize::from(pixel[1]) << 8);
            table[colour | usize::from(pixel[2])]
        })
        .collect()
}
