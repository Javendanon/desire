//! `classify` and `extract`: per-pixel surface classes, then refined surfaces and traced blocks.

use std::{path::Path, time::Instant};

use desire_atlas::blocks::{block_mask, trace_blocks};
use desire_atlas::layers::blocks_json;
use desire_atlas::raster_ops::Size;
use desire_atlas::refine::{RefineInput, RefineParams, refine_surfaces};
use desire_atlas::surface::classify_rgb;
use desire_atlas::tuning::{BLOCK_TRACE, street_policy};
use desire_atlas::vectors::{
    MercatorFrame, PixelPoint, StreetSurvey, fill_polygons, read_features,
};

use super::io::{frame_of, read_map, write};

pub fn classify(args: &[String]) -> Result<(), String> {
    let start = Instant::now();
    let raster = read_map(&args[0])?;
    write(&args[1], &classify_rgb(&raster.rgb))?;
    eprintln!("{}: classified in {:.2?}", args[1], start.elapsed());
    Ok(())
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

pub fn extract(args: &[String]) -> Result<(), String> {
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
