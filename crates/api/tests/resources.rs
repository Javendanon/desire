//! HTTP contract and integration checks against the real persistence adapters.
mod support;

use axum::http::{Method, StatusCode};
use desire_core::contracts::campaign::{Character, Scene};
use serde_json::json;
use support::{TestDb, call, call_with_headers, id, map_version, uri};

#[test]
fn scenes_are_created_read_updated_and_isolated_by_campaign() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign_id = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        &app,
        &campaign_id,
        &owner,
        &player,
        "player",
    ));

    let forbidden = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/scenes"),
        Some(&player),
        Some(json!({"name": "Dock", "map_version_id": map_version()})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let created = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/scenes"),
        Some(&owner),
        Some(json!({"name": "Dock", "map_version_id": map_version()})),
    ));
    assert_eq!(created.status, StatusCode::CREATED);
    let scene: Scene = serde_json::from_value(created.body.clone()).unwrap();
    assert_eq!(scene.revision, 1);

    let read = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        Some(&player),
        None,
    ));
    assert_eq!(read.status, StatusCode::OK);
    assert_eq!(read.body["name"], "Dock");

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        Some(&owner),
        Some(json!({"name": "Harbor", "map_version_id": map_version(),
            "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK);
    assert_eq!(updated.body["name"], "Harbor");
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        Some(&owner),
        Some(json!({"name": "Stale", "map_version_id": map_version(),
            "expected_revision": 1})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let other_campaign = support::run(support::campaign(&app, &id(95)));
    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&other_campaign, &format!("/scenes/{}", scene.id)),
        Some(&id(95)),
        None,
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);

    // Every scene create emits a D08 outbox event; hard deletion would destroy that history.
    let deleted = support::run(call(
        &app,
        Method::DELETE,
        &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        Some(&owner),
        None,
    ));
    assert_eq!(deleted.status, StatusCode::CONFLICT);
    assert_eq!(deleted.body["code"], "resource_in_use");
}

#[test]
fn scenes_of_unknown_or_foreign_ids_return_not_found() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));

    let unknown = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/scenes/{}", id(999))),
        Some(&owner),
        None,
    ));
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);

    let missing_map = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/scenes"),
        Some(&owner),
        Some(json!({"name": "Orphan", "map_version_id": id(998)})),
    ));
    assert_eq!(missing_map.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing_map.body["code"], "invalid_request");
}

#[test]
fn characters_enforce_membership_edition_and_revisions() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign_id = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        &app,
        &campaign_id,
        &owner,
        &player,
        "player",
    ));

    let outsider_controller = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/characters"),
        Some(&owner),
        Some(json!({"name": "Npc", "controller_id": id(93),
            "rules_edition": "dnd_2014"})),
    ));
    assert_eq!(
        outsider_controller.status,
        StatusCode::BAD_REQUEST,
        "{}",
        outsider_controller.body
    );

    let forbidden = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/characters"),
        Some(&player),
        Some(json!({"name": "Hero", "controller_id": player,
            "rules_edition": "dnd_2014"})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let character = support::run(support::create_character(&app, &campaign_id, &owner));
    let character_id = character["id"].as_str().unwrap().to_string();
    let parsed: Character = serde_json::from_value(character).unwrap();
    assert_eq!(parsed.revision, 1);

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/characters/{character_id}")),
        Some(&owner),
        Some(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK);
    assert_eq!(updated.body["controller_id"], player);
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/characters/{character_id}")),
        Some(&owner),
        Some(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let deleted = support::run(call(
        &app,
        Method::DELETE,
        &uri(&campaign_id, &format!("/characters/{character_id}")),
        Some(&owner),
        None,
    ));
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let gone = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/characters/{character_id}")),
        Some(&owner),
        None,
    ));
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
}

#[test]
fn scene_idempotency_key_is_validated_before_the_write() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let body = json!({"name": "Dock", "map_version_id": map_version()});

    let invalid = support::run(call_with_headers(
        &app,
        Method::POST,
        &uri(&campaign_id, "/scenes"),
        Some(&owner),
        Some(body.clone()),
        &[("idempotency-key", "not-a-uuid")],
    ));
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid.body["code"], "invalid_request");

    let accepted = support::run(call_with_headers(
        &app,
        Method::POST,
        &uri(&campaign_id, "/scenes"),
        Some(&owner),
        Some(body),
        &[("idempotency-key", &id(500))],
    ));
    assert_eq!(accepted.status, StatusCode::CREATED, "{}", accepted.body);
}
