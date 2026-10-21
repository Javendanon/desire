//! Colours measured on the Tych Waterdeep raster (9 × 9 means at known points), as in
//! `tools/assets/tests/raster-surface.test.ts`.

use desire_atlas::surface::{Surface, classify_pixel, classify_rgb};

#[test]
fn measured_colours_classify_as_measured() {
    let samples = [
        ("deep water", [35, 66, 77], Surface::Water),
        ("shallow water, blue equal to red", [134, 152, 130], Surface::Water),
        ("shallow water, blue below red", [130, 147, 128], Surface::Water),
        ("paved road", [142, 136, 130], Surface::Street),
        ("brown roof", [86, 73, 67], Surface::Roof),
        ("red landmark roof", [190, 70, 50], Surface::RedRoof),
        ("drawn outline", [26, 7, 2], Surface::Outline),
        ("vegetation is green but not water", [90, 120, 60], Surface::Ground),
        ("yellow courtyard (North Ward)", [168, 155, 101], Surface::Garden),
        ("slate roof (North Ward)", [64, 67, 73], Surface::Ground),
    ];
    for (name, [r, g, b], expected) in samples {
        assert_eq!(classify_pixel(r, g, b), expected, "{name}");
    }
}

#[test]
fn a_dirt_lane_reads_as_roof_by_colour_alone() {
    assert_eq!(classify_pixel(118, 108, 96), Surface::Roof);
    assert_eq!(classify_pixel(73, 55, 48), Surface::Roof);
}

#[test]
fn a_buffer_classifies_pixel_by_pixel_in_row_major_order() {
    let rgb = [35, 66, 77, 86, 73, 67, 142, 136, 130, 26, 7, 2];
    let expected = [Surface::Water, Surface::Roof, Surface::Street, Surface::Outline];
    assert_eq!(classify_rgb(&rgb), expected.map(|surface| surface as u8));
}
