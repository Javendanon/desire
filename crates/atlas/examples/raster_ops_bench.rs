//! Times the raster operations on a real class raster and writes their results, so they can be
//! compared byte for byte with the TypeScript pipeline's. Usage:
//! `cargo run --release -p desire-atlas --example raster_ops_bench --`
//! `<classes.bin> <width> <out-dir>`

use std::{env, fs, path::Path, time::Instant};

use desire_atlas::raster_ops::{Size, components, dilate, erode, majority};

fn timed<T>(label: &str, run: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = run();
    println!(
        "{label:<18} {:>8.0} ms",
        start.elapsed().as_secs_f64() * 1000.0
    );
    result
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let [input, width, out] = args.as_slice() else {
        panic!("usage: raster_ops_bench <classes.bin> <width> <out-dir>");
    };
    let classes = fs::read(input).expect("readable class raster");
    let width: usize = width.parse().expect("width in pixels");
    let size = Size {
        width,
        height: classes.len() / width,
    };
    let water: Vec<u8> = classes.iter().map(|&class| u8::from(class == 1)).collect();
    let out = Path::new(out);
    let write = |name: &str, bytes: &[u8]| fs::write(out.join(name), bytes).expect("writable");
    write(
        "majority-r2.bin",
        &timed("majority r2", || majority(&classes, size, 2)),
    );
    write(
        "dilate-r20.bin",
        &timed("dilate r20", || dilate(&water, size, 20)),
    );
    write(
        "erode-r20.bin",
        &timed("erode r20", || erode(&water, size, 20)),
    );
    let found = timed("components water", || components(&water, size));
    let labels: Vec<u8> = found
        .labels
        .iter()
        .flat_map(|label| label.to_le_bytes())
        .collect();
    write("components-water.bin", &labels);
}
