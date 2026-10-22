//! JavaScript's numeric primitives where Rust's differ, so ported arithmetic rounds the same way.
//!
//! Transcendentals (`tan`, `cos`, `log`) are deliberately not matched: V8 mixes fdlibm and
//! glibc-derived code, and neither the platform libm nor the `libm` crate reproduces it for
//! every input. The difference reaches ~10⁻⁸ px in the Mercator frame, and the full-map parity
//! check confirms it changes no pixel of the urban mask or the streets.

/// `Math.round`: the nearest integer, halves toward +∞ (Rust's `round` sends them away from 0).
pub fn round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `Math.hypot` as V8 computes it: scaled by the largest magnitude, squares summed with Kahan
/// compensation. `f64::hypot` can differ in the last bit, which moves a sample across a pixel.
pub fn hypot(values: &[f64]) -> f64 {
    // V8 first: any ±Infinity wins, even beside NaN; then NaN propagates.
    if values.iter().any(|value| value.is_infinite()) {
        return f64::INFINITY;
    }
    if values.iter().any(|value| value.is_nan()) {
        return f64::NAN;
    }
    let largest = values
        .iter()
        .fold(0.0f64, |max, value| max.max(value.abs()));
    if largest == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for value in values {
        let ratio = value / largest;
        let summand = ratio * ratio - compensation;
        let next = sum + summand;
        compensation = (next - sum) - summand;
        sum = next;
    }
    sum.sqrt() * largest
}

/// `degrees * Math.PI / 180`, in that order (`to_radians` multiplies by a rounded constant).
pub fn to_radians(degrees: f64) -> f64 {
    degrees * std::f64::consts::PI / 180.0
}

/// `values.sort((a, b) => a - b)[floor(length / 2)]`: the upper median. Panics when empty.
pub fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

/// A number as `JSON.stringify` writes it: shortest round-trip digits, integers without a
/// decimal point, magnitudes below 1e-6 or from 1e21 in exponent form (`-1.2e-17`, `1e+21`).
pub fn number(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_owned();
    }
    let magnitude = value.abs();
    if value != 0.0 && !(1e-6..1e21).contains(&magnitude) {
        let text = format!("{value:e}");
        return if magnitude >= 1e21 {
            text.replace('e', "e+")
        } else {
            text
        };
    }
    // `Display` prints integral values without a decimal point. Only −0 differs: JS prints 0.
    if value == 0.0 {
        "0".to_owned()
    } else {
        format!("{value}")
    }
}
