//! Shared synthetic tabletop database setup; every caller gets an isolated database.
use super::support;
use desire_core::contracts::adventure::PopulationRule;
use desire_persistence::{CatalogRepository, PresenceRepository, migrations};
use serde_json::json;

pub fn database() -> postgres::Client {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    db.batch_execute(include_str!("fixture.sql")).unwrap();
    db
}

pub fn population_database() -> postgres::Client {
    let mut db = database();
    let rule: PopulationRule = serde_json::from_value(json!({
        "id": support::id(450), "campaign_id": support::id(10), "place_id": support::id(5),
        "template_id": support::id(200), "rules_edition": "dnd_2014", "quantity_min": 2,
        "quantity_max": 3, "visibility": "dm", "disposition": "hostile", "revision": 1
    }))
    .unwrap();
    PresenceRepository::create_rule(&mut db, &rule).unwrap();
    db
}
