//! Entering a place must not duplicate or heal its persistent occupants.
mod support;
use desire_core::contracts::adventure::PopulationRule;
use desire_persistence::{CatalogRepository, PopulationActivation, PresenceRepository, migrations};
use serde_json::json;

fn database() -> postgres::Client {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    db.batch_execute(include_str!("tabletop/fixture.sql"))
        .unwrap();
    let rule: PopulationRule = serde_json::from_value(json!({
        "id": support::id(450), "campaign_id": support::id(10), "place_id": support::id(5),
        "template_id": support::id(200), "rules_edition": "dnd_2014", "quantity_min": 2,
        "quantity_max": 3, "visibility": "dm", "disposition": "hostile", "revision": 1
    }))
    .unwrap();
    PresenceRepository::create_rule(&mut db, &rule).unwrap();
    db
}

fn activate(db: &mut postgres::Client, ids: &[String]) -> Vec<String> {
    let campaign = support::id(10);
    let rule = support::id(450);
    PresenceRepository::activate_for_dm(
        db,
        &PopulationActivation {
            campaign_id: &campaign,
            rule_id: &rule,
            actor_ids: ids,
        },
    )
    .unwrap()
    .into_iter()
    .map(|actor| actor.id)
    .collect()
}

#[test]
fn revisiting_preserves_identity_damage_conditions_and_death_without_combat() {
    let mut db = database();
    let first = activate(&mut db, &[support::id(900), support::id(901)]);
    db.batch_execute(
        "UPDATE campaign.actor_state SET current_hp = 0, status = 'dead', revision = 2
        WHERE actor_id = pg_temp.id(900);
        INSERT INTO campaign.conditions (id,campaign_id,actor_id,knowledge_entry_id,
            rules_edition,remaining_rounds,revision) VALUES
        (pg_temp.id(600),pg_temp.id(10),pg_temp.id(900),pg_temp.id(50),'dnd_2014',NULL,1)",
    )
    .unwrap();
    let second = activate(&mut db, &[support::id(902), support::id(903)]);
    assert_eq!(first, second);
    assert_eq!(
        db.query_one(
            "SELECT current_hp FROM campaign.actor_state
        WHERE actor_id = pg_temp.id(900)",
            &[]
        )
        .unwrap()
        .get::<_, i32>(0),
        0
    );
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM campaign.conditions
        WHERE actor_id = pg_temp.id(900)",
            &[]
        )
        .unwrap()
        .get::<_, i64>(0),
        1
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM campaign.encounters", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
}

#[test]
fn a_failed_activation_rolls_back_every_spawn_and_can_be_retried() {
    let mut db = database();
    let campaign = support::id(10);
    let rule = support::id(450);
    let duplicate = [support::id(900), support::id(900)];
    assert!(
        PresenceRepository::activate_for_dm(
            &mut db,
            &PopulationActivation {
                campaign_id: &campaign,
                rule_id: &rule,
                actor_ids: &duplicate,
            }
        )
        .is_err()
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM campaign.population_runs", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
    assert_eq!(
        activate(&mut db, &[support::id(900), support::id(901)]).len(),
        2
    );
}

#[test]
fn players_only_see_disclosed_present_actors_from_their_campaign() {
    let mut db = database();
    activate(&mut db, &[support::id(900), support::id(901)]);
    db.batch_execute(
        "UPDATE campaign.actors SET visibility = 'players'
        WHERE id IN (pg_temp.id(900), pg_temp.id(901));
        UPDATE campaign.place_occupants SET visibility = 'players'
        WHERE actor_id IN (pg_temp.id(900), pg_temp.id(901));
        UPDATE campaign.place_occupants SET presence = 'away' WHERE actor_id = pg_temp.id(901)",
    )
    .unwrap();
    let visible =
        PresenceRepository::player_residents(&mut db, &support::id(10), &support::id(5)).unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].actor_id, support::id(900));
    assert!(
        PresenceRepository::player_residents(&mut db, &support::id(11), &support::id(5))
            .unwrap()
            .is_empty()
    );
    assert!(
        serde_json::to_value(&visible[0])
            .unwrap()
            .get("current_hp")
            .is_none()
    );
}

#[test]
fn population_rules_cannot_be_activated_from_another_campaign() {
    let mut db = database();
    let ids = [support::id(900), support::id(901)];
    assert!(
        PresenceRepository::activate_for_dm(
            &mut db,
            &PopulationActivation {
                campaign_id: &support::id(11),
                rule_id: &support::id(450),
                actor_ids: &ids,
            }
        )
        .is_err()
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM campaign.population_runs", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
}
