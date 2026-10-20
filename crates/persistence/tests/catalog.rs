//! Idempotent editorial imports must never silently replace existing content.
mod support;
use desire_core::contracts::{
    catalog::{Calibration, Chunk, District, PlaceAnchor},
    common::Position,
};
use desire_persistence::{CatalogRepository, ErrorKind, migrations};

#[test]
fn seed_imports_calibration_chunks_and_districts() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    seed.districts.push(District {
        id: support::id(4),
        city_id: support::id(3),
        name: "District".into(),
    });
    seed.places[0].district_id = Some(support::id(4));
    seed.map_versions[0].calibration = Some(Calibration {
        origin_px_x: 0.0,
        origin_px_y: 0.0,
        meters_per_pixel: 2.0,
        rotation_radians: 0.0,
        provenance: seed.worlds[0].provenance.clone(),
    });
    seed.chunks.push(Chunk {
        id: support::id(8),
        map_version_id: support::id(6),
        origin: Position {
            x_m: 1.0,
            y_m: 2.0,
            z_m: 3.0,
        },
        size_m: 10.0,
        asset_uri: "fixture://synthetic.glb".into(),
    });
    CatalogRepository::seed(&mut db, &seed).unwrap();
    CatalogRepository::seed(&mut db, &seed).unwrap();
    assert_eq!(
        db.query_one("SELECT x_m::float8 FROM catalog.chunks", &[])
            .unwrap()
            .get::<_, f64>(0),
        1.0
    );
}

#[test]
fn seed_detects_removed_anchors_without_deleting_installed_content() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    let provenance = seed.places[0].provenance.clone();
    seed.places[0].anchors.push(PlaceAnchor {
        map_version_id: support::id(6),
        position: Position {
            x_m: 1.0,
            y_m: 0.0,
            z_m: 2.0,
        },
        provenance,
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
fn duplicate_anchors_cannot_mask_removal_of_an_installed_anchor() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let mut seed = support::catalog();
    let mut second_map = seed.map_versions[0].clone();
    second_map.id = support::id(7);
    second_map.map_id = support::id(70);
    seed.map_versions.push(second_map);
    let anchor = PlaceAnchor { map_version_id: support::id(6),
        position: Position { x_m: 1.0, y_m: 0.0, z_m: 2.0 },
        provenance: seed.worlds[0].provenance.clone() };
    seed.places[0].anchors = vec![anchor.clone()];
    CatalogRepository::seed(&mut db, &seed).unwrap();
    let replacement = PlaceAnchor { map_version_id: support::id(7), ..anchor };
    seed.places[0].anchors = vec![replacement.clone(), replacement];
    assert_eq!(CatalogRepository::seed(&mut db, &seed).unwrap_err().kind, ErrorKind::SeedMismatch);
    let rows = db.query("SELECT map_version_id::text FROM catalog.place_anchors", &[]).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<_, String>(0), support::id(6));
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
