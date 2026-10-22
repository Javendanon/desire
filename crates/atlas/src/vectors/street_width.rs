//! Measures the drawn width of a street on the raster from its vector centreline.
//!
//! At samples along the line, the street's own colour is the median of a 3 × 3 window on the
//! centreline. A walk along each normal stops when the colour leaves it for a few pixels in a
//! row. Comparing against the street's own colour works for any palette (light dirt lanes in Dock
//! Ward, dark brown streets in North Ward). The median over samples ignores junctions and squares.

use std::collections::HashMap;

use rayon::prelude::*;

use super::{Feature, MercatorFrame, PixelPoint, Polyline, js};
use crate::raster::RgbRaster;

const SAMPLE_STEP_PX: f64 = 4.0;
/// Squared RGB distance beyond which a pixel no longer belongs to the street (40²): integer
/// channels make the squared test exact where a square root could round.
const EDGE_DISTANCE_SQUARED: i32 = 1600;
/// Consecutive off-street pixels needed to accept an edge. Pebbles are one or two pixels.
const EDGE_RUN: u32 = 3;
/// Building outlines: darker than this on every channel (the `Outline` surface rule).
const OUTLINE_MAX_CHANNEL: u8 = 50;
/// Outlines are 2 px wide at z18 and end the street even when the roof beyond matches it.
const OUTLINE_RUN: u32 = 2;
const MAX_HALF_WIDTH_PX: u32 = 60;

type Colour = [u8; 3];

fn colour_at(raster: &RgbRaster, [x, y]: PixelPoint) -> Option<Colour> {
    let (column, row) = (js::round(x), js::round(y));
    let inside = column >= 0.0 && row >= 0.0;
    if !inside || column as usize >= raster.width || row as usize >= raster.height {
        return None;
    }
    let offset = (row as usize * raster.width + column as usize) * 3;
    raster.rgb[offset..offset + 3].try_into().ok()
}

/// Per-channel median of the 3 × 3 window around a centreline point, if any of it is inside.
fn reference_colour(raster: &RgbRaster, [x, y]: PixelPoint) -> Option<Colour> {
    let window: Vec<Colour> = (-1..=1)
        .flat_map(|dy| (-1..=1).map(move |dx| [x + f64::from(dx), y + f64::from(dy)]))
        .filter_map(|point| colour_at(raster, point))
        .collect();
    if window.is_empty() {
        return None;
    }
    let channel = |index: usize| {
        let mut values: Vec<f64> = window
            .iter()
            .map(|colour| f64::from(colour[index]))
            .collect();
        js::median(&mut values) as u8
    };
    Some([channel(0), channel(1), channel(2)])
}

fn distance_squared(a: Colour, b: Colour) -> i32 {
    a.iter()
        .zip(b)
        .map(|(&first, second)| (i32::from(first) - i32::from(second)).pow(2))
        .sum()
}

/// The two runs that can end a street: off its colour, and on a drawn outline.
#[derive(Default)]
struct Runs {
    off_street: u32,
    outline: u32,
}

impl Runs {
    /// Counts one pixel and returns the run length that ends the street, or 0.
    fn step(&mut self, colour: Colour, reference: Colour) -> u32 {
        let off = distance_squared(colour, reference) > EDGE_DISTANCE_SQUARED;
        let dark = colour.iter().all(|&channel| channel < OUTLINE_MAX_CHANNEL);
        self.off_street = if off { self.off_street + 1 } else { 0 };
        self.outline = if dark { self.outline + 1 } else { 0 };
        if self.outline >= OUTLINE_RUN {
            OUTLINE_RUN
        } else if self.off_street >= EDGE_RUN {
            EDGE_RUN
        } else {
            0
        }
    }
}

/// A walk from a centreline sample along one normal, against the street's colour there.
struct Walk<'a> {
    raster: &'a RgbRaster,
    origin: PixelPoint,
    reference: Colour,
}

impl Walk<'_> {
    /// Pixels from the centreline to the street edge along `normal`.
    fn half_width(&self, normal: PixelPoint) -> u32 {
        let mut runs = Runs::default();
        for step in 1..=MAX_HALF_WIDTH_PX {
            let along = f64::from(step);
            let point = [
                self.origin[0] + normal[0] * along,
                self.origin[1] + normal[1] * along,
            ];
            let Some(colour) = colour_at(self.raster, point) else {
                return step;
            };
            let run = runs.step(colour, self.reference);
            if run > 0 {
                return step - run + 1;
            }
        }
        MAX_HALF_WIDTH_PX
    }
}

/// Widths sampled every few pixels along one segment.
fn segment_widths(raster: &RgbRaster, from: PixelPoint, to: PixelPoint) -> Vec<f64> {
    let length = js::hypot(&[to[0] - from[0], to[1] - from[1]]);
    if length < 1.0 {
        return Vec::new();
    }
    let tangent = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    let mut widths = Vec::new();
    let mut along = 0.0;
    while along < length {
        let origin = [from[0] + tangent[0] * along, from[1] + tangent[1] * along];
        if let Some(reference) = reference_colour(raster, origin) {
            let walk = Walk {
                raster,
                origin,
                reference,
            };
            let left = walk.half_width([-tangent[1], tangent[0]]);
            let right = walk.half_width([tangent[1], -tangent[0]]);
            widths.push(f64::from(left + right));
        }
        along += SAMPLE_STEP_PX;
    }
    widths
}

/// Median drawn width in pixels along a centreline, or 0 when no sample lies on the raster.
pub fn measure_street_width(raster: &RgbRaster, line: &[PixelPoint]) -> f64 {
    let mut widths: Vec<f64> = line
        .windows(2)
        .flat_map(|pair| segment_widths(raster, pair[0], pair[1]))
        .collect();
    if widths.is_empty() {
        0.0
    } else {
        js::median(&mut widths)
    }
}

/// Widths for streets that cannot be measured, and bounds for those that can.
pub struct StreetPolicy {
    /// By the feature's `Type` (`Main`, `Major`, `Minor`).
    pub fallback_px: HashMap<String, f64>,
    pub default_px: f64,
    pub min_px: f64,
    pub max_px: f64,
}

impl StreetPolicy {
    fn width(&self, measured: f64, kind: Option<&str>) -> f64 {
        if measured > 0.0 {
            return measured.clamp(self.min_px, self.max_px);
        }
        let fallback = kind.and_then(|kind| self.fallback_px.get(kind));
        fallback.copied().unwrap_or(self.default_px)
    }
}

/// What measuring streets needs: the frame to project them, the raster to measure them on,
/// and the policy for widths.
pub struct StreetSurvey<'a> {
    pub frame: &'a MercatorFrame,
    pub raster: &'a RgbRaster,
    pub policy: &'a StreetPolicy,
}

impl StreetSurvey<'_> {
    fn street(&self, feature: &Feature) -> Polyline {
        let points: Vec<PixelPoint> = feature
            .points()
            .iter()
            .map(|&point| self.frame.lng_lat_to_pixel(point))
            .collect();
        let measured = measure_street_width(self.raster, &points);
        let width = self
            .policy
            .width(measured, feature.properties.kind.as_deref());
        Polyline { points, width }
    }

    /// Street centrelines in raster pixels with measured widths, in parallel (streets are
    /// independent). O(Σ samples · half width).
    pub fn streets(&self, features: &[Feature]) -> Vec<Polyline> {
        features
            .par_iter()
            .map(|feature| self.street(feature))
            .collect()
    }
}
