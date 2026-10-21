//! `desire.sector-render/1`: what the diorama draws for one map sector, in a typed binary layout
//! a browser Worker can hand to the GPU without parsing. The contract, with the reasons for each
//! choice, is `docs/waterdeep-3d/sector-format.md`; the TypeScript twin is
//! `src/lib/map/sector-format.ts`. Both are tested against one fixture built from the spec.

mod error;
mod format;

pub use error::SectorFormatError;
pub use format::{read_sector, write_sector};

/// One sector: its place in the grid and the features whose point falls inside it.
#[derive(Clone, Debug, PartialEq)]
pub struct Sector {
    /// `row * columns + column` in the sector grid.
    pub index: u32,
    /// North-west corner, map metres.
    pub origin_x_m: f32,
    pub origin_z_m: f32,
    pub size_m: f32,
    pub houses: Vec<House>,
    pub berths: Vec<Berth>,
    pub trees: Vec<Tree>,
}

/// A house lot. Coordinates are absolute map metres; rotation follows the engine
/// (`setFromEulerAngles(0, θ, 0)`).
#[derive(Clone, Debug, PartialEq)]
pub struct House {
    /// Block index × 4096 + lot index: stable for one source raster and pipeline version.
    pub id: u32,
    pub x_m: f32,
    pub z_m: f32,
    pub width_m: f32,
    pub depth_m: f32,
    pub rotation_radians: f32,
    pub height_m: f32,
    pub roof_rgb: [u8; 3],
    /// The house faces a street (it carries the door, and maybe a lantern).
    pub frontage: bool,
}

/// A ship moored alongside a pier; the keel runs along local +Z after the turn.
#[derive(Clone, Debug, PartialEq)]
pub struct Berth {
    pub x_m: f32,
    pub z_m: f32,
    pub heading_radians: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tree {
    pub x_m: f32,
    pub z_m: f32,
    pub scale: f32,
}
