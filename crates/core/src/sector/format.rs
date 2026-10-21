//! Writing and reading `desire.sector-render/1`. Every offset, stride and kind comes from
//! `layout.rs`, generated from `contracts/sector-render.json`: this file holds no layout numbers
//! of its own. Readers skip unknown kinds and read only the known leading fields of a wider
//! stride.

use super::layout::*;
use super::{Berth, House, Sector, SectorFormatError, Tree};

/// One entry of the section table.
struct Section {
    kind: u32,
    count: usize,
    stride: usize,
    offset: usize,
}

/// Serialises a sector. Sections are written in kind order with their known strides.
/// O(records).
pub fn write_sector(sector: &Sector) -> Vec<u8> {
    let sections = layout(sector);
    let last = sections.last().expect("three known kinds");
    let mut out = vec![0; last.offset + last.count * last.stride];
    write_header(&mut out, sector, sections.len());
    for (number, section) in sections.iter().enumerate() {
        let at = HEADER_BYTES + number * ENTRY_BYTES;
        put_u32(&mut out, at + ENTRY_KIND, section.kind);
        put_u32(&mut out, at + ENTRY_COUNT, to_u32(section.count));
        put_u32(&mut out, at + ENTRY_STRIDE, to_u32(section.stride));
        put_u32(&mut out, at + ENTRY_OFFSET, to_u32(section.offset));
    }
    let [houses, berths, trees] = [0, 1, 2].map(|kind| &sections[kind]);
    for (record, house) in sector.houses.iter().enumerate() {
        write_house(&mut out, houses.offset + record * houses.stride, house);
    }
    for (record, berth) in sector.berths.iter().enumerate() {
        let at = berths.offset + record * berths.stride;
        put_f32(&mut out, at + BERTHS_X_M, berth.x_m);
        put_f32(&mut out, at + BERTHS_Z_M, berth.z_m);
        put_f32(&mut out, at + BERTHS_HEADING_RADIANS, berth.heading_radians);
    }
    for (record, tree) in sector.trees.iter().enumerate() {
        let at = trees.offset + record * trees.stride;
        put_f32(&mut out, at + TREES_X_M, tree.x_m);
        put_f32(&mut out, at + TREES_Z_M, tree.z_m);
        put_f32(&mut out, at + TREES_SCALE, tree.scale);
    }
    out
}

fn layout(sector: &Sector) -> Vec<Section> {
    let kinds = [
        (HOUSES_KIND, sector.houses.len(), HOUSES_STRIDE),
        (BERTHS_KIND, sector.berths.len(), BERTHS_STRIDE),
        (TREES_KIND, sector.trees.len(), TREES_STRIDE),
    ];
    let mut offset = HEADER_BYTES + kinds.len() * ENTRY_BYTES;
    kinds
        .into_iter()
        .map(|(kind, count, stride)| {
            let section = Section {
                kind,
                count,
                stride,
                offset,
            };
            offset += count * stride;
            section
        })
        .collect()
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).expect("sector payloads stay far below 4 GiB")
}

fn write_header(out: &mut [u8], sector: &Sector, sections: usize) {
    out[HEADER_MAGIC..HEADER_MAGIC + MAGIC.len()].copy_from_slice(MAGIC);
    let count = u16::try_from(sections).expect("a handful of section kinds");
    out[HEADER_VERSION..HEADER_VERSION + 2].copy_from_slice(&VERSION.to_le_bytes());
    out[HEADER_SECTION_COUNT..HEADER_SECTION_COUNT + 2].copy_from_slice(&count.to_le_bytes());
    put_u32(out, HEADER_INDEX, sector.index);
    put_f32(out, HEADER_ORIGIN_X_M, sector.origin_x_m);
    put_f32(out, HEADER_ORIGIN_Z_M, sector.origin_z_m);
    put_f32(out, HEADER_SIZE_M, sector.size_m);
}

fn write_house(out: &mut [u8], at: usize, house: &House) {
    put_u32(out, at + HOUSES_ID, house.id);
    put_f32(out, at + HOUSES_X_M, house.x_m);
    put_f32(out, at + HOUSES_Z_M, house.z_m);
    put_f32(out, at + HOUSES_WIDTH_M, house.width_m);
    put_f32(out, at + HOUSES_DEPTH_M, house.depth_m);
    put_f32(out, at + HOUSES_ROTATION_RADIANS, house.rotation_radians);
    put_f32(out, at + HOUSES_HEIGHT_M, house.height_m);
    out[at + HOUSES_ROOF_RGB..at + HOUSES_ROOF_RGB + 3].copy_from_slice(&house.roof_rgb);
    out[at + HOUSES_FLAGS] = if house.frontage {
        HOUSES_FRONTAGE_BIT
    } else {
        0
    };
}

fn put_u32(out: &mut [u8], at: usize, value: u32) {
    out[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_f32(out: &mut [u8], at: usize, value: f32) {
    put_u32(out, at, value.to_bits());
}

/// Parses and validates a sector payload. O(bytes).
pub fn read_sector(bytes: &[u8]) -> Result<Sector, SectorFormatError> {
    if bytes.len() < HEADER_VERSION + 2 {
        return Err(SectorFormatError::Truncated);
    }
    if &bytes[HEADER_MAGIC..HEADER_MAGIC + MAGIC.len()] != MAGIC {
        return Err(SectorFormatError::BadMagic);
    }
    let version = u16_at(bytes, HEADER_VERSION);
    if version != VERSION {
        return Err(SectorFormatError::UnsupportedVersion { version });
    }
    if bytes.len() < HEADER_BYTES {
        return Err(SectorFormatError::Truncated);
    }
    let mut sector = Sector {
        index: u32_at(bytes, HEADER_INDEX),
        origin_x_m: f32_at(bytes, HEADER_ORIGIN_X_M),
        origin_z_m: f32_at(bytes, HEADER_ORIGIN_Z_M),
        size_m: f32_at(bytes, HEADER_SIZE_M),
        houses: Vec::new(),
        berths: Vec::new(),
        trees: Vec::new(),
    };
    for section in section_table(bytes)? {
        read_section(bytes, &section, &mut sector);
    }
    Ok(sector)
}

fn section_table(bytes: &[u8]) -> Result<Vec<Section>, SectorFormatError> {
    let count = usize::from(u16_at(bytes, HEADER_SECTION_COUNT));
    if bytes.len() < HEADER_BYTES + count * ENTRY_BYTES {
        return Err(SectorFormatError::Truncated);
    }
    (0..count)
        .map(|entry| {
            let at = HEADER_BYTES + entry * ENTRY_BYTES;
            let section = Section {
                kind: u32_at(bytes, at + ENTRY_KIND),
                count: u32_at(bytes, at + ENTRY_COUNT) as usize,
                stride: u32_at(bytes, at + ENTRY_STRIDE) as usize,
                offset: u32_at(bytes, at + ENTRY_OFFSET) as usize,
            };
            validate(bytes, &section).map(|()| section)
        })
        .collect()
}

fn known_stride(kind: u32) -> Option<usize> {
    match kind {
        HOUSES_KIND => Some(HOUSES_STRIDE),
        BERTHS_KIND => Some(BERTHS_STRIDE),
        TREES_KIND => Some(TREES_STRIDE),
        _ => None,
    }
}

fn validate(bytes: &[u8], section: &Section) -> Result<(), SectorFormatError> {
    let kind = section.kind;
    if !section.offset.is_multiple_of(ALIGNMENT) {
        return Err(SectorFormatError::Misaligned { kind });
    }
    if known_stride(kind).is_some_and(|minimum| section.stride < minimum) {
        return Err(SectorFormatError::StrideTooSmall { kind });
    }
    let end = section
        .count
        .checked_mul(section.stride)
        .and_then(|length| length.checked_add(section.offset));
    match end {
        Some(end) if end <= bytes.len() => Ok(()),
        _ => Err(SectorFormatError::SectionOutOfBounds { kind }),
    }
}

/// Appends a validated section's records; unknown kinds are skipped.
fn read_section(bytes: &[u8], section: &Section, sector: &mut Sector) {
    let records = (0..section.count).map(|record| section.offset + record * section.stride);
    match section.kind {
        HOUSES_KIND => sector
            .houses
            .extend(records.map(|at| read_house(bytes, at))),
        BERTHS_KIND => sector.berths.extend(records.map(|at| Berth {
            x_m: f32_at(bytes, at + BERTHS_X_M),
            z_m: f32_at(bytes, at + BERTHS_Z_M),
            heading_radians: f32_at(bytes, at + BERTHS_HEADING_RADIANS),
        })),
        TREES_KIND => sector.trees.extend(records.map(|at| Tree {
            x_m: f32_at(bytes, at + TREES_X_M),
            z_m: f32_at(bytes, at + TREES_Z_M),
            scale: f32_at(bytes, at + TREES_SCALE),
        })),
        _ => {}
    }
}

fn read_house(bytes: &[u8], at: usize) -> House {
    let rgb = at + HOUSES_ROOF_RGB;
    House {
        id: u32_at(bytes, at + HOUSES_ID),
        x_m: f32_at(bytes, at + HOUSES_X_M),
        z_m: f32_at(bytes, at + HOUSES_Z_M),
        width_m: f32_at(bytes, at + HOUSES_WIDTH_M),
        depth_m: f32_at(bytes, at + HOUSES_DEPTH_M),
        rotation_radians: f32_at(bytes, at + HOUSES_ROTATION_RADIANS),
        height_m: f32_at(bytes, at + HOUSES_HEIGHT_M),
        roof_rgb: [bytes[rgb], bytes[rgb + 1], bytes[rgb + 2]],
        frontage: bytes[at + HOUSES_FLAGS] & HOUSES_FRONTAGE_BIT != 0,
    }
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

fn f32_at(bytes: &[u8], at: usize) -> f32 {
    f32::from_bits(u32_at(bytes, at))
}
