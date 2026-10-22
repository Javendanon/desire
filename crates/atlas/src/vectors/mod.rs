//! The map's vector layers in raster pixels: the Web Mercator frame, GeoJSON ward polygons and
//! street centrelines, their rasterisation, and street widths measured on the raster. Ported from
//! `tools/assets/src/raster/{frame,vectors,polygon-fill,polyline,street-width}.ts`, with the same
//! floating-point operation order so results match TypeScript exactly (parity tests).

mod fill;
mod frame;
mod geojson;
mod js;
mod polyline;
mod street_width;

pub use fill::fill_polygons;
pub use frame::{FrameSpec, MercatorFrame};
pub use geojson::{Feature, read_features};
pub use polyline::{Polyline, paint_polylines};
pub use street_width::{StreetPolicy, StreetSurvey, measure_street_width};

/// A point in raster pixels: x east, y south from the north-west corner.
pub type PixelPoint = [f64; 2];
