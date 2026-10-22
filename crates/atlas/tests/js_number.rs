//! `js::number` against what `JSON.stringify` prints (values checked in Node 24).

use desire_atlas::js::{self, number};

#[test]
fn numbers_print_as_json_stringify_does() {
    let cases = [
        (0.0, "0"),
        (-0.0, "0"),
        (1052.0, "1052"),
        (810.78, "810.78"),
        (0.1 + 0.2, "0.30000000000000004"),
        (-1.1901059570443138, "-1.1901059570443138"),
        (-1.2e-17, "-1.2e-17"),
        (0.000001, "0.000001"),
        (5e-7, "5e-7"),
        (1e21, "1e+21"),
        (123456789012345680000.0, "123456789012345680000"),
    ];
    for (value, expected) in cases {
        assert_eq!(number(value), expected, "{value:?}");
    }
}

#[test]
fn non_finite_numbers_write_as_json_null() {
    // `JSON.stringify` writes NaN and ±Infinity as null.
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(js::number(value), "null", "{value}");
    }
}

#[test]
fn hypot_with_an_infinity_is_infinite_even_beside_nan() {
    // V8: any ±Infinity argument wins over NaN; otherwise NaN propagates.
    assert_eq!(js::hypot(&[f64::INFINITY, f64::NAN]), f64::INFINITY);
    assert_eq!(js::hypot(&[f64::NAN, f64::NEG_INFINITY]), f64::INFINITY);
    assert!(js::hypot(&[f64::NAN, 3.0]).is_nan());
    assert_eq!(js::hypot(&[3.0, 4.0]), 5.0);
}
