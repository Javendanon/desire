//! Real PostgreSQL checks; the harness creates a new database per test.
mod support;

use desire_core::contracts::{Campaign, RulesEdition};
use desire_persistence::{CampaignRepository, migrations};

#[test]
fn migrations_upgrade_without_replacing_saved_campaigns() {
    let mut db = support::database();
    migrations::apply_through(&mut db, 2).unwrap();
    let campaign = Campaign {
        id: support::id(1),
        owner_id: support::id(10),
        city_id: None,
        name: "First campaign".into(),
        rules_edition: RulesEdition::Dnd2014,
        revision: 1,
    };
    CampaignRepository::create(&mut db, &campaign).unwrap();
    migrations::apply(&mut db).unwrap();
    migrations::apply(&mut db).unwrap();
    assert_eq!(CampaignRepository::get(&mut db, &campaign.id).unwrap(), Some(campaign));
    assert_eq!(db.query_one("SELECT count(*) FROM persistence_migrations", &[])
        .unwrap().get::<_, i64>(0), 4);
}
