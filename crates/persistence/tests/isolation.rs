//! Two campaigns share a catalog but never mutable records or private projections.
mod support;
use desire_core::contracts::{campaign::*, common::*, transport::SceneChanged};
use desire_persistence::{
    CampaignRepository, CatalogRepository, NotesRepository, SceneRepository, SceneWrite,
    SecretRepository, SecretSubject, migrations,
};

fn setup() -> postgres::Client {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
    for number in [10, 11] {
        CampaignRepository::create(
            &mut db,
            &Campaign {
                id: support::id(number),
                owner_id: support::id(number + 80),
                city_id: Some(support::id(3)),
                name: format!("Campaign {number}"),
                rules_edition: RulesEdition::Dnd2014,
                revision: 1,
            },
        )
        .unwrap();
    }
    db
}

fn write() -> SceneWrite {
    SceneWrite {
        scene: Scene {
            id: support::id(30),
            campaign_id: support::id(10),
            map_version_id: support::id(6),
            name: "Shared city, private scene".into(),
            revision: 1,
        },
        expected_revision: None,
        event_id: support::id(100),
        key: support::id(200),
    }
}

#[test]
fn scene_writes_and_events_are_atomic_idempotent_and_scoped() {
    let mut db = setup();
    let mut write = write();
    let first: SceneChanged = SceneRepository::save_and_enqueue(&mut db, &write).unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(
        SceneRepository::save_and_enqueue(&mut db, &write).unwrap(),
        first
    );
    assert!(
        SceneRepository::get(&mut db, &support::id(11), &write.scene.id)
            .unwrap()
            .is_none()
    );
    write.key = support::id(201);
    write.expected_revision = Some(1);
    write.scene.revision = 2;
    write.scene.name = "Must roll back on duplicate event ID".into();
    assert!(SceneRepository::save_and_enqueue(&mut db, &write).is_err());
    let saved = SceneRepository::get(&mut db, &write.scene.campaign_id, &write.scene.id)
        .unwrap()
        .unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(
        db.query_one("SELECT revision FROM campaign.streams", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
    write.event_id = support::id(101);
    assert_eq!(
        SceneRepository::save_and_enqueue(&mut db, &write)
            .unwrap()
            .revision,
        2
    );
    assert!(
        SceneRepository::save_and_enqueue(
            &mut db,
            &SceneWrite {
                key: support::id(202),
                event_id: support::id(102),
                ..write
            }
        )
        .is_err()
    );
}

#[test]
fn player_notes_exclude_dm_notes_secrets_and_other_campaigns() {
    let mut db = setup();
    SceneRepository::save_and_enqueue(&mut db, &write()).unwrap();
    NotesRepository::create_session(
        &mut db,
        &Session {
            id: support::id(70),
            campaign_id: support::id(10),
            title: "First session".into(),
            revision: 1,
        },
    )
    .unwrap();
    for (id, visibility) in [(71, Visibility::Players), (72, Visibility::Dm)] {
        NotesRepository::create_journal(
            &mut db,
            &JournalEntry {
                id: support::id(id),
                campaign_id: support::id(10),
                session_id: support::id(70),
                body: "Synthetic journal".into(),
                visibility,
                revision: 1,
            },
        )
        .unwrap();
    }
    SecretRepository::create(
        &mut db,
        &DmSecret {
            id: support::id(80),
            campaign_id: support::id(10),
            subject_id: support::id(30),
            body: "Never in a player projection".into(),
            revision: 1,
        },
        SecretSubject::Scene,
    )
    .unwrap();
    assert_eq!(
        NotesRepository::player_journal(&mut db, &support::id(10))
            .unwrap()
            .len(),
        1
    );
    assert!(
        NotesRepository::player_journal(&mut db, &support::id(11))
            .unwrap()
            .is_empty()
    );
    assert!(
        SecretRepository::get(&mut db, &support::id(11), &support::id(80))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        SecretRepository::get(&mut db, &support::id(10), &support::id(80))
            .unwrap()
            .unwrap()
            .subject_id,
        support::id(30)
    );
}
