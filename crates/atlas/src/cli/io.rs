//! File and argument helpers the commands share.

use std::{fs, path::Path};

use desire_atlas::raster::{RgbRaster, read_rgb};
use desire_atlas::raster_ops::Size;
use desire_atlas::vectors::{FrameSpec, MercatorFrame};

pub fn read_map(path: &str) -> Result<RgbRaster, String> {
    read_rgb(Path::new(path)).map_err(|error| format!("{path}: {error}"))
}

pub fn write(path: &str, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| format!("{path}: {error}"))
}

/// `count` comma-separated numbers.
pub fn numbers<const N: usize>(text: &str) -> Result<[f64; N], String> {
    let values: Result<Vec<f64>, _> = text.split(',').map(str::parse::<f64>).collect();
    let values = values.map_err(|_| format!("not numbers: {text}"))?;
    values
        .try_into()
        .map_err(|_| format!("{N} comma-separated numbers expected: {text}"))
}

pub fn read(path: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("{path}: {error}"))
}

/// A class raster of known width, its height derived and checked.
pub fn class_raster(path: &str, width: &str) -> Result<(Vec<u8>, Size), String> {
    let classes = read(path)?;
    let width: usize = width
        .parse()
        .map_err(|_| format!("not a pixel width: {width}"))?;
    if width == 0 || classes.len() % width != 0 {
        return Err(format!(
            "{path}: {} bytes is not a whole number of {width}-px rows",
            classes.len()
        ));
    }
    let size = Size {
        width,
        height: classes.len() / width,
    };
    Ok((classes, size))
}

pub fn frame_of(zoom: &str, west: &str, north: &str) -> Result<MercatorFrame, String> {
    let number = |text: &str| {
        text.parse::<f64>()
            .map_err(|_| format!("not a number: {text}"))
    };
    Ok(MercatorFrame::new(FrameSpec {
        zoom: zoom
            .parse()
            .map_err(|_| format!("not an integer zoom: {zoom}"))?,
        west: number(west)?,
        north: number(north)?,
    }))
}
