//! Idempotent editorial imports must never silently replace existing content.
mod support;
use desire_core::contracts::{catalog::PlaceAnchor, common::Position};
use desire_persistence::{CatalogRepository, ErrorKind, migrations};

#[test]
fn seed_detects_removed_anchors_without_deleting_installed_content() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    seed.places[0].anchors.push(PlaceAnchor {
        map_version_id: support::id(6),
        position: Position {
            x_m: 1.0,
            y_m: 0.0,
            z_m: 2.0,
        },
        provenance: seed.places[0].provenance.clone(),
    });
    CatalogRepository::seed(&mut db, &seed).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    seed.places[0].anchors.clear();
    assert_eq!(
        CatalogRepository::seed(&mut db, &seed).unwrap_err().kind,
        ErrorKind::SeedMismatch
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM catalog.place_anchors", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}

#[test]
fn seed_is_idempotent_and_conflicting_content_rolls_back() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    let mut additional = seed.worlds[0].clone();
    additional.id = support::id(99);
    seed.worlds[0].name = "Unexpected replacement".into();
    seed.worlds.insert(0, additional);
    let error = CatalogRepository::seed(&mut db, &seed).unwrap_err();
    assert_eq!(error.kind, ErrorKind::SeedMismatch);
    assert!(error.to_string().contains(&seed.worlds[1].id));
    assert_eq!(
        db.query_one("SELECT count(*) FROM catalog.worlds", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
    assert_eq!(
        db.query_one("SELECT name FROM catalog.worlds", &[])
            .unwrap()
            .get::<_, String>(0),
        "Synthetic world"
    );
}
