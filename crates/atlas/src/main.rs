//! `atlas`: command-line entry of the offline map pipeline.
//!
//! `atlas classify <map> <out>` writes the per-pixel surface classes of a source raster,
//! before refinement, one byte per pixel.

use std::{env, fs, path::PathBuf, process::ExitCode, time::Instant};

use desire_atlas::{raster::read_rgb, surface::classify_rgb};

fn classify(map: PathBuf, out: PathBuf) -> Result<(), String> {
    let start = Instant::now();
    let raster = read_rgb(&map).map_err(|error| format!("{}: {error}", map.display()))?;
    let decoded = start.elapsed();
    let classes = classify_rgb(&raster.rgb);
    fs::write(&out, &classes).map_err(|error| format!("{}: {error}", out.display()))?;
    eprintln!(
        "{}: {} × {} px, decoded in {:.2?}, classified in {:.2?}",
        out.display(),
        raster.width,
        raster.height,
        decoded,
        start.elapsed() - decoded
    );
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match args.as_slice() {
        [command, map, out] if command == "classify" => classify(map.into(), out.into()),
        _ => Err("usage: atlas classify <map> <out>".to_owned()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("atlas: {message}");
            ExitCode::FAILURE
        }
    }
}
