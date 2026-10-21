//! Parity with the TypeScript pipeline: each stage gives the reference result that
//! `tools/assets/parity.ts` recorded in `fixtures/parity.json` from the same input.

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
