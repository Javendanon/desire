//! `atlas`: command-line entry of the offline map pipeline.
//!
//! - `atlas classify <map> <out>`: unrefined per-pixel surface classes, one byte per pixel.
//! - `atlas extract <map> <wards> <streets> <zoom> <west> <north> <classes> <blocks>`: refined
//!   surfaces and traced city blocks, the TypeScript `extract-surfaces` outputs (`classes.bin`,
//!   `blocks.json`), byte for byte.

use std::{env, fs, path::Path, process::ExitCode, time::Instant};

use desire_atlas::blocks::{TraceOptions, block_mask, trace_blocks};
use desire_atlas::layers::blocks_json;
use desire_atlas::raster::{RgbRaster, read_rgb};
use desire_atlas::raster_ops::Size;
use desire_atlas::refine::{RefineInput, RefineParams, refine_surfaces};
use desire_atlas::surface::classify_rgb;
use desire_atlas::vectors::{
    FrameSpec, MercatorFrame, PixelPoint, StreetPolicy, StreetSurvey, fill_polygons, read_features,
};

type Run = fn(&[String]) -> Result<(), String>;

/// Command table: name, argument names (for usage), and what it runs.
const COMMANDS: [(&str, &[&str], Run); 2] = [
    ("classify", &["map", "out"], classify),
    (
        "extract",
        &[
            "map", "wards", "streets", "zoom", "west", "north", "classes", "blocks",
        ],
        extract,
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
