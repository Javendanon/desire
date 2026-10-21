//! Real PostgreSQL checks; the harness creates a new database per test.
mod support;

use desire_core::contracts::{campaign::Campaign, common::RulesEdition};
use desire_persistence::{CampaignRename, CampaignRepository, ErrorKind, migrations};

#[test]
fn every_migration_prefix_upgrades_to_current() {
    for version in 0..=5 {
        let mut db = support::database();
        migrations::apply_through(&mut db, version).unwrap();
        migrations::apply(&mut db).unwrap();
        assert_eq!(
            db.query_one("SELECT count(*) FROM persistence_migrations", &[])
                .unwrap()
                .get::<_, i64>(0),
            5
        );
    }
}

#[test]
fn migration_history_is_independent_of_connection_search_path() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    db.batch_execute("CREATE SCHEMA alternate; SET search_path = alternate, public")
        .unwrap();
    migrations::apply(&mut db).unwrap();
    assert_eq!(
        db.query_one("SELECT count(*) FROM public.persistence_migrations", &[])
            .unwrap()
            .get::<_, i64>(0),
        5
    );
    assert!(
        db.query_one(
            "SELECT to_regclass('alternate.persistence_migrations') IS NULL",
            &[]
        )
        .unwrap()
        .get::<_, bool>(0)
    );
}

#[test]
fn invalid_history_and_downgrades_are_rejected() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    assert_eq!(
        migrations::apply_through(&mut db, 3).unwrap_err().kind,
        ErrorKind::InvalidMigration
    );
    db.execute(
        "UPDATE persistence_migrations SET sql = 'tampered' WHERE version = 1",
        &[],
    )
    .unwrap();
    assert_eq!(
        migrations::apply(&mut db).unwrap_err().kind,
        ErrorKind::InvalidMigration
    );
    assert_eq!(
        migrations::apply_through(&mut db, 6).unwrap_err().kind,
        ErrorKind::InvalidMigration
    );
}

#[test]
fn failed_upgrade_rolls_back_schema_and_history() {
    let mut db = support::database();
    db.batch_execute("CREATE SCHEMA campaign").unwrap();
    let error = migrations::apply(&mut db).unwrap_err();
    assert!(error.context.contains("0002"));
    assert!(
        db.query_one("SELECT to_regnamespace('catalog') IS NULL", &[])
            .unwrap()
            .get::<_, bool>(0)
    );
    assert!(
        db.query_one("SELECT to_regclass('persistence_migrations') IS NULL", &[])
            .unwrap()
            .get::<_, bool>(0)
    );
}

#[test]
fn database_errors_keep_context_and_sqlstate_without_row_contents() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    desire_persistence::CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    let campaign = Campaign {
        id: support::id(10),
        owner_id: support::id(90),
        city_id: None,
        name: "Private campaign name must not appear in error logs".into(),
        rules_edition: RulesEdition::Dnd2014,
        revision: 0,
    };
    let error = CampaignRepository::create(&mut db, &campaign).unwrap_err();
    assert_eq!(error.sqlstate.as_deref(), Some("23514"));
    assert!(error.to_string().contains(&campaign.id));
    assert!(!error.to_string().contains(&campaign.name));
    assert!(!format!("{error:?}").contains(&campaign.name));
    assert!(std::error::Error::source(&error).is_some());
    assert!(
        CampaignRepository::get(&mut db, &campaign.id)
            .unwrap()
            .is_none()
    );
}

#[test]
fn migrations_upgrade_without_replacing_saved_campaigns() {
    let mut db = support::database();
    migrations::apply_through(&mut db, 2).unwrap();
    desire_persistence::CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    let campaign = campaign();
    CampaignRepository::create(&mut db, &campaign).unwrap();
    migrations::apply(&mut db).unwrap();
    migrations::apply(&mut db).unwrap();
    assert_eq!(
        CampaignRepository::get(&mut db, &campaign.id).unwrap(),
        Some(campaign.clone())
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM persistence_migrations", &[])
            .unwrap()
            .get::<_, i64>(0),
        5
    );
}

fn campaign() -> Campaign {
    Campaign {
        id: support::id(1),
        owner_id: support::id(10),
        city_id: None,
        name: "First campaign".into(),
        rules_edition: RulesEdition::Dnd2014,
        revision: 1,
    }
}

#[test]
fn campaign_rename_requires_the_expected_revision() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let campaign = campaign();
    CampaignRepository::create(&mut db, &campaign).unwrap();
    let rename = CampaignRename {
        campaign_id: &campaign.id,
        expected_revision: 1,
        name: "Renamed",
    };
    CampaignRepository::rename(&mut db, &rename).unwrap();
    assert_eq!(
        CampaignRepository::rename(&mut db, &rename)
            .unwrap_err()
            .kind,
        ErrorKind::Conflict
    );
    assert_eq!(
        CampaignRepository::get(&mut db, &campaign.id)
            .unwrap()
            .unwrap()
            .revision,
        2
    );
}
