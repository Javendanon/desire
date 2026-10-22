//! `desire.sector-render/1` (docs/waterdeep-3d/sector-format.md) against a fixture built
//! independently from the spec, so Rust, TypeScript and the spec must all agree byte for byte.

use desire_core::sector::{Berth, House, Sector, SectorFormatError, read_sector, write_sector};

const FIXTURE: &[u8] = include_bytes!("fixtures/sector-v1.bin");

fn sample() -> Sector {
    Sector {
        index: 7,
        origin_x_m: 512.5,
        origin_z_m: 1024.0,
        size_m: 479.5,
        houses: vec![
            House {
                id: 0x0003_0002,
                x_m: 600.25,
                z_m: 1100.5,
                width_m: 6.5,
                depth_m: 9.75,
                rotation_radians: 1.5,
                height_m: 7.25,
                roof_rgb: [120, 90, 70],
                frontage: true,
            },
            House {
                id: 0x0003_0003,
                x_m: 610.0,
                z_m: 1101.0,
                width_m: 5.0,
                depth_m: 8.0,
                rotation_radians: -0.25,
                height_m: 4.0,
                roof_rgb: [90, 100, 110],
                frontage: false,
            },
        ],
        berths: vec![Berth {
            x_m: 700.5,
            z_m: 1200.25,
            heading_radians: 3.0,
        }],
        trees: vec![],
    }
}

#[test]
fn writing_the_sample_gives_the_fixture_bytes() {
    assert_eq!(write_sector(&sample()), FIXTURE);
}

#[test]
fn reading_the_fixture_gives_the_sample() {
    assert_eq!(read_sector(FIXTURE), Ok(sample()));
}

#[test]
fn a_written_sector_reads_back_unchanged() {
    let mut sector = sample();
    sector.trees.push(desire_core::sector::Tree {
        x_m: 1.5,
        z_m: 2.5,
        scale: 0.75,
    });
    assert_eq!(read_sector(&write_sector(&sector)), Ok(sector));
}

#[test]
fn wrong_magic_version_and_truncation_are_rejected() {
    let mut bad_magic = FIXTURE.to_vec();
    bad_magic[0] = b'X';
    assert_eq!(read_sector(&bad_magic), Err(SectorFormatError::BadMagic));

    let mut future = FIXTURE.to_vec();
    future[4] = 2;
    assert_eq!(
        read_sector(&future),
        Err(SectorFormatError::UnsupportedVersion { version: 2 })
    );

    assert_eq!(
        read_sector(&FIXTURE[..20]),
        Err(SectorFormatError::Truncated)
    );
    assert_eq!(
        read_sector(&FIXTURE[..60]),
        Err(SectorFormatError::Truncated)
    );
    assert!(matches!(
        read_sector(&FIXTURE[..150]),
        Err(SectorFormatError::SectionOutOfBounds { kind: 2 })
    ));
}

#[test]
fn misaligned_or_too_narrow_sections_are_rejected() {
    let mut misaligned = FIXTURE.to_vec();
    misaligned[44] = 0x51; // houses offset 80 → 81
    assert_eq!(
        read_sector(&misaligned),
        Err(SectorFormatError::Misaligned { kind: 1 })
    );

    let mut narrow = FIXTURE.to_vec();
    narrow[40] = 16; // houses stride 32 → 16
    assert_eq!(
        read_sector(&narrow),
        Err(SectorFormatError::StrideTooSmall { kind: 1 })
    );
}

#[test]
fn unknown_kinds_are_skipped_and_wider_strides_read_their_known_fields() {
    // Kind 3 (trees, empty) relabelled as an unknown kind 9: it must be ignored.
    let mut unknown = FIXTURE.to_vec();
    unknown[64] = 9;
    assert_eq!(read_sector(&unknown), Ok(sample()));

    // Berths written with a 16-byte stride (a future field appended): known fields still read.
    let mut wider = FIXTURE[..144].to_vec();
    wider.extend_from_slice(&FIXTURE[144..156]);
    wider.extend_from_slice(&[0xAA; 4]);
    wider[56] = 16; // berths stride 12 → 16
    wider[76] = 0xA0; // empty trees section moves to 160
    assert_eq!(read_sector(&wider), Ok(sample()));
}
