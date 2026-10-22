//! The offline map pipeline in Rust: the stages of `tools/assets` (classify, refine, blocks,
//! lots, features, sectors), ported one at a time with a parity check against the TypeScript
//! version on the same input. Plan: `docs/waterdeep-3d/rust-chunk-pipeline.md` (M2).

pub mod blocks;
pub mod features;
pub mod ground;
pub mod houses;
pub mod js;
pub mod layers;
pub mod lots;
pub mod palette;
pub mod plan;
pub mod random;
pub mod raster;
pub mod raster_ops;
pub mod refine;
pub mod sectors;
pub mod simplify;
pub mod spatial;
pub mod surface;
pub mod tiles;
pub mod tuning;
pub mod vectors;
