//! Runtime flags: absent means the old behaviour, on means the new one, and the file is re-read
//! on every lookup so a flag can be switched off without a restart.

use desire_core::flags::{Flag, FlagError, FlagSource};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

const SECTOR_LABELS: Flag = Flag {
    name: "sector_labels",
    description: "test-only flag: render sector labels",
};

static NEXT_FILE: AtomicUsize = AtomicUsize::new(0);

/// A unique path under the system temp directory; the test removes it when done.
fn temp_path() -> PathBuf {
    let n = NEXT_FILE.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!("desire-flags-{}-{n}.txt", std::process::id()))
}

/// The behaviour under test: what the code does with the flag off and on.
fn label_for(sector: &str, source: &FlagSource) -> Result<String, FlagError> {
    if source.is_on(&SECTOR_LABELS)? {
        return Ok(format!("Sector {sector}"));
    }
    Ok(sector.to_string())
}

#[test]
fn absent_flag_keeps_the_old_behaviour() {
    const { assert!(!Flag::DEFAULT) };
    assert_eq!(
        label_for("Dock Ward", &FlagSource::none()).unwrap(),
        "Dock Ward"
    );
    let missing = FlagSource::file(temp_path());
    assert_eq!(label_for("Dock Ward", &missing).unwrap(), "Dock Ward");
}

#[test]
fn flag_on_enables_the_new_behaviour() {
    let path = temp_path();
    std::fs::write(&path, "# test flags\nsector_labels = on\n").unwrap();
    let result = label_for("Dock Ward", &FlagSource::file(&path));
    std::fs::remove_file(&path).unwrap();
    assert_eq!(result.unwrap(), "Sector Dock Ward");
}

#[test]
fn flag_switches_off_without_a_restart() {
    let path = temp_path();
    let source = FlagSource::file(&path);
    std::fs::write(&path, "sector_labels = on\n").unwrap();
    let before = label_for("Sea Ward", &source).unwrap();
    std::fs::write(&path, "sector_labels = off\n").unwrap();
    let after = label_for("Sea Ward", &source).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(
        (before.as_str(), after.as_str()),
        ("Sector Sea Ward", "Sea Ward")
    );
}

#[test]
fn malformed_file_is_an_explicit_error_with_the_line() {
    let path = temp_path();
    std::fs::write(&path, "sector_labels = on\nsector_labels = yes\n").unwrap();
    let error = FlagSource::file(&path).is_on(&SECTOR_LABELS).unwrap_err();
    std::fs::remove_file(&path).unwrap();
    match error {
        FlagError::Malformed { line, .. } => assert_eq!(line, 2),
        other => panic!("expected a malformed-file error, got {other}"),
    }
}

#[test]
fn every_registered_flag_has_a_unique_name_and_a_description() {
    let registry = desire_core::flags::REGISTRY;
    let mut names: Vec<&str> = registry.iter().map(|flag| flag.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), registry.len(), "duplicate flag name");
    assert!(registry.iter().all(|flag| !flag.description.is_empty()));
}
