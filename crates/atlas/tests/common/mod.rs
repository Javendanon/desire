//! Helpers the parity tests share.

/// FNV-1a, 32 bits, as `tools/assets/parity.ts` computes it.
pub fn fnv1a(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
    })
}

/// How many representable doubles lie between two values (0 when equal). Sign-safe: it
/// compares the ordered integer images of the bit patterns, so +0 and −0 are 0 apart.
pub fn ulps_apart(a: f64, b: f64) -> u64 {
    let ordered = |value: f64| {
        let bits = value.to_bits() as i64;
        if bits < 0 { i64::MIN - bits } else { bits }
    };
    ordered(a).abs_diff(ordered(b))
}
