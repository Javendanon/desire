//! Parity with the TypeScript pipeline: each stage gives the reference result that
//! `tools/assets/parity.ts` recorded in `fixtures/parity.json` from the same input.

use desire_atlas::raster::RgbRaster;
use desire_atlas::raster_ops::{Size, components, dilate, erode, majority};
use desire_atlas::vectors::{
    FrameSpec, MercatorFrame, Polyline, fill_polygons, measure_street_width, paint_polylines,
};
use serde::Deserialize;
use desire_atlas::surface::{Surface, classify_pixel};

const GOLDEN: &str = include_str!("fixtures/parity.json");

/// FNV-1a, 32 bits, as `tools/assets/parity.ts` computes it.
fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
    })
}

/// The integer after `"key": ` inside the named golden section.
fn golden_number(section: &str, key: &str) -> u64 {
    let start = GOLDEN
        .find(&format!("\"{section}\""))
        .expect("section in golden");
    let rest = &GOLDEN[start..];
    let at = rest.find(&format!("\"{key}\": ")).expect("key in section") + key.len() + 4;
    let digits: String = rest[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().expect("a number")
}

#[test]
fn every_colour_classifies_as_in_typescript() {
    let table: Vec<u8> = (0..1u32 << 24)
        .map(|colour| {
            let [_, r, g, b] = colour.to_be_bytes();
            classify_pixel(r, g, b) as u8
        })
        .collect();
    let section = "classify_all_colours";
    for surface in Surface::ALL {
        let count = table
            .iter()
            .filter(|&&class| class == surface as u8)
            .count() as u64;
        assert_eq!(
            count,
            golden_number(section, surface.name()),
            "{}",
            surface.name()
        );
    }
    assert_eq!(u64::from(fnv1a(&table)), golden_number(section, "fnv1a"));
}

const SYNTHETIC: &[u8] = include_bytes!("fixtures/classes-257x131.bin");
const SYNTHETIC_SIZE: Size = Size {
    width: 257,
    height: 131,
};

fn labels_bytes(labels: &[i32]) -> Vec<u8> {
    labels
        .iter()
        .flat_map(|label| label.to_le_bytes())
        .collect()
}

#[test]
fn raster_operations_match_typescript_on_a_synthetic_raster() {
    let size = SYNTHETIC_SIZE;
    let water: Vec<u8> = SYNTHETIC
        .iter()
        .map(|&class| u8::from(class == Surface::Water as u8))
        .collect();
    let golden = |key| golden_number("raster_ops", key);
    let hash = |bytes: &[u8]| u64::from(fnv1a(bytes));
    assert_eq!(hash(&majority(SYNTHETIC, size, 2)), golden("majority_r2"));
    assert_eq!(hash(&majority(SYNTHETIC, size, 5)), golden("majority_r5"));
    assert_eq!(hash(&dilate(&water, size, 3)), golden("dilate_r3"));
    assert_eq!(hash(&dilate(&water, size, 40)), golden("dilate_r40"));
    assert_eq!(hash(&erode(&water, size, 2)), golden("erode_r2"));
    let found = components(&water, size);
    assert_eq!(
        hash(&labels_bytes(&found.labels)),
        golden("components_labels")
    );
    assert_eq!(found.sizes.len() as u64, golden("components_count"));
    let largest = found.sizes.iter().copied().max().unwrap_or(0);
    assert_eq!(largest as u64, golden("components_largest"));
}

#[derive(Deserialize)]
struct VectorInput {
    frame: FrameSpec,
    frame_points: Vec<[f64; 2]>,
    rings: Vec<Vec<[f64; 2]>>,
    lines: Vec<Polyline>,
    street_lines: Vec<Vec<[f64; 2]>>,
}

#[derive(Deserialize)]
struct VectorGolden {
    frame_metres_per_pixel: f64,
    frame_pixels: Vec<[f64; 2]>,
    fill_fnv1a: u32,
    fill_count: usize,
    paint_fnv1a: u32,
    paint_count: usize,
    street_widths: Vec<f64>,
}

fn vector_case() -> (VectorInput, VectorGolden) {
    let input = serde_json::from_str(include_str!("fixtures/vectors-input.json")).expect("input");
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).expect("golden json");
    let golden = serde_json::from_value(golden["vectors"].clone()).expect("vector goldens");
    (input, golden)
}

#[test]
fn the_mercator_frame_projects_exactly_as_typescript() {
    let (input, golden) = vector_case();
    let frame = MercatorFrame::new(input.frame);
    assert_eq!(frame.metres_per_pixel, golden.frame_metres_per_pixel);
    for (point, expected) in input.frame_points.iter().zip(&golden.frame_pixels) {
        assert_eq!(&frame.lng_lat_to_pixel(*point), expected, "{point:?}");
    }
}

#[test]
fn polygons_and_polylines_rasterise_as_in_typescript() {
    let (input, golden) = vector_case();
    let size = Size {
        width: 200,
        height: 150,
    };
    let mut filled = vec![0; size.pixels()];
    fill_polygons(&mut filled, size, &input.rings);
    assert_eq!(filled.iter().filter(|&&value| value == 1).count(), golden.fill_count);
    assert_eq!(fnv1a(&filled), golden.fill_fnv1a);
    let mut painted = vec![0; size.pixels()];
    paint_polylines(&mut painted, size, &input.lines);
    assert_eq!(painted.iter().filter(|&&value| value == 1).count(), golden.paint_count);
    assert_eq!(fnv1a(&painted), golden.paint_fnv1a);
}

#[test]
fn street_widths_measure_as_in_typescript() {
    let (input, golden) = vector_case();
    let raster = RgbRaster {
        width: 301,
        height: 203,
        rgb: include_bytes!("fixtures/streets-301x203.rgb").to_vec(),
    };
    let widths: Vec<f64> = input
        .street_lines
        .iter()
        .map(|line| measure_street_width(&raster, line))
        .collect();
    assert_eq!(widths, golden.street_widths);
}
