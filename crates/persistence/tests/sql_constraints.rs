//! The SQL checks run against a schema installed by the production migration runner.
//!
//! The shell harness only starts the cluster; installing the schema here removes the second,
//! divergent "from zero" path that `psql -f` used to provide.
mod support;
use desire_persistence::{CatalogRepository, migrations};
use std::fs;
use std::path::PathBuf;

#[test]
fn installed_schema_declares_every_contract_table() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    db.batch_execute(include_str!("schema.sql"))
        .expect("the migrated schema is missing a contract table");
}

#[test]
fn installed_schema_rejects_invalid_rows_and_rolls_back_them_all() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    db.batch_execute(include_str!("constraints.sql"))
        .expect("a constraint accepted an invalid row");
    // The file ends in ROLLBACK, and its fixture city is 'City one' where the seed writes
    // 'Waterdeep'. Seeding therefore fails with SeedMismatch if any row outlived the rollback.
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    let city = db
        .query_one(
            "SELECT name FROM catalog.cities WHERE id::text = $1",
            &[&support::id(3)],
        )
        .expect("the constraint fixture city outlived the rollback");
    assert_eq!(city.get::<_, String>(0), "Waterdeep");
}

#[test]
fn every_migration_file_is_embedded_in_the_runner() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let installed: Vec<String> = db
        .query(
            "SELECT sql FROM public.persistence_migrations ORDER BY version",
            &[],
        )
        .expect("migration history")
        .iter()
        .map(|row| row.get::<_, String>(0))
        .collect();
    assert_eq!(
        installed,
        migration_files(),
        "a migration file is not embedded in the runner, so nothing applies it"
    );
}

/// `migrations/NNNN_*.sql` in version order, the order `migrations::apply` installs them.
fn migration_files() -> Vec<String> {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
    let mut paths: Vec<PathBuf> = fs::read_dir(&directory)
        .expect("the migrations directory exists")
        .map(|entry| entry.expect("migration entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "sql"))
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| fs::read_to_string(path).expect("read migration file"))
        .collect()
}
