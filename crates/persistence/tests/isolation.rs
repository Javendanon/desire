//! Two campaigns share a catalog but never mutable records or private projections.
mod support;
use desire_core::contracts::{campaign::*, common::*};
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

fn saved_scene(db: &mut postgres::Client, write: &SceneWrite) -> Scene {
    SceneRepository::get(db, &write.scene.campaign_id, &write.scene.id)
        .unwrap()
        .unwrap()
}

fn revised_write() -> SceneWrite {
    let mut write = write();
    write.key = support::id(201);
    write.event_id = support::id(101);
    write.expected_revision = Some(1);
    write.scene.revision = 2;
    write.scene.name = "Second revision".into();
    write
}

#[test]
fn scene_creation_is_idempotent_and_scoped() {
    let mut db = setup();
    let write = write();
    let first = SceneRepository::save_and_enqueue(&mut db, &write).unwrap();
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
}

#[test]
fn failed_event_rolls_back_scene_and_stream_updates() {
    let mut db = setup();
    SceneRepository::save_and_enqueue(&mut db, &write()).unwrap();
    let mut update = revised_write();
    update.event_id = write().event_id;
    assert!(SceneRepository::save_and_enqueue(&mut db, &update).is_err());
    assert_eq!(saved_scene(&mut db, &update), write().scene);
    assert_eq!(
        db.query_one("SELECT revision FROM campaign.streams", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}

#[test]
fn scene_updates_require_the_previous_revision() {
    let mut db = setup();
    SceneRepository::save_and_enqueue(&mut db, &write()).unwrap();
    let mut update = revised_write();
    assert_eq!(
        SceneRepository::save_and_enqueue(&mut db, &update)
            .unwrap()
            .revision,
        2
    );
    update.key = support::id(202);
    update.event_id = support::id(102);
    assert!(SceneRepository::save_and_enqueue(&mut db, &update).is_err());
    assert_eq!(saved_scene(&mut db, &update).revision, 2);
}

fn concurrent_event(
    db: postgres::Client,
    index: u64,
    barrier: std::sync::Arc<std::sync::Barrier>,
) -> std::thread::JoinHandle<u32> {
    std::thread::spawn(move || {
        let mut db = db;
        let mut write = write();
        write.scene.id = support::id(30 + index);
        write.event_id = support::id(100 + index);
        write.key = support::id(200 + index);
        barrier.wait();
        SceneRepository::save_and_enqueue(&mut db, &write)
            .unwrap()
            .revision
    })
}

#[test]
fn concurrent_writers_allocate_distinct_stream_revisions() {
    let mut db = setup();
    let name: String = db
        .query_one("SELECT current_database()", &[])
        .unwrap()
        .get(0);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|index| concurrent_event(support::connect(&name), index, barrier.clone()))
        .collect();
    let mut revisions: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    revisions.sort();
    assert_eq!(revisions, vec![1, 2]);
}

#[test]
fn reused_idempotency_key_rejects_a_different_request() {
    let mut db = setup();
    let mut write = write();
    SceneRepository::save_and_enqueue(&mut db, &write).unwrap();
    write.scene.name = "Different request".into();
    let error = SceneRepository::save_and_enqueue(&mut db, &write).unwrap_err();
    assert_eq!(error.kind, desire_persistence::ErrorKind::Conflict);
}

fn create_notes(db: &mut postgres::Client) {
    NotesRepository::create_session(
        db,
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
            db,
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
}

fn create_knowledge(db: &mut postgres::Client) {
    for (id, visibility) in [(73, Visibility::Players), (74, Visibility::Dm)] {
        NotesRepository::create_knowledge(
            db,
            &CampaignKnowledge {
                id: support::id(id),
                campaign_id: support::id(10),
                title: "Synthetic lore".into(),
                body: "Original test lore".into(),
                visibility,
                revision: 1,
                provenance: support::catalog().worlds[0].provenance.clone(),
            },
        )
        .unwrap();
    }
}

fn create_secret(db: &mut postgres::Client) {
    SceneRepository::save_and_enqueue(db, &write()).unwrap();
    SecretRepository::create(
        db,
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
}

#[test]
fn player_journal_excludes_dm_notes_secrets_and_other_campaigns() {
    let mut db = setup();
    create_secret(&mut db);
    create_notes(&mut db);
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
}

#[test]
fn player_knowledge_excludes_dm_notes_secrets_and_other_campaigns() {
    let mut db = setup();
    create_secret(&mut db);
    create_knowledge(&mut db);
    assert_eq!(
        NotesRepository::player_knowledge(&mut db, &support::id(10))
            .unwrap()
            .len(),
        1
    );
    assert!(
        NotesRepository::player_knowledge(&mut db, &support::id(11))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn secret_reads_require_the_owning_campaign() {
    let mut db = setup();
    create_secret(&mut db);
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
