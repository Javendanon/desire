//! The SQL checks run against a schema installed by the production migration runner.
//!
//! The shell harness only starts the cluster; installing the schema here removes the second,
//! divergent "from zero" path that `psql -f` used to provide.
mod support;
use desire_persistence::{CatalogRepository, migrations};

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
    // The file ends in ROLLBACK and reuses the fixture catalog IDs, so seeding them proves that
    // none of the rejected or rolled-back rows survived.
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    let world = db
        .query_one(
            "SELECT name FROM catalog.worlds WHERE id::text = $1",
            &[&support::id(1)],
        )
        .expect("the constraint fixture world outlived the rollback");
    assert_eq!(world.get::<_, String>(0), "Synthetic world");
}
