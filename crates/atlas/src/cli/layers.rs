//! `houses` and `sectors`: houses of the traced blocks, then sector payloads and their index.

use std::{fs, path::Path, time::Instant};

use desire_atlas::houses::{BlocksLayer, HouseRaster, HouseSpec, generate_houses};
use desire_atlas::layers::houses_json;
use desire_atlas::raster::RgbRaster;
use desire_atlas::raster_ops::Size;
use desire_atlas::sectors::{
    ClassRaster, FEATURE_SEED, HousesLayer, Payload, SectorGrid, SectorIndex, export,
    features_in_metres, index_json,
};

use super::io::{class_raster, numbers, read, read_map, write};

/// What the houses stage reads besides the blocks: the class raster and the source map.
struct HouseSources {
    classes: Vec<u8>,
    map: RgbRaster,
}

impl HouseSources {
    /// Reads both and checks they cover the same pixels.
    fn read(classes: &str, map: &str) -> Result<Self, String> {
        let sources = HouseSources {
            classes: read(classes)?,
            map: read_map(map)?,
        };
        let pixels = sources.map.width * sources.map.height;
        if sources.classes.len() != pixels {
            let held = sources.classes.len();
            return Err(format!("{classes}: {held} pixels, the map has {pixels}"));
        }
        Ok(sources)
    }

    fn raster(&self, metres_per_pixel: f64) -> HouseRaster<'_> {
        HouseRaster {
            rgb: &self.map.rgb,
            classes: &self.classes,
            size: Size {
                width: self.map.width,
                height: self.map.height,
            },
            metres_per_pixel,
        }
    }
}

pub fn houses(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let layer: BlocksLayer = serde_json::from_slice(&read(&args[0])?)
        .map_err(|error| format!("{}: {error}", args[0]))?;
    let sources = HouseSources::read(&args[1], &args[2])?;
    let spec = HouseSpec {
        region: numbers(&args[3])?,
        heights: numbers(&args[4])?,
    };
    let houses = generate_houses(&sources.raster(layer.metres_per_pixel), &layer, &spec)?;
    write(
        &args[5],
        houses_json(&houses, layer.metres_per_pixel).as_bytes(),
    )?;
    eprintln!(
        "{}: {} houses in {:.2?}",
        args[5],
        houses.len(),
        start.elapsed()
    );
    Ok(())
}

/// Writes every payload as `<index>.render.bin` and the index as `index.json`.
fn write_sectors(out: &Path, payloads: &[Payload], index: &SectorIndex) -> Result<(), String> {
    fs::create_dir_all(out).map_err(|error| format!("{}: {error}", out.display()))?;
    for payload in payloads {
        let path = out.join(format!("{}.render.bin", payload.index));
        write(&path.to_string_lossy(), &payload.bytes)?;
    }
    write(
        &out.join("index.json").to_string_lossy(),
        index_json(index).as_bytes(),
    )
}

pub fn sectors(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let layer: HousesLayer = serde_json::from_slice(&read(&args[0])?)
        .map_err(|error| format!("{}: {error}", args[0]))?;
    let (classes, size) = class_raster(&args[1], &args[2])?;
    let raster = ClassRaster {
        classes: &classes,
        size,
    };
    let features = features_in_metres(&raster, layer.metres_per_pixel, FEATURE_SEED);
    let grid = SectorGrid::new(size, layer.metres_per_pixel);
    let (payloads, index) = export(grid, &layer.houses, &features);
    write_sectors(Path::new(&args[3]), &payloads, &index)?;
    eprintln!(
        "{}: {} sectors in {:.2?}",
        args[3],
        payloads.len(),
        start.elapsed()
    );
    Ok(())
}
