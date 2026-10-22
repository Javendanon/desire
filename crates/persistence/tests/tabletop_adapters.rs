//! Typed adapters preserve group snapshots and atomically create sheets and encounters.
mod support;
#[path = "tabletop/support.rs"]
mod tabletop;
use desire_core::contracts::{actors::*, adventure::*, common::ActorKind};
use desire_persistence::{
    ActorRepository, EncounterRepository, PartyRepository, SheetRepository, SheetWrite,
    TravelRepository,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

fn example<T: DeserializeOwned>(kind: &str) -> T {
    let examples: Value =
        serde_json::from_str(include_str!("../../../contracts/tabletop-examples.json")).unwrap();
    let mut record = examples[kind][0].clone();
    if record.get("campaign_id").is_some() {
        record["campaign_id"] = support::id(10).into();
    }
    if record.get("actor_id").is_some() {
        record["actor_id"] = support::id(203).into();
    }
    serde_json::from_value(record).unwrap()
}

fn sheet() -> SheetWrite {
    let mut write = SheetWrite {
        sheet: example("CharacterSheet"),
        stats: example("ActorStats"),
        state: example("ActorState"),
        classes: vec![example("CharacterClass")],
        proficiencies: vec![example("CharacterProficiency")],
        equipment: vec![example("CharacterEquipment")],
        spells: vec![example("CharacterSpell")],
        resources: vec![example("ActorResource")],
        concentration: None,
    };
    write.classes[0].class_entry_id = support::id(50);
    write.spells[0].knowledge_entry_id = support::id(50);
    write.state.max_hp = 10;
    write.state.current_hp = 9;
    write.state.temporary_hp = 0;
    write
}

#[test]
fn sheet_creation_and_health_updates_are_atomic_and_revision_checked() {
    let mut db = tabletop::population_database();
    SheetRepository::create(&mut db, &sheet()).unwrap();
    let mut state = ActorRepository::state_for_dm(&mut db, &support::id(10), &support::id(203))
        .unwrap()
        .unwrap();
    state.current_hp = 5;
    state.revision = 2;
    ActorRepository::update_state(&mut db, &state, 1).unwrap();
    assert!(ActorRepository::update_state(&mut db, &state, 1).is_err());
    assert!(
        ActorRepository::state_for_dm(&mut db, &support::id(11), &support::id(203))
            .unwrap()
            .is_none()
    );
}

#[test]
fn an_invalid_sheet_component_rolls_back_the_entire_sheet() {
    let mut db = tabletop::population_database();
    let mut write = sheet();
    write.equipment[0].actor_id = support::id(211);
    assert!(SheetRepository::create(&mut db, &write).is_err());
    assert!(
        ActorRepository::state_for_dm(&mut db, &support::id(10), &support::id(203))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM campaign.character_sheets", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
}

fn party(db: &mut postgres::Client) {
    let mut party: Party = example("Party");
    party.id = support::id(400);
    PartyRepository::create(db, &party).unwrap();
    for actor in [201, 202] {
        PartyRepository::add_member(
            db,
            &PartyMember {
                campaign_id: support::id(10),
                party_id: party.id.clone(),
                actor_id: support::id(actor),
            },
        )
        .unwrap();
    }
}

#[test]
fn party_departure_snapshots_members_and_rejects_invalid_manual_participants() {
    let mut db = tabletop::population_database();
    party(&mut db);
    let mut draft: GroupTravel = example("GroupTravel");
    draft.scene_id = support::id(300);
    draft.party_id = Some(support::id(400));
    draft.participants.clear();
    let saved = TravelRepository::start_from_party(&mut db, &draft).unwrap();
    db.execute("DELETE FROM campaign.party_members", &[])
        .unwrap();
    assert_eq!(saved.participants, [support::id(201), support::id(202)]);
    assert_eq!(
        TravelRepository::get_for_dm(&mut db, &support::id(10), &saved.id)
            .unwrap()
            .unwrap(),
        saved
    );
    draft.id = support::id(501);
    assert!(TravelRepository::create(&mut db, &draft).is_err());
    draft.participants = vec![support::id(201), support::id(201)];
    assert!(TravelRepository::create(&mut db, &draft).is_err());
    draft.participants = vec![support::id(211)];
    assert!(TravelRepository::create(&mut db, &draft).is_err());
    assert!(
        TravelRepository::get_for_dm(&mut db, &support::id(10), &draft.id)
            .unwrap()
            .is_none()
    );
}

#[test]
fn creating_a_creature_and_starting_an_encounter_preserves_its_damage() {
    let mut db = tabletop::population_database();
    let mut actor: Actor = example("Actor");
    actor.id = support::id(900);
    actor.kind = ActorKind::Monster;
    actor.template_id = Some(support::id(200));
    ActorRepository::create_from_template(&mut db, &actor).unwrap();
    let mut state = ActorRepository::state_for_dm(&mut db, &support::id(10), &actor.id)
        .unwrap()
        .unwrap();
    state.current_hp = 3;
    state.revision = 2;
    ActorRepository::update_state(&mut db, &state, 1).unwrap();
    let mut encounter: Encounter = example("Encounter");
    encounter.place_id = Some(support::id(5));
    encounter.scene_id = Some(support::id(300));
    let participant = EncounterParticipant {
        campaign_id: support::id(10),
        actor_id: actor.id.clone(),
        encounter_id: encounter.id.clone(),
        initiative: Some(-2),
    };
    EncounterRepository::create(&mut db, &encounter, &[participant]).unwrap();
    assert_eq!(
        ActorRepository::state_for_dm(&mut db, &support::id(10), &actor.id)
            .unwrap()
            .unwrap()
            .current_hp,
        3
    );
}
