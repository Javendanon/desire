//! Writing and reading `desire.sector-render/1`. Every offset, stride and kind comes from
//! `layout.rs`, generated from `contracts/sector-render.json`: this file holds no layout numbers
//! of its own. Readers skip unknown kinds and read only the known leading fields of a wider
//! stride. Reading checks structure only (bounds, alignment, strides); value constraints are
//! checked where payloads are made, by `tools/contracts/sector.py --validate`
//! (docs/waterdeep-3d/sector-format.md, "Two levels of checking").

use super::layout::*;
use super::{Berth, House, Sector, SectorFormatError, Tree};

/// One entry of the section table.
struct Section {
    kind: u32,
    count: usize,
    stride: usize,
    offset: usize,
}

/// A record kind of the payload: how one record is laid out at its offset. Sections are
/// written and read by the same generic walk, whatever the kind.
trait Record: Sized {
    fn write(&self, out: &mut [u8], at: usize);
    fn read(bytes: &[u8], at: usize) -> Self;
}

impl Record for House {
    fn write(&self, out: &mut [u8], at: usize) {
        put_u32(out, at + HOUSES_ID, self.id);
        put_f32(out, at + HOUSES_X_M, self.x_m);
        put_f32(out, at + HOUSES_Z_M, self.z_m);
        put_f32(out, at + HOUSES_WIDTH_M, self.width_m);
        put_f32(out, at + HOUSES_DEPTH_M, self.depth_m);
        put_f32(out, at + HOUSES_ROTATION_RADIANS, self.rotation_radians);
        put_f32(out, at + HOUSES_HEIGHT_M, self.height_m);
        out[at + HOUSES_ROOF_RGB..at + HOUSES_ROOF_RGB + 3].copy_from_slice(&self.roof_rgb);
        out[at + HOUSES_FLAGS] = if self.frontage {
            HOUSES_FRONTAGE_BIT
        } else {
            0
        };
    }

    fn read(bytes: &[u8], at: usize) -> Self {
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
}

impl Record for Berth {
    fn write(&self, out: &mut [u8], at: usize) {
        put_f32(out, at + BERTHS_X_M, self.x_m);
        put_f32(out, at + BERTHS_Z_M, self.z_m);
        put_f32(out, at + BERTHS_HEADING_RADIANS, self.heading_radians);
    }

    fn read(bytes: &[u8], at: usize) -> Self {
        Berth {
            x_m: f32_at(bytes, at + BERTHS_X_M),
            z_m: f32_at(bytes, at + BERTHS_Z_M),
            heading_radians: f32_at(bytes, at + BERTHS_HEADING_RADIANS),
        }
    }
}

impl Record for Tree {
    fn write(&self, out: &mut [u8], at: usize) {
        put_f32(out, at + TREES_X_M, self.x_m);
        put_f32(out, at + TREES_Z_M, self.z_m);
        put_f32(out, at + TREES_SCALE, self.scale);
    }

    fn read(bytes: &[u8], at: usize) -> Self {
        Tree {
            x_m: f32_at(bytes, at + TREES_X_M),
            z_m: f32_at(bytes, at + TREES_Z_M),
            scale: f32_at(bytes, at + TREES_SCALE),
        }
    }
}

impl Section {
    /// Byte offset of each record, in order.
    fn records(&self) -> impl Iterator<Item = usize> + '_ {
        (0..self.count).map(|record| self.offset + record * self.stride)
    }

    fn write_entry(&self, out: &mut [u8], at: usize) {
        put_u32(out, at + ENTRY_KIND, self.kind);
        put_u32(out, at + ENTRY_COUNT, to_u32(self.count));
        put_u32(out, at + ENTRY_STRIDE, to_u32(self.stride));
        put_u32(out, at + ENTRY_OFFSET, to_u32(self.offset));
    }

    fn write<T: Record>(&self, out: &mut [u8], items: &[T]) {
        items
            .iter()
            .zip(self.records())
            .for_each(|(item, at)| item.write(out, at));
    }

    fn read<'a, T: Record>(&'a self, bytes: &'a [u8]) -> impl Iterator<Item = T> + 'a {
        self.records().map(move |at| T::read(bytes, at))
    }
}

/// Serialises a sector. Sections are written in kind order with their known strides.
/// O(records).
pub fn write_sector(sector: &Sector) -> Vec<u8> {
    let sections = layout(sector);
    let last = sections.last().expect("three known kinds");
    let mut out = vec![0; last.offset + last.count * last.stride];
    write_header(&mut out, sector, sections.len());
    for (number, section) in sections.iter().enumerate() {
        section.write_entry(&mut out, HEADER_BYTES + number * ENTRY_BYTES);
    }
    sections[0].write(&mut out, &sector.houses);
    sections[1].write(&mut out, &sector.berths);
    sections[2].write(&mut out, &sector.trees);
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

fn put_u32(out: &mut [u8], at: usize, value: u32) {
    out[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

fn put_f32(out: &mut [u8], at: usize, value: f32) {
    put_u32(out, at, value.to_bits());
}

/// The magic and the major version, before anything else is trusted.
fn check_identity(bytes: &[u8]) -> Result<(), SectorFormatError> {
    if bytes.len() < HEADER_VERSION + 2 {
        return Err(SectorFormatError::Truncated);
    }
    if &bytes[HEADER_MAGIC..HEADER_MAGIC + MAGIC.len()] != MAGIC {
        return Err(SectorFormatError::BadMagic);
    }
    match u16_at(bytes, HEADER_VERSION) {
        VERSION => Ok(()),
        version => Err(SectorFormatError::UnsupportedVersion { version }),
    }
}

/// Parses and validates a sector payload. O(bytes).
pub fn read_sector(bytes: &[u8]) -> Result<Sector, SectorFormatError> {
    check_identity(bytes)?;
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

/// Appends a validated section's records. Unknown kinds are skipped.
fn read_section(bytes: &[u8], section: &Section, sector: &mut Sector) {
    match section.kind {
        HOUSES_KIND => sector.houses.extend(section.read(bytes)),
        BERTHS_KIND => sector.berths.extend(section.read(bytes)),
        TREES_KIND => sector.trees.extend(section.read(bytes)),
        _ => {}
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
