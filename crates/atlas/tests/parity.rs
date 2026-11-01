//! Parity with the TypeScript pipeline: each stage gives the reference result that
//! `tools/assets/parity.ts` recorded in `fixtures/parity.json` from the same input.

use desire_atlas::blocks::{Block, TraceOptions, block_mask, trace_blocks};
use desire_atlas::features::{Berth, ShipSpec, Tree, TreeSpec, find_berths, plant_trees};
use desire_atlas::ground::{GroundSpec, height_field, paint_albedo, shore_distance};
use desire_atlas::raster::RgbRaster;
use desire_atlas::raster_ops::{Size, components, dilate, erode, majority};
use desire_atlas::refine::{RefineInput, RefineParams, refine_surfaces};
use desire_atlas::surface::{Surface, classify_pixel};
use desire_atlas::vectors::{
    FrameSpec, MercatorFrame, Polyline, fill_polygons, measure_street_width, paint_polylines,
};
use serde::Deserialize;

mod common;

use std::sync::OnceLock;

use common::{fnv1a, ulps_apart};

const GOLDEN: &str = include_str!("fixtures/parity.json");

fn golden_json() -> &'static serde_json::Value {
    static PARSED: OnceLock<serde_json::Value> = OnceLock::new();
    PARSED.get_or_init(|| serde_json::from_str(GOLDEN).expect("golden json"))
}

/// A whole number in a golden section. A missing section or key fails, never reads another.
fn golden_number(section: &str, key: &str) -> u64 {
    golden_json()[section][key]
        .as_u64()
        .unwrap_or_else(|| panic!("{section}.{key} is not a whole number in the golden"))
}

/// A surface's pixel count in a golden section's `counts`.
fn golden_count(section: &str, surface: Surface) -> u64 {
    let name = surface.name();
    golden_json()[section]["counts"][name]
        .as_u64()
        .unwrap_or_else(|| panic!("{section}.counts.{name} is not a whole number in the golden"))
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
        assert_eq!(count, golden_count(section, surface), "{}", surface.name());
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
    refine: RefineCase,
}

#[derive(Deserialize)]
struct RefineCase {
    streets: Vec<Polyline>,
    urban: Vec<[f64; 2]>,
    params: RefineParams,
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

/// V8 and Rust's `tan`/`cos`/`log` can differ in the last bit, which the 2^26 world scale turns
/// into about 10⁻⁸ px. The tolerance is a hundred times that and far below a pixel. The full-map
/// check (urban mask and streets identical to TypeScript) is what pins the consequence.
const FRAME_TOLERANCE_PX: f64 = 1e-6;

#[test]
fn the_mercator_frame_projects_as_typescript_within_a_millionth_of_a_pixel() {
    let (input, golden) = vector_case();
    let frame = MercatorFrame::new(input.frame);
    assert_eq!(frame.metres_per_pixel, golden.frame_metres_per_pixel);
    assert_eq!(
        input.frame_points.len(),
        golden.frame_pixels.len(),
        "frame points"
    );
    for (point, expected) in input.frame_points.iter().zip(&golden.frame_pixels) {
        let pixel = frame.lng_lat_to_pixel(*point);
        let error = (pixel[0] - expected[0])
            .abs()
            .max((pixel[1] - expected[1]).abs());
        assert!(
            error < FRAME_TOLERANCE_PX,
            "{point:?}: {pixel:?} vs {expected:?}"
        );
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
    assert_eq!(
        filled.iter().filter(|&&value| value == 1).count(),
        golden.fill_count
    );
    assert_eq!(fnv1a(&filled), golden.fill_fnv1a);
    let mut painted = vec![0; size.pixels()];
    paint_polylines(&mut painted, size, &input.lines);
    assert_eq!(
        painted.iter().filter(|&&value| value == 1).count(),
        golden.paint_count
    );
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

/// The synthetic raster refined with the recorded streets and urban outline, and that outline.
fn refined_synthetic() -> (Vec<u8>, Vec<u8>) {
    let (input, _) = vector_case();
    let case = input.refine;
    let mut urban = vec![0; SYNTHETIC_SIZE.pixels()];
    fill_polygons(
        &mut urban,
        SYNTHETIC_SIZE,
        std::slice::from_ref(&case.urban),
    );
    let input = RefineInput {
        classes: SYNTHETIC,
        size: SYNTHETIC_SIZE,
        streets: &case.streets,
        urban: Some(&urban),
    };
    (refine_surfaces(&input, &case.params), urban)
}

#[test]
fn refinement_matches_typescript_on_a_synthetic_raster() {
    let (refined, _) = refined_synthetic();
    for surface in Surface::ALL {
        let count = refined
            .iter()
            .filter(|&&class| class == surface as u8)
            .count() as u64;
        assert_eq!(count, golden_count("refine", surface), "{}", surface.name());
    }
    assert_eq!(u64::from(fnv1a(&refined)), golden_number("refine", "fnv1a"));
}

#[derive(Deserialize)]
struct BlocksGolden {
    trace: TraceOptions,
    blocks: Vec<Block>,
}

#[test]
fn blocks_trace_as_in_typescript() {
    let (refined, urban) = refined_synthetic();
    let golden: BlocksGolden =
        serde_json::from_str(include_str!("fixtures/blocks-golden.json")).expect("golden");
    let blocks = trace_blocks(&block_mask(&refined, &urban), SYNTHETIC_SIZE, &golden.trace);
    assert_eq!(blocks, golden.blocks);
}

#[derive(Deserialize)]
struct FeaturesGolden {
    ship: ShipSpec,
    orchard: TreeSpec,
    berths: Vec<Berth>,
    trees: Vec<Tree>,
}

#[test]
fn berths_and_trees_match_typescript() {
    let (refined, _) = refined_synthetic();
    let golden: FeaturesGolden =
        serde_json::from_str(include_str!("fixtures/features-golden.json")).expect("golden");
    assert_eq!(
        plant_trees(&refined, SYNTHETIC_SIZE, &golden.orchard),
        golden.trees
    );
    let berths = find_berths(&refined, SYNTHETIC_SIZE, &golden.ship);
    assert_eq!(berths.len(), golden.berths.len());
    for (berth, expected) in berths.iter().zip(&golden.berths) {
        assert_eq!([berth.x_px, berth.y_px], [expected.x_px, expected.y_px]);
        // Headings are an `atan2` written for the viewer: equal within the last bit.
        assert!(ulps_apart(berth.heading_radians, expected.heading_radians) <= 1);
    }
}

#[test]
fn ground_paints_and_heights_as_in_typescript() {
    let (refined, _) = refined_synthetic();
    let spec = GroundSpec {
        classes: &refined,
        size: SYNTHETIC_SIZE,
        cell_px: 4,
        seed: 0xd0c4,
    };
    let golden = |key| golden_number("ground", key);
    let shore: Vec<u8> = shore_distance(&refined, SYNTHETIC_SIZE)
        .iter()
        .flat_map(|d| d.to_le_bytes())
        .collect();
    assert_eq!(u64::from(fnv1a(&shore)), golden("shore_fnv1a"));
    assert_eq!(
        u64::from(fnv1a(&paint_albedo(&spec))),
        golden("albedo_fnv1a")
    );
    let field = height_field(&spec);
    assert_eq!(
        (field.columns as u64, field.rows as u64),
        (golden("columns"), golden("rows"))
    );
    let heights: Vec<u8> = field.heights.iter().flat_map(|h| h.to_le_bytes()).collect();
    assert_eq!(u64::from(fnv1a(&heights)), golden("heights_fnv1a"));
}
