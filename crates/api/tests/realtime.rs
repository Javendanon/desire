//! Cursor-based synchronization: snapshot on start, replay after reconnect, deduplicated reads.
use crate::support::{self, Actor, TestDb, call, id, uri};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use std::thread;
use support::ApiCall;

fn sync(app: &axum::Router, campaign: &str, caller: &str, after: Option<u32>) -> support::Response {
    let suffix = match after {
        Some(after) => format!("/sync?after={after}"),
        None => "/sync".to_string(),
    };
    support::run(call(
        app,
        ApiCall::new(Method::GET, &uri(campaign, &suffix)).by(caller),
    ))
}

fn event_ids(body: &Value) -> Vec<String> {
    body["scene_events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["event_id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn initial_sync_returns_a_snapshot_and_its_stream_revision() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        Actor::new(&app, &campaign, &owner),
        &player,
        "player",
    ));
    let scene = support::run(support::create_scene(&app, &campaign, &owner));

    let response = sync(&app, &campaign, &player, None);
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(response.body["protocol_version"], 1);
    assert_eq!(response.body["campaign_id"], campaign);
    assert_eq!(response.body["role"], "player");
    assert_eq!(response.body["revision"], 1);
    assert!(response.body["snapshot"].is_object());
    assert_eq!(response.body["snapshot"]["campaign"]["id"], campaign);
    assert_eq!(response.body["snapshot"]["scenes"][0]["id"], scene["id"]);
    assert!(response.body["scene_events"].as_array().unwrap().is_empty());
}

#[test]
fn reconnect_after_a_cursor_replays_events_once_and_in_order() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        Actor::new(&app, &campaign, &owner),
        &player,
        "player",
    ));
    let scene = support::run(support::create_scene(&app, &campaign, &owner));

    let caught_up = sync(&app, &campaign, &player, Some(0));
    assert_eq!(caught_up.status, StatusCode::OK, "{}", caught_up.body);
    assert!(caught_up.body["snapshot"].is_null());
    assert_eq!(caught_up.body["revision"], 1);
    assert_eq!(event_ids(&caught_up.body).len(), 1);

    let repeated = sync(&app, &campaign, &player, Some(0));
    assert_eq!(event_ids(&repeated.body), event_ids(&caught_up.body));

    let updated = support::run(call(
        &app,
        ApiCall::new(
            Method::PATCH,
            &uri(
                &campaign,
                &format!("/scenes/{}", scene["id"].as_str().unwrap()),
            ),
        )
        .by(&owner)
        .json(
            json!({"name": "Updated dock", "map_version_id": support::map_version(),
            "expected_revision": 1}),
        ),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);

    let next = sync(&app, &campaign, &player, Some(1));
    assert_eq!(next.status, StatusCode::OK, "{}", next.body);
    assert_eq!(next.body["revision"], 2);
    assert_eq!(event_ids(&next.body).len(), 1);
    assert!(next.body["snapshot"].is_null());

    let current = sync(&app, &campaign, &player, Some(2));
    assert_eq!(current.body["revision"], 2);
    assert!(event_ids(&current.body).is_empty());

    let unknown = sync(&app, &campaign, &player, Some(999));
    assert!(unknown.body["snapshot"].is_object());
    assert!(event_ids(&unknown.body).is_empty());
}

#[test]
fn a_stale_snapshot_cursor_recovers_with_a_fresh_snapshot() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(support::create_scene(&app, &campaign, &owner));
    let response = sync(&app, &campaign, &owner, Some(0));
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert!(response.body["snapshot"].is_null());
    assert_eq!(response.body["revision"], 1);
}

#[test]
fn a_caught_up_cursor_without_scene_events_returns_an_empty_batch() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign = support::run(support::campaign(&app, &owner));
    let session = support::run(support::create_session(&app, &campaign, &owner));
    support::run(support::create_journal(
        Actor::new(&app, &campaign, &owner),
        session["id"].as_str().unwrap(),
        "players",
    ));

    let snapshot = sync(&app, &campaign, &owner, None);
    assert_eq!(snapshot.body["revision"], 1, "{}", snapshot.body);
    assert!(snapshot.body["snapshot"].is_object(), "{}", snapshot.body);

    // A journal write advances the stream without a scene event, so the cursor is at 1 with
    // no retained scene event. A client already at that cursor has nothing left to fetch.
    let caught_up = sync(&app, &campaign, &owner, Some(1));
    assert_eq!(caught_up.status, StatusCode::OK, "{}", caught_up.body);
    assert_eq!(caught_up.body["revision"], 1, "{}", caught_up.body);
    assert!(
        caught_up.body["snapshot"].is_null(),
        "a caught-up cursor must not resend the snapshot: {}",
        caught_up.body
    );
    assert!(event_ids(&caught_up.body).is_empty());
}

#[test]
fn cursor_catch_up_recovers_non_scene_changes_even_before_a_later_scene_write() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        Actor::new(&app, &campaign, &owner),
        &player,
        "player",
    ));
    let scene = support::run(support::create_scene(&app, &campaign, &owner));
    let initial = sync(&app, &campaign, &player, None);
    assert_eq!(initial.status, StatusCode::OK, "{}", initial.body);
    assert_eq!(initial.body["revision"], 1);
    assert!(initial.body["snapshot"].is_object());

    let session = support::run(support::create_session(&app, &campaign, &owner));
    support::run(support::create_journal(
        Actor::new(&app, &campaign, &player),
        session["id"].as_str().unwrap(),
        "players",
    ));
    let character = support::run(call(
        &app,
        ApiCall::new(Method::POST, &uri(&campaign, "/characters"))
            .by(&owner)
            .json(json!({"name": "Player hero", "controller_id": player,
            "rules_edition": "dnd_2014"})),
    ));
    assert_eq!(character.status, StatusCode::CREATED, "{}", character.body);
    let updated = support::run(call(
        &app,
        ApiCall::new(
            Method::PATCH,
            &uri(
                &campaign,
                &format!("/scenes/{}", scene["id"].as_str().unwrap()),
            ),
        )
        .by(&owner)
        .json(
            json!({"name": "Updated dock", "map_version_id": support::map_version(),
            "expected_revision": 1}),
        ),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);

    let caught_up = sync(&app, &campaign, &player, Some(1));
    assert_eq!(caught_up.status, StatusCode::OK, "{}", caught_up.body);
    assert_eq!(caught_up.body["revision"], 4);
    assert!(caught_up.body["snapshot"].is_object(), "{}", caught_up.body);
    let journal = caught_up.body["snapshot"]["journal"].as_array().unwrap();
    assert_eq!(journal.len(), 1, "{}", caught_up.body);
    assert_eq!(journal[0]["body"], "Synthetic recap");
    let characters = caught_up.body["snapshot"]["characters"].as_array().unwrap();
    assert_eq!(characters.len(), 1, "{}", caught_up.body);
    assert_eq!(
        caught_up.body["snapshot"]["scenes"][0]["name"],
        "Updated dock"
    );
}

#[test]
fn concurrent_scene_updates_produce_one_winner_and_one_event() {
    let db = TestDb::new();
    let setup = support::app_for(&db);
    let owner = id(90);
    let campaign = support::run(support::campaign(&setup, &owner));
    let scene = support::run(support::create_scene(&setup, &campaign, &owner));
    let path = uri(
        &campaign,
        &format!("/scenes/{}", scene["id"].as_str().unwrap()),
    );

    let handles: Vec<_> = ["First", "Second"]
        .into_iter()
        .map(|name| {
            let client = db.connection();
            let path = path.clone();
            let owner = owner.clone();
            thread::spawn(move || {
                let router = desire_api::app(desire_api::AppState::from_client(client));
                support::run(call(
                    &router,
                    ApiCall::new(Method::PATCH, &path).by(&owner).json(json!({
                        "name": name, "map_version_id": support::map_version(),
                        "expected_revision": 1
                    })),
                ))
            })
        })
        .collect();
    let responses: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    let winners = responses
        .iter()
        .filter(|response| response.status == StatusCode::OK)
        .count();
    let conflicts = responses
        .iter()
        .filter(|response| response.status == StatusCode::CONFLICT)
        .count();
    assert_eq!((winners, conflicts), (1, 1), "{responses:?}");

    let events: i64 = db
        .connection()
        .query_one("SELECT count(*) FROM campaign.outbox", &[])
        .unwrap()
        .get(0);
    assert_eq!(events, 2, "one create event and one winning update event");

    let caught_up = sync(&setup, &campaign, &owner, Some(1));
    assert_eq!(caught_up.body["revision"], 2);
    assert_eq!(event_ids(&caught_up.body).len(), 1);
}

#[test]
fn non_members_cannot_read_the_campaign_stream() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let campaign = support::run(support::campaign(&app, &id(90)));
    let response = sync(&app, &campaign, &id(91), None);
    assert_eq!(response.status, StatusCode::NOT_FOUND, "{}", response.body);

    let invalid = support::run(call(
        &app,
        ApiCall::new(Method::GET, &uri(&campaign, "/sync?after=not-a-number")).by(&id(90)),
    ));
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST, "{}", invalid.body);
}
