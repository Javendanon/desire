//! Reads every `*.render.bin` in a directory and prints its counts: a cross-check that the
//! sectors the TypeScript pipeline writes parse in Rust. Usage:
//! `cargo run -p desire-core --example sector_stats -- <sectors-dir>`

use std::{env, fs, path::PathBuf, process::ExitCode};

use desire_core::sector::{Sector, read_sector};

/// The sector payloads of a directory, in path order.
fn payloads(directory: &str) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(directory).map_err(|error| format!("{directory}: {error}"))?;
    let mut paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.to_string_lossy().ends_with(".render.bin"))
        .collect();
    paths.sort();
    Ok(paths)
}

fn read(path: &PathBuf) -> Result<Sector, String> {
    let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    read_sector(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

fn summary(directory: &str) -> Result<String, String> {
    let sectors = payloads(directory)?
        .iter()
        .map(read)
        .collect::<Result<Vec<_>, _>>()?;
    let total = |count: fn(&Sector) -> usize| sectors.iter().map(count).sum::<usize>();
    Ok(format!(
        "{} sectors: {} houses, {} berths, {} trees",
        sectors.len(),
        total(|sector| sector.houses.len()),
        total(|sector| sector.berths.len()),
        total(|sector| sector.trees.len())
    ))
}

fn main() -> ExitCode {
    let Some(directory) = env::args().nth(1) else {
        eprintln!("usage: sector_stats <sectors-dir>");
        return ExitCode::FAILURE;
    };
    match summary(&directory) {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
