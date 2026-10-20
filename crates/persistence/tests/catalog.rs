//! Idempotent editorial imports must never silently replace existing content.
mod support;
use desire_persistence::{CatalogRepository, ErrorKind, migrations};

#[test]
fn seed_is_idempotent_and_conflicting_content_rolls_back() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    seed.worlds[0].name = "Unexpected replacement".into();
    let error = CatalogRepository::seed(&mut db, &seed).unwrap_err();
    assert_eq!(error.kind, ErrorKind::SeedMismatch);
    assert!(error.to_string().contains(&seed.worlds[0].id));
    assert_eq!(
        db.query_one("SELECT name FROM catalog.worlds", &[])
            .unwrap()
            .get::<_, String>(0),
        "Synthetic world"
    );
}
