//! Why a sector payload could not be read.

use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SectorFormatError {
    /// The file does not start with `DSEC`.
    BadMagic,
    /// A major version this reader does not know.
    UnsupportedVersion { version: u16 },
    /// The header or the section table is cut short.
    Truncated,
    /// A section's records run past the end of the file.
    SectionOutOfBounds { kind: u32 },
    /// A section does not start on a multiple of four bytes.
    Misaligned { kind: u32 },
    /// A known section's stride is narrower than its known fields.
    StrideTooSmall { kind: u32 },
}

impl fmt::Display for SectorFormatError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadMagic => write!(formatter, "bad magic"),
            Self::UnsupportedVersion { version } => {
                write!(formatter, "unsupported version {version}")
            }
            Self::Truncated => write!(formatter, "truncated"),
            Self::SectionOutOfBounds { kind } => write!(formatter, "section {kind} out of bounds"),
            Self::Misaligned { kind } => write!(formatter, "section {kind} misaligned"),
            Self::StrideTooSmall { kind } => write!(formatter, "section {kind} stride too small"),
        }
    }
}

impl std::error::Error for SectorFormatError {}
