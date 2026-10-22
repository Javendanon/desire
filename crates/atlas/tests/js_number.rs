//! `js::number` against what `JSON.stringify` prints (values checked in Node 24).

use desire_atlas::js::number;

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
