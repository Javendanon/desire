//! Calibrated anchors, canonical seed identities, and safe forward upgrades.
mod support;
use desire_core::contracts::{catalog::PlaceAnchor, common::Position};
use desire_persistence::{CatalogRepository, migrations};

fn anchored_seed() -> desire_persistence::CatalogSeed {
    let mut seed = support::catalog();
    seed.places[0].anchors.push(PlaceAnchor {
        map_version_id: seed.map_versions[0].id.clone(),
        position: Position {
            x_m: 1.0,
            y_m: 0.0,
            z_m: 2.0,
        },
        provenance: seed.worlds[0].provenance.clone(),
    });
    seed
}

#[test]
fn an_anchor_requires_a_calibrated_map_and_rolls_back_the_seed() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = anchored_seed();
    seed.map_versions[0].calibration = None;
    let error = CatalogRepository::seed(&mut db, &seed).unwrap_err();
    assert_eq!(error.sqlstate.as_deref(), Some("23503"));
    assert_eq!(
        db.query_one("SELECT count(*) FROM catalog.worlds", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
}

#[test]
fn an_anchored_map_cannot_lose_its_calibration() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &anchored_seed()).unwrap();
    let error = db
        .execute("UPDATE catalog.map_versions SET calibration = NULL", &[])
        .unwrap_err();
    assert_eq!(error.code().unwrap().code(), "23503");
    assert!(
        db.query_one(
            "SELECT calibration IS NOT NULL FROM catalog.map_versions",
            &[]
        )
        .unwrap()
        .get::<_, bool>(0)
    );
}

#[test]
fn uppercase_seed_ids_and_anchor_references_are_idempotent() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = anchored_seed();
    seed.worlds[0].id = support::id(0xab).to_uppercase();
    seed.eras[0].world_id = seed.worlds[0].id.clone();
    seed.places[0].id = support::id(0xcd).to_uppercase();
    seed.map_versions[0].id = support::id(0xef).to_uppercase();
    seed.places[0].anchors[0].map_version_id = seed.map_versions[0].id.clone();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    seed.worlds[0].id.make_ascii_lowercase();
    seed.eras[0].world_id.make_ascii_lowercase();
    seed.places[0].id.make_ascii_lowercase();
    seed.map_versions[0].id.make_ascii_lowercase();
    seed.places[0].anchors[0]
        .map_version_id
        .make_ascii_lowercase();
    CatalogRepository::seed(&mut db, &seed).unwrap();
}

#[test]
fn upgrade_preserves_valid_anchors_and_seed_idempotency() {
    let mut db = support::database();
    migrations::apply_through(&mut db, 4).unwrap();
    let seed = anchored_seed();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    migrations::apply(&mut db).unwrap();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    assert_eq!(
        db.query_one("SELECT count(*) FROM catalog.place_anchors", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}

#[test]
fn upgrade_rejects_legacy_uncalibrated_anchors_without_changing_data() {
    let mut db = support::database();
    migrations::apply_through(&mut db, 4).unwrap();
    let mut seed = anchored_seed();
    seed.map_versions[0].calibration = None;
    CatalogRepository::seed(&mut db, &seed).unwrap();
    let error = migrations::apply(&mut db).unwrap_err();
    assert_eq!(error.sqlstate.as_deref(), Some("23503"));
    assert!(error.context.contains("0005"));
    assert_eq!(
        db.query_one("SELECT count(*) FROM public.persistence_migrations", &[])
            .unwrap()
            .get::<_, i64>(0),
        4
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM catalog.place_anchors", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}
