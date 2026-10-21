//! Byte layout of `desire.sector-render/1`: a 32-byte header, a table of 16-byte section entries,
//! then fixed-stride records. Little-endian, every section 4-byte aligned. Readers skip unknown
//! kinds and read only the known leading fields of a wider stride.

use super::{Berth, House, Sector, SectorFormatError, Tree};

const MAGIC: &[u8; 4] = b"DSEC";
const VERSION: u16 = 1;
const HEADER_BYTES: usize = 32;
const TABLE_ENTRY_BYTES: usize = 16;
const ALIGNMENT: usize = 4;

const KIND_HOUSES: u32 = 1;
const KIND_BERTHS: u32 = 2;
const KIND_TREES: u32 = 3;
const HOUSE_STRIDE: usize = 32;
const POINT_STRIDE: usize = 12;
const FRONTAGE_FLAG: u8 = 1;

/// Serialises a sector. Sections are written in kind order with their known strides.
/// O(records).
pub fn write_sector(sector: &Sector) -> Vec<u8> {
    let sections = [
        (KIND_HOUSES, sector.houses.len(), HOUSE_STRIDE),
        (KIND_BERTHS, sector.berths.len(), POINT_STRIDE),
        (KIND_TREES, sector.trees.len(), POINT_STRIDE),
    ];
    let table_end = HEADER_BYTES + sections.len() * TABLE_ENTRY_BYTES;
    let body: usize = sections
        .iter()
        .map(|(_, count, stride)| count * stride)
        .sum();
    let mut out = Vec::with_capacity(table_end + body);
    write_header(&mut out, sector, sections.len());
    let mut offset = table_end;
    for (kind, count, stride) in sections {
        for value in [kind, to_u32(count), to_u32(stride), to_u32(offset)] {
            out.extend_from_slice(&value.to_le_bytes());
        }
        offset += count * stride;
    }
    sector
        .houses
        .iter()
        .for_each(|house| write_house(&mut out, house));
    for berth in &sector.berths {
        push_f32s(&mut out, &[berth.x_m, berth.z_m, berth.heading_radians]);
    }
    for tree in &sector.trees {
        push_f32s(&mut out, &[tree.x_m, tree.z_m, tree.scale]);
    }
    out
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).expect("sector payloads stay far below 4 GiB")
}

fn write_header(out: &mut Vec<u8>, sector: &Sector, sections: usize) {
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    let count = u16::try_from(sections).expect("a handful of section kinds");
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&sector.index.to_le_bytes());
    push_f32s(out, &[sector.origin_x_m, sector.origin_z_m, sector.size_m]);
    out.extend_from_slice(&[0; 8]);
}

fn write_house(out: &mut Vec<u8>, house: &House) {
    out.extend_from_slice(&house.id.to_le_bytes());
    push_f32s(
        out,
        &[
            house.x_m,
            house.z_m,
            house.width_m,
            house.depth_m,
            house.rotation_radians,
            house.height_m,
        ],
    );
    out.extend_from_slice(&house.roof_rgb);
    out.push(if house.frontage { FRONTAGE_FLAG } else { 0 });
}

fn push_f32s(out: &mut Vec<u8>, values: &[f32]) {
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

/// One entry of the section table.
struct Section {
    kind: u32,
    count: usize,
    stride: usize,
    offset: usize,
}

/// Parses and validates a sector payload. O(bytes).
pub fn read_sector(bytes: &[u8]) -> Result<Sector, SectorFormatError> {
    if bytes.len() < MAGIC.len() + 2 {
        return Err(SectorFormatError::Truncated);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(SectorFormatError::BadMagic);
    }
    let version = u16_at(bytes, 4);
    if version != VERSION {
        return Err(SectorFormatError::UnsupportedVersion { version });
    }
    if bytes.len() < HEADER_BYTES {
        return Err(SectorFormatError::Truncated);
    }
    let mut sector = Sector {
        index: u32_at(bytes, 8),
        origin_x_m: f32_at(bytes, 12),
        origin_z_m: f32_at(bytes, 16),
        size_m: f32_at(bytes, 20),
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
    let count = usize::from(u16_at(bytes, 6));
    let table_end = HEADER_BYTES + count * TABLE_ENTRY_BYTES;
    if bytes.len() < table_end {
        return Err(SectorFormatError::Truncated);
    }
    (0..count)
        .map(|entry| {
            let at = HEADER_BYTES + entry * TABLE_ENTRY_BYTES;
            let section = Section {
                kind: u32_at(bytes, at),
                count: u32_at(bytes, at + 4) as usize,
                stride: u32_at(bytes, at + 8) as usize,
                offset: u32_at(bytes, at + 12) as usize,
            };
            validate(bytes, &section).map(|()| section)
        })
        .collect()
}

fn known_stride(kind: u32) -> Option<usize> {
    match kind {
        KIND_HOUSES => Some(HOUSE_STRIDE),
        KIND_BERTHS | KIND_TREES => Some(POINT_STRIDE),
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
        KIND_HOUSES => sector
            .houses
            .extend(records.map(|at| read_house(bytes, at))),
        KIND_BERTHS => sector.berths.extend(records.map(|at| Berth {
            x_m: f32_at(bytes, at),
            z_m: f32_at(bytes, at + 4),
            heading_radians: f32_at(bytes, at + 8),
        })),
        KIND_TREES => sector.trees.extend(records.map(|at| Tree {
            x_m: f32_at(bytes, at),
            z_m: f32_at(bytes, at + 4),
            scale: f32_at(bytes, at + 8),
        })),
        _ => {}
    }
}

fn read_house(bytes: &[u8], at: usize) -> House {
    House {
        id: u32_at(bytes, at),
        x_m: f32_at(bytes, at + 4),
        z_m: f32_at(bytes, at + 8),
        width_m: f32_at(bytes, at + 12),
        depth_m: f32_at(bytes, at + 16),
        rotation_radians: f32_at(bytes, at + 20),
        height_m: f32_at(bytes, at + 24),
        roof_rgb: [bytes[at + 28], bytes[at + 29], bytes[at + 30]],
        frontage: bytes[at + 31] & FRONTAGE_FLAG != 0,
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
