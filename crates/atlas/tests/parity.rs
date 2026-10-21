//! Parity with the TypeScript pipeline: each stage gives the reference result that
//! `tools/assets/parity.ts` recorded in `fixtures/parity.json` from the same input.

use desire_atlas::raster_ops::{Size, components, dilate, erode, majority};
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
