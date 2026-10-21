//! Reads every `*.render.bin` in a directory and prints its counts: a cross-check that the
//! sectors the TypeScript pipeline writes parse in Rust. Usage:
//! `cargo run -p desire-core --example sector_stats -- <sectors-dir>`

use std::{env, fs, process::ExitCode};

use desire_core::sector::read_sector;

fn main() -> ExitCode {
    let Some(directory) = env::args().nth(1) else {
        eprintln!("usage: sector_stats <sectors-dir>");
        return ExitCode::FAILURE;
    };
    let mut paths: Vec<_> = match fs::read_dir(&directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.to_string_lossy().ends_with(".render.bin"))
            .collect(),
        Err(error) => {
            eprintln!("{directory}: {error}");
            return ExitCode::FAILURE;
        }
    };
    paths.sort();
    let (mut houses, mut berths, mut trees) = (0, 0, 0);
    for path in &paths {
        let bytes = fs::read(path).expect("listed files are readable");
        match read_sector(&bytes) {
            Ok(sector) => {
                houses += sector.houses.len();
                berths += sector.berths.len();
                trees += sector.trees.len();
            }
            Err(error) => {
                eprintln!("{}: {error}", path.display());
                return ExitCode::FAILURE;
            }
        }
    }
    println!(
        "{} sectors: {houses} houses, {berths} berths, {trees} trees",
        paths.len()
    );
    ExitCode::SUCCESS
}
