//! Canonical UUID validation and non-secret request identifiers.
use desire_core::contracts::common::Id;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A canonical textual UUID: 36 characters, lowercase hex, hyphens in the fixed places.
pub fn is_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        let separator = matches!(index, 8 | 13 | 18 | 23);
        if separator {
            *byte == b'-'
        } else {
            matches!(byte, b'0'..=b'9' | b'a'..=b'f')
        }
    })
}

pub fn validate(value: &str, field: &str) -> Result<Id, String> {
    if is_id(value) {
        Ok(value.to_string())
    } else {
        Err(format!("{field} must be a canonical lowercase UUID"))
    }
}

/// Request IDs are operational correlation values, not authentication material.
pub fn request_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or_default();
    let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
    let high = nanos ^ (sequence << 32);
    let low = sequence.rotate_left(17) ^ 0x9e37_79b9_7f4a_7c15;
    let time_high = (high >> 32) as u32;
    let time_low = (high & 0xffff) as u16;
    let version = 0x4000 | ((low >> 48) & 0x0fff) as u16;
    let variant = 0x8000 | ((low >> 32) & 0x3fff) as u16;
    let tail = low & 0xffff_ffff_ffff;
    format!("{time_high:08x}-{time_low:04x}-{version:04x}-{variant:04x}-{tail:012x}")
}
