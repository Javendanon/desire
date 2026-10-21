//! The offline map pipeline in Rust: the stages of `tools/assets` (classify, refine, blocks,
//! lots, features, sectors), ported one at a time with a parity check against the TypeScript
//! version on the same input. Plan: `docs/waterdeep-3d/rust-chunk-pipeline.md` (M2).

pub mod raster;
pub mod raster_ops;
pub mod surface;
