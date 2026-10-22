//! Runs the vector stage on the real map and writes its results, for a byte-for-byte comparison
//! with the TypeScript pipeline: the urban mask, each street's measured width, and the painted
//! street mask. Usage (zoom, west and north of the source frame):
//! `cargo run --release -p desire-atlas --example vectors_check --`
//! `<map.png> <wards.geojson> <streets.geojson> <zoom> <west> <north> <out-dir>`

use std::{env, fs, path::Path, time::Instant};

use desire_atlas::raster::{RgbRaster, read_rgb};
use desire_atlas::raster_ops::Size;
use desire_atlas::vectors::{
    FrameSpec, MercatorFrame, StreetPolicy, StreetSurvey, fill_polygons, paint_polylines,
    read_features,
};

/// The street policy of `tools/assets/extract-surfaces.ts`.
fn policy() -> StreetPolicy {
    let fallback = [("Main", 40.0), ("Major", 30.0), ("Minor", 20.0)];
    StreetPolicy {
        fallback_px: fallback.map(|(kind, px)| (kind.to_owned(), px)).into(),
        default_px: 20.0,
        min_px: 6.0,
        max_px: 90.0,
    }
}

fn urban_mask(frame: &MercatorFrame, wards: &Path, size: Size) -> Vec<u8> {
    let rings: Vec<Vec<[f64; 2]>> = read_features(wards)
        .expect("readable wards")
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
    urban
}

/// What the vector stage produces for the comparison.
struct Results {
    urban: Vec<u8>,
    streets: Vec<u8>,
    widths: Vec<f64>,
}

/// The two GeoJSON layers of the source map.
struct Layers<'a> {
    wards: &'a Path,
    streets: &'a Path,
}

/// The urban mask, the painted streets and their widths.
fn compute(frame: &MercatorFrame, raster: &RgbRaster, layers: Layers) -> Results {
    let size = Size {
        width: raster.width,
        height: raster.height,
    };
    let urban = urban_mask(frame, layers.wards, size);
    let survey = StreetSurvey {
        frame,
        raster,
        policy: &policy(),
    };
    let lines = survey.streets(&read_features(layers.streets).expect("readable streets"));
    let mut painted = vec![0; size.pixels()];
    paint_polylines(&mut painted, size, &lines);
    let widths = lines.iter().map(|line| line.width).collect();
    Results {
        urban,
        streets: painted,
        widths,
    }
}

fn write_results(out: &Path, results: &Results) {
    fs::write(out.join("urban.bin"), &results.urban).expect("writable");
    fs::write(out.join("streets.bin"), &results.streets).expect("writable");
    fs::write(out.join("widths.json"), format!("{:?}", results.widths)).expect("writable");
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let [map, _, _, zoom, west, north, _] = args.as_slice() else {
        panic!("usage: vectors_check <map> <wards> <streets> <zoom> <west> <north> <out-dir>");
    };
    let number = |text: &String| text.parse::<f64>().expect("a number");
    let frame = MercatorFrame::new(FrameSpec {
        zoom: zoom.parse().expect("an integer zoom"),
        west: number(west),
        north: number(north),
    });
    let raster = read_rgb(Path::new(map)).expect("readable map");
    let [_, wards, streets, .., out] = args.as_slice() else {
        unreachable!("seven arguments, matched above");
    };
    let start = Instant::now();
    let layers = Layers {
        wards: Path::new(wards),
        streets: Path::new(streets),
    };
    let results = compute(&frame, &raster, layers);
    println!(
        "vector stage: {:.0} ms",
        start.elapsed().as_secs_f64() * 1000.0
    );
    write_results(Path::new(out), &results);
}
