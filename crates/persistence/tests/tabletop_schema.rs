//! Tabletop invariants run on PostgreSQL installed by the production migration runner.
mod support;
use desire_persistence::{CatalogRepository, migrations};

fn database() -> postgres::Client {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    db.batch_execute(include_str!("tabletop/fixture.sql"))
        .unwrap();
    db
}

#[test]
fn creature_instances_keep_separate_stats_and_state() {
    database()
        .batch_execute(include_str!("tabletop/actors.sql"))
        .unwrap();
}

#[test]
fn sheets_store_attributes_classes_equipment_spells_and_resources() {
    database()
        .batch_execute(include_str!("tabletop/sheets.sql"))
        .unwrap();
}

#[test]
fn group_travel_membership_is_a_snapshot_with_campaign_isolation() {
    database()
        .batch_execute(include_str!("tabletop/journeys.sql"))
        .unwrap();
}

#[test]
fn residents_exist_without_combat_and_keep_state_between_visits() {
    database()
        .batch_execute(include_str!("tabletop/presence.sql"))
        .unwrap();
}

#[test]
fn legacy_characters_travels_and_conditions_survive_upgrade() {
    let mut db = support::database();
    migrations::apply_through(&mut db, 5).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    db.batch_execute(include_str!("tabletop/legacy.sql"))
        .unwrap();
    migrations::apply(&mut db).unwrap();
    db.batch_execute(include_str!("tabletop/upgraded.sql"))
        .unwrap();
}
