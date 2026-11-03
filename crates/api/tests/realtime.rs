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
