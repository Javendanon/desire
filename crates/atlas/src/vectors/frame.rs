//! Georeference of a stitched Web Mercator raster (slippy-map tiles of 256 px). Ground metres
//! per pixel use the Mercator scale at the frame's north edge.

use serde::Deserialize;

use super::PixelPoint;
use crate::js;

const EARTH_RADIUS_M: f64 = 6_378_137.0;
const TILE_PIXELS: f64 = 256.0;
const DEGREES_PER_TURN: f64 = 360.0;
const HALF_TURN_DEG: f64 = 180.0;

/// Zoom of the stitched tiles and the image's north-west corner in degrees.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct FrameSpec {
    pub zoom: i32,
    pub west: f64,
    pub north: f64,
}

pub struct MercatorFrame {
    scale: f64,
    origin: PixelPoint,
    pub metres_per_pixel: f64,
}

fn world_pixel_x(lng: f64, scale: f64) -> f64 {
    ((lng + HALF_TURN_DEG) / DEGREES_PER_TURN) * scale
}

fn world_pixel_y(lat: f64, scale: f64) -> f64 {
    let radians = js::to_radians(lat);
    let mercator = (radians.tan() + 1.0 / radians.cos()).ln() / std::f64::consts::PI;
    ((1.0 - mercator) / 2.0) * scale
}

impl MercatorFrame {
    pub fn new(spec: FrameSpec) -> Self {
        let scale = TILE_PIXELS * 2f64.powi(spec.zoom);
        let circumference = 2.0 * std::f64::consts::PI * EARTH_RADIUS_M;
        MercatorFrame {
            scale,
            origin: [
                world_pixel_x(spec.west, scale),
                world_pixel_y(spec.north, scale),
            ],
            metres_per_pixel: (circumference / scale) * js::to_radians(spec.north).cos(),
        }
    }

    /// `[longitude, latitude]` in degrees to raster pixels.
    pub fn lng_lat_to_pixel(&self, [lng, lat]: [f64; 2]) -> PixelPoint {
        [
            world_pixel_x(lng, self.scale) - self.origin[0],
            world_pixel_y(lat, self.scale) - self.origin[1],
        ]
    }
}
