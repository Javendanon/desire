//! Houses and sector payloads of the synthetic town against the TypeScript pipeline
//! (`tools/assets/parity.ts`): the same blocks, raster and roof colours, the same id scheme,
//! heights, roof sampling, region filter, partition, roof palette and `index.json`.

mod common;

use common::{fnv1a, ulps_apart};
use desire_atlas::houses::{BlocksLayer, HouseRaster, HouseSpec, generate_houses};
use desire_atlas::layers::houses_json;
use desire_atlas::raster_ops::Size;
use desire_atlas::sectors::{
    ClassRaster, FEATURE_SEED, HousesLayer, SectorGrid, export, features_in_metres, index_json,
};
use serde::Deserialize;
use serde_json::Value;

const TILE: Size = Size {
    width: 257,
    height: 131,
};

#[derive(Deserialize)]
struct Canvas {
    width: usize,
    height: usize,
}

#[derive(Deserialize)]
struct Offset {
    x: usize,
    y: usize,
}

#[derive(Deserialize)]
struct Town {
    canvas: Canvas,
    offset: Offset,
    region: [f64; 4],
    heights: [f64; 2],
}

#[derive(Deserialize)]
struct PayloadGolden {
    index: u32,
    fnv1a: u32,
    bytes: usize,
}

#[derive(Deserialize)]
struct Golden {
    houses: Vec<Value>,
    payloads: Vec<PayloadGolden>,
    index_fnv1a: u32,
    index_bytes: usize,
}

const INPUT: &str = include_str!("fixtures/town-input.json");

fn golden() -> Golden {
    serde_json::from_str(include_str!("fixtures/town-golden.json")).expect("town golden")
}

/// A tile buffer copied into the empty canvas at the offset, as `parity.ts` does.
fn on_canvas(tile: &[u8], town: &Town, channels: usize) -> Vec<u8> {
    let row_bytes = TILE.width * channels;
    let mut out = vec![0u8; town.canvas.width * town.canvas.height * channels];
    for (row, line) in tile.chunks_exact(row_bytes).enumerate() {
        let to = ((town.offset.y + row) * town.canvas.width + town.offset.x) * channels;
        out[to..to + row_bytes].copy_from_slice(line);
    }
    out
}

struct Built {
    rgb: Vec<u8>,
    classes: Vec<u8>,
    size: Size,
    layer: BlocksLayer,
    spec: HouseSpec,
}

fn built() -> Built {
    let town: Town = serde_json::from_str(INPUT).expect("town input");
    let size = Size {
        width: town.canvas.width,
        height: town.canvas.height,
    };
    Built {
        rgb: on_canvas(include_bytes!("fixtures/town-257x131.rgb"), &town, 3),
        classes: on_canvas(
            include_bytes!("fixtures/town-classes-257x131.bin"),
            &town,
            1,
        ),
        size,
        layer: serde_json::from_str(INPUT).expect("blocks layer"),
        spec: HouseSpec {
            region: town.region,
            heights: town.heights,
        },
    }
}

/// The houses layer file Rust writes for the town.
fn houses_text(town: &Built) -> String {
    let raster = HouseRaster {
        rgb: &town.rgb,
        classes: &town.classes,
        size: town.size,
        metres_per_pixel: town.layer.metres_per_pixel,
    };
    let houses = generate_houses(&raster, &town.layer, &town.spec);
    houses_json(&houses, town.layer.metres_per_pixel)
}

/// Equal JSON, except `rotation_radians`, an atan2 result V8 and Rust may round 1 ulp apart.
fn assert_same(ours: &Value, theirs: &Value, path: &str) {
    match (ours, theirs) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (key, value) in a {
                assert_same(value, &b[key], &format!("{path}.{key}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path} length");
            for (at, (x, y)) in a.iter().zip(b).enumerate() {
                assert_same(x, y, &format!("{path}[{at}]"));
            }
        }
        (Value::Number(a), Value::Number(b)) if path.ends_with("rotation_radians") => {
            let ulps = ulps_apart(a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!(ulps <= 1, "{path}: {a} vs {b}");
        }
        _ => assert_eq!(ours, theirs, "{path}"),
    }
}

#[test]
fn town_houses_match_typescript() {
    let text = houses_text(&built());
    assert!(text.ends_with('\n'));
    let ours: Value = serde_json::from_str(&text).expect("houses json");
    let theirs = Value::Array(golden().houses);
    assert!(!golden().houses.is_empty(), "the golden must hold houses");
    assert_same(&ours["houses"], &theirs, "houses");
}

#[test]
fn town_sectors_and_index_match_typescript() {
    let town = built();
    let layer: HousesLayer = serde_json::from_str(&houses_text(&town)).expect("houses layer");
    let raster = ClassRaster {
        classes: &town.classes,
        size: town.size,
    };
    let features = features_in_metres(&raster, layer.metres_per_pixel, FEATURE_SEED);
    let grid = SectorGrid::new(town.size, layer.metres_per_pixel);
    let (payloads, index) = export(grid, &layer.houses, &features);
    let expected = golden();
    assert_eq!(payloads.len(), expected.payloads.len(), "sector count");
    assert!(
        expected.payloads.len() > 1,
        "the town must straddle sector lines"
    );
    for (payload, want) in payloads.iter().zip(&expected.payloads) {
        assert_eq!(payload.index, want.index);
        assert_eq!(
            payload.bytes.len(),
            want.bytes,
            "sector {} size",
            want.index
        );
        assert_eq!(
            fnv1a(&payload.bytes),
            want.fnv1a,
            "sector {} bytes",
            want.index
        );
    }
    let text = index_json(&index);
    assert_eq!(text.len(), expected.index_bytes);
    assert_eq!(fnv1a(text.as_bytes()), expected.index_fnv1a);
}
