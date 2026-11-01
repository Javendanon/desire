//! `ground`: ground tiles along the sector grid, albedo JPEGs and vertex heights.

use std::{fs, path::Path, time::Instant};

use rayon::prelude::*;

use desire_atlas::ground::{GroundSpec, HeightField, height_field, paint_albedo};
use desire_atlas::sectors::FEATURE_SEED;
use desire_atlas::tiles::{TileGrid, albedo_tile, height_tile, smooth};
use desire_atlas::tuning::{CELL_PX, JPEG_QUALITY, SMOOTH_PASSES, TILE_PX};

use super::io::{class_raster, write};

fn jpeg(rgb: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY);
    let colour = image::ExtendedColorType::Rgb8;
    encoder
        .encode(rgb, width as u32, height as u32, colour)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

/// The whole map's ground, ready to cut: albedo and smoothed heights.
struct Ground {
    rgb: Vec<u8>,
    heights: HeightField,
    grid: TileGrid,
}

impl Ground {
    /// One tile's files: the albedo JPEG and the vertex heights, i16 LE centimetres.
    fn tile(&self, index: usize) -> Result<[Vec<u8>; 2], String> {
        let [_, _, width, height] = self.grid.pixels(index);
        let albedo = jpeg(&albedo_tile(&self.rgb, &self.grid, index), width, height)?;
        let vertices = height_tile(&self.heights, &self.grid, index);
        Ok([
            albedo,
            vertices.iter().flat_map(|h| h.to_le_bytes()).collect(),
        ])
    }
}

fn write_ground(out: &Path, tiles: &[[Vec<u8>; 2]], index: &str) -> Result<(), String> {
    fs::create_dir_all(out).map_err(|error| format!("{}: {error}", out.display()))?;
    for (tile, [albedo, heights]) in tiles.iter().enumerate() {
        write(&out.join(format!("{tile}.jpg")).to_string_lossy(), albedo)?;
        write(
            &out.join(format!("{tile}.heights.bin")).to_string_lossy(),
            heights,
        )?;
    }
    write(
        &out.join("ground.json").to_string_lossy(),
        format!("{index}\n").as_bytes(),
    )
}

pub fn ground(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let (classes, size) = class_raster(&args[0], &args[1])?;
    let mpp: f64 = args[2]
        .parse()
        .map_err(|_| format!("not a scale: {}", args[2]))?;
    let spec = GroundSpec {
        classes: &classes,
        size,
        cell_px: CELL_PX,
        seed: FEATURE_SEED,
    };
    let heights = smooth(&height_field(&spec), SMOOTH_PASSES);
    let grid = TileGrid::new(size, TILE_PX, CELL_PX);
    let ground = Ground {
        rgb: paint_albedo(&spec),
        heights,
        grid,
    };
    let count = grid.columns * grid.rows;
    let tiles: Result<Vec<_>, String> =
        (0..count).into_par_iter().map(|i| ground.tile(i)).collect();
    let index = serde_json::to_string_pretty(&grid.index(mpp)).map_err(|e| e.to_string())?;
    write_ground(Path::new(&args[3]), &tiles?, &index)?;
    eprintln!("{}: {count} tiles in {:.2?}", args[3], start.elapsed());
    Ok(())
}
