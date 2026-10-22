//! `atlas`: command-line entry of the offline map pipeline.
//!
//! - `atlas classify <map> <out>`: unrefined per-pixel surface classes, one byte per pixel.
//! - `atlas extract <map> <wards> <streets> <zoom> <west> <north> <classes> <blocks>`: refined
//!   surfaces and traced city blocks, the TypeScript `extract-surfaces` outputs (`classes.bin`,
//!   `blocks.json`), byte for byte.
//! - `atlas houses <blocks> <classes> <map> <left,top,width,height> <min,max> <out>`: houses of
//!   the blocks in a region, as the TypeScript `generate-houses` writes them.
//! - `atlas sectors <houses> <classes> <map-width> <out-dir>`: sector payloads and `index.json`,
//!   as the TypeScript `export-sectors` writes them.

use std::{env, fs, path::Path, process::ExitCode, time::Instant};

use desire_atlas::blocks::{TraceOptions, block_mask, trace_blocks};
use desire_atlas::houses::{BlocksLayer, HouseRaster, HouseSpec, generate_houses};
use desire_atlas::layers::{blocks_json, houses_json};
use desire_atlas::raster::{RgbRaster, read_rgb};
use desire_atlas::raster_ops::Size;
use desire_atlas::refine::{RefineInput, RefineParams, refine_surfaces};
use desire_atlas::sectors::{
    ClassRaster, HousesLayer, Payload, SectorGrid, SectorIndex, export, features_in_metres,
};
use desire_atlas::surface::classify_rgb;
use desire_atlas::vectors::{
    FrameSpec, MercatorFrame, PixelPoint, StreetPolicy, StreetSurvey, fill_polygons, read_features,
};

type Run = fn(&[String]) -> Result<(), String>;

/// Command table: name, argument names (for usage), and what it runs.
const COMMANDS: [(&str, &[&str], Run); 4] = [
    ("classify", &["map", "out"], classify),
    (
        "extract",
        &[
            "map", "wards", "streets", "zoom", "west", "north", "classes", "blocks",
        ],
        extract,
    ),
    (
        "houses",
        &["blocks", "classes", "map", "region", "heights", "out"],
        houses,
    ),
    (
        "sectors",
        &["houses", "classes", "map-width", "out-dir"],
        sectors,
    ),
];

fn read_map(path: &str) -> Result<RgbRaster, String> {
    read_rgb(Path::new(path)).map_err(|error| format!("{path}: {error}"))
}

fn write(path: &str, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| format!("{path}: {error}"))
}

fn classify(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let raster = read_map(&args[0])?;
    write(&args[1], &classify_rgb(&raster.rgb))?;
    eprintln!("{}: classified in {:.2?}", args[1], start.elapsed());
    Ok(())
}

/// The street policy of the z18 map: fallback widths by street type, and measured bounds.
fn street_policy() -> StreetPolicy {
    let fallback = [("Main", 40.0), ("Major", 30.0), ("Minor", 20.0)];
    StreetPolicy {
        fallback_px: fallback.map(|(kind, px)| (kind.to_owned(), px)).into(),
        default_px: 20.0,
        min_px: 6.0,
        max_px: 90.0,
    }
}

fn frame_of(zoom: &str, west: &str, north: &str) -> Result<MercatorFrame, String> {
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

/// The wards filled into a mask: 1 inside the city.
fn urban_mask(frame: &MercatorFrame, wards: &str, size: Size) -> Result<Vec<u8>, String> {
    let rings: Vec<Vec<PixelPoint>> = read_features(Path::new(wards))?
        .iter()
        .map(|ward| {
            ward.points()
                .iter()
                .map(|&p| frame.lng_lat_to_pixel(p))
                .collect()
        })
        .collect();
    let mut urban = vec![0; size.pixels()];
    fill_polygons(&mut urban, size, &rings);
    Ok(urban)
}

/// Blocks smaller than about 10 m² are noise, open holes under about 45 m² are misread roof
/// patches, and outlines are simplified to about 0.7 m (under a wall's thickness).
const BLOCK_TRACE: TraceOptions = TraceOptions {
    min_area_px: 45,
    tolerance_px: 1.5,
    min_hole_area_px: 200.0,
};

/// The refined surfaces of the map and the urban mask they were refined with.
struct Surfaces {
    classes: Vec<u8>,
    urban: Vec<u8>,
    size: Size,
}

fn surfaces(frame: &MercatorFrame, args: &[String]) -> Result<Surfaces, String> {
    let raster = read_map(&args[0])?;
    let size = Size {
        width: raster.width,
        height: raster.height,
    };
    let urban = urban_mask(frame, &args[1], size)?;
    let survey = StreetSurvey {
        frame,
        raster: &raster,
        policy: &street_policy(),
    };
    let streets = survey.streets(&read_features(Path::new(&args[2]))?);
    let raw = classify_rgb(&raster.rgb);
    let input = RefineInput {
        classes: &raw,
        size,
        streets: &streets,
        urban: Some(&urban),
    };
    let classes = refine_surfaces(&input, &RefineParams::default());
    Ok(Surfaces {
        classes,
        urban,
        size,
    })
}

fn extract(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let frame = frame_of(&args[3], &args[4], &args[5])?;
    let refined = surfaces(&frame, args)?;
    write(&args[6], &refined.classes)?;
    let mask = block_mask(&refined.classes, &refined.urban);
    let blocks = trace_blocks(&mask, refined.size, &BLOCK_TRACE);
    write(&args[7], blocks_json(&blocks, &frame).as_bytes())?;
    eprintln!(
        "{} blocks, extracted in {:.2?}",
        blocks.len(),
        start.elapsed()
    );
    Ok(())
}

/// `count` comma-separated numbers.
fn numbers<const N: usize>(text: &str) -> Result<[f64; N], String> {
    let values: Result<Vec<f64>, _> = text.split(',').map(str::parse::<f64>).collect();
    let values = values.map_err(|_| format!("not numbers: {text}"))?;
    values
        .try_into()
        .map_err(|_| format!("{N} comma-separated numbers expected: {text}"))
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("{path}: {error}"))
}

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

fn houses(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let layer: BlocksLayer = serde_json::from_slice(&read(&args[0])?)
        .map_err(|error| format!("{}: {error}", args[0]))?;
    let sources = HouseSources::read(&args[1], &args[2])?;
    let spec = HouseSpec {
        region: numbers(&args[3])?,
        heights: numbers(&args[4])?,
    };
    let houses = generate_houses(&sources.raster(layer.metres_per_pixel), &layer, &spec);
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

/// The seed both exporters give berths and trees.
const FEATURE_SEED: u32 = 0xd0c4;

/// A class raster of known width, its height derived and checked.
fn class_raster(path: &str, width: &str) -> Result<(Vec<u8>, Size), String> {
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

/// Writes every payload as `<index>.render.bin` and the index as `index.json`.
fn write_sectors(out: &Path, payloads: &[Payload], index: &SectorIndex) -> Result<(), String> {
    fs::create_dir_all(out).map_err(|error| format!("{}: {error}", out.display()))?;
    for payload in payloads {
        let path = out.join(format!("{}.render.bin", payload.index));
        write(&path.to_string_lossy(), &payload.bytes)?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    write(
        &out.join("index.json").to_string_lossy(),
        format!("{json}\n").as_bytes(),
    )
}

fn sectors(args: &[String]) -> Result<(), String> {
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

fn usage() -> String {
    let lines: Vec<String> = COMMANDS
        .iter()
        .map(|(name, args, _)| format!("  atlas {name} <{}>", args.join("> <")))
        .collect();
    format!("usage:\n{}", lines.join("\n"))
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = COMMANDS.iter().find(|(name, params, _)| {
        args.first() == Some(&name.to_string()) && args.len() == params.len() + 1
    });
    let result = match command {
        Some((_, _, run)) => run(&args[1..]),
        None => Err(usage()),
    };
    result.map_or_else(
        |message| {
            eprintln!("atlas: {message}");
            ExitCode::FAILURE
        },
        |()| ExitCode::SUCCESS,
    )
}
