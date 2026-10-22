//! `atlas`: command-line entry of the offline map pipeline.
//!
//! - `atlas classify <map> <out>`: unrefined per-pixel surface classes, one byte per pixel.
//! - `atlas extract <map> <wards> <streets> <zoom> <west> <north> <classes> <blocks>`: refined
//!   surfaces and traced city blocks, the TypeScript `extract-surfaces` outputs (`classes.bin`,
//!   `blocks.json`), byte for byte.
//! - `atlas houses <blocks> <classes> <map> <left,top,width,height> <min,max> <out>`: houses of
//!   the blocks in a region, as the TypeScript `generate-houses` writes them.
//! - `atlas sectors <houses> <classes> <map-width> <out-dir>`: sector payloads and `index.json`,
//!   as the TypeScript `export-sectors` writes them.
//! - `atlas ground <classes> <map-width> <metres-per-pixel> <out-dir>`: ground tiles along the
//!   sector grid (`ground.json`, `<index>.jpg`, `<index>.heights.bin`).

use std::{env, process::ExitCode};

mod cli;

use cli::{classify, extract, ground, houses, sectors};

type Run = fn(&[String]) -> Result<(), String>;

/// Command table: name, argument names (for usage), and what it runs.
const COMMANDS: [(&str, &[&str], Run); 5] = [
    ("classify", &["map", "out"], classify),
    (
        "extract",
        &[
            "map", "wards", "streets", "zoom", "west", "north", "classes", "blocks",
        ],
        extract,
    ),
    (
        "houses",
        &["blocks", "classes", "map", "region", "heights", "out"],
        houses,
    ),
    (
        "sectors",
        &["houses", "classes", "map-width", "out-dir"],
        sectors,
    ),
    (
        "ground",
        &["classes", "map-width", "metres-per-pixel", "out-dir"],
        ground,
    ),
];

fn usage() -> String {
    let lines: Vec<String> = COMMANDS
        .iter()
        .map(|(name, args, _)| format!("  atlas {name} <{}>", args.join("> <")))
        .collect();
    format!("usage:\n{}", lines.join("\n"))
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = COMMANDS.iter().find(|(name, params, _)| {
        args.first() == Some(&name.to_string()) && args.len() == params.len() + 1
    });
    let result = match command {
        Some((_, _, run)) => run(&args[1..]),
        None => Err(usage()),
    };
    result.map_or_else(
        |message| {
            eprintln!("atlas: {message}");
            ExitCode::FAILURE
        },
        |()| ExitCode::SUCCESS,
    )
}
