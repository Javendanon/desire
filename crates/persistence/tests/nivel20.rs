//! Nivel20 mappings: an unchanged snapshot still records the path the source now uses.
mod support;

use desire_core::contracts::{campaign::Campaign, common::RulesEdition};
use desire_persistence::{
    CampaignRepository, CatalogRepository, Nivel20Mapping, Nivel20Repository, Nivel20Save,
    migrations,
};
use postgres::Client;
use serde_json::{Value, json};
use support::id;

const FIRST_PATH: &str = "/games/dnd-5/campaigns/109662-synthetic";
const RENAMED_PATH: &str = "/games/dnd-5/campaigns/109662-renamed";

fn database_with_campaign() -> (Client, String) {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    let campaign = Campaign {
        id: id(10),
        owner_id: id(90),
        name: "Synthetic campaign".into(),
        rules_edition: RulesEdition::Dnd2014,
        city_id: Some(id(3)),
        revision: 1,
    };
    CampaignRepository::create(&mut db, &campaign).unwrap();
    (db, campaign.id)
}

fn save(db: &mut Client, campaign: &str, path: &str, previous: Option<&str>) -> Nivel20Mapping {
    let snapshot: Value = json!({"id": 109_662, "name": "Synthetic campaign"});
    let request = Nivel20Save {
        campaign_id: campaign,
        external_id: 109_662,
        source_path: path,
        external_updated_at: None,
        snapshot: &snapshot,
        expected_imported_at: previous,
    };
    Nivel20Repository::save(db, &request).unwrap().stored
}

#[test]
fn an_unchanged_snapshot_records_a_new_source_path_without_reimporting() {
    let (mut db, campaign) = database_with_campaign();
    let first = save(&mut db, &campaign, FIRST_PATH, None);
    let again = save(&mut db, &campaign, RENAMED_PATH, Some(&first.imported_at));
    assert_eq!(again.source_path, RENAMED_PATH);
    assert_eq!(
        again.imported_at, first.imported_at,
        "no new import was recorded"
    );
}
