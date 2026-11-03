//! HTTP contract and integration checks against the real persistence adapters.
use crate::support;

use axum::http::{Method, StatusCode};
use desire_core::contracts::campaign::{Character, Scene};
use serde_json::json;
use support::{TestDb, call, id, map_version, uri};

#[test]
fn scenes_are_created_read_updated_and_isolated_by_campaign() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign_id = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        support::Actor::new(&app, &campaign_id, &owner),
        &player,
        "player",
    ));

    let forbidden = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&player)
            .json(json!({"name": "Dock", "map_version_id": map_version()})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let created = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(json!({"name": "Dock", "map_version_id": map_version()})),
    ));
    assert_eq!(created.status, StatusCode::CREATED);
    let scene: Scene = serde_json::from_value(created.body.clone()).unwrap();
    assert_eq!(scene.revision, 1);

    let read = support::run(call(
        &app,
        support::ApiCall::new(
            Method::GET,
            &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        )
        .by(&player),
    ));
    assert_eq!(read.status, StatusCode::OK);
    assert_eq!(read.body["name"], "Dock");

    let updated = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        )
        .by(&owner)
        .json(json!({"name": "Harbor", "map_version_id": map_version(),
            "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK);
    assert_eq!(updated.body["name"], "Harbor");
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        )
        .by(&owner)
        .json(json!({"name": "Stale", "map_version_id": map_version(),
            "expected_revision": 1})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let other_campaign = support::run(support::campaign(&app, &id(95)));
    let hidden = support::run(call(
        &app,
        support::ApiCall::new(
            Method::GET,
            &uri(&other_campaign, &format!("/scenes/{}", scene.id)),
        )
        .by(&id(95)),
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);

    // Every scene create keeps a D08 outbox event that references the scene, so v1 exposes
    // no scene deletion instead of an endpoint that can only answer 409.
    let deleted = support::run(call(
        &app,
        support::ApiCall::new(
            Method::DELETE,
            &uri(&campaign_id, &format!("/scenes/{}", scene.id)),
        )
        .by(&owner),
    ));
    assert_eq!(deleted.status, StatusCode::METHOD_NOT_ALLOWED);
}

#[test]
fn scenes_of_unknown_or_foreign_ids_return_not_found() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));

    let unknown = support::run(call(
        &app,
        support::ApiCall::new(
            Method::GET,
            &uri(&campaign_id, &format!("/scenes/{}", id(999))),
        )
        .by(&owner),
    ));
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);

    let missing_map = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(json!({"name": "Orphan", "map_version_id": id(998)})),
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
        support::Actor::new(&app, &campaign_id, &owner),
        &player,
        "player",
    ));

    let outsider_controller = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/characters"))
            .by(&owner)
            .json(json!({"name": "Npc", "controller_id": id(93),
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
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/characters"))
            .by(&player)
            .json(json!({"name": "Hero", "controller_id": player,
            "rules_edition": "dnd_2014"})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let character = support::run(support::create_character(&app, &campaign_id, &owner));
    let character_id = character["id"].as_str().unwrap().to_string();
    let parsed: Character = serde_json::from_value(character).unwrap();
    assert_eq!(parsed.revision, 1);

    let updated = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(&campaign_id, &format!("/characters/{character_id}")),
        )
        .by(&owner)
        .json(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK);
    assert_eq!(updated.body["controller_id"], player);
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(&campaign_id, &format!("/characters/{character_id}")),
        )
        .by(&owner)
        .json(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let deleted = support::run(call(
        &app,
        support::ApiCall::new(
            Method::DELETE,
            &uri(&campaign_id, &format!("/characters/{character_id}")),
        )
        .by(&owner),
    ));
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let gone = support::run(call(
        &app,
        support::ApiCall::new(
            Method::GET,
            &uri(&campaign_id, &format!("/characters/{character_id}")),
        )
        .by(&owner),
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

    let invalid = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(body.clone())
            .headers(&[("idempotency-key", "not-a-uuid")]),
    ));
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid.body["code"], "invalid_request");

    let accepted = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(body)
            .headers(&[("idempotency-key", &id(500))]),
    ));
    assert_eq!(accepted.status, StatusCode::CREATED, "{}", accepted.body);
}

#[test]
fn scene_creation_replays_the_first_result_for_the_same_key() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let key = id(500);
    let body = json!({"name": "Dock", "map_version_id": map_version()});
    let headers = [("idempotency-key", key.as_str())];

    let first = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(body.clone())
            .headers(&headers),
    ));
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.body);

    let retried = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(body)
            .headers(&headers),
    ));
    assert_eq!(retried.status, StatusCode::CREATED, "{}", retried.body);
    assert_eq!(retried.body["id"], first.body["id"]);
    assert_eq!(retried.body["revision"], 1);

    let events: i64 = db
        .connection()
        .query_one(
            "SELECT count(*) FROM campaign.outbox WHERE campaign_id = $1::text::uuid",
            &[&campaign_id],
        )
        .unwrap()
        .get(0);
    assert_eq!(events, 1);

    let different = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/scenes"))
            .by(&owner)
            .json(json!({"name": "Harbor", "map_version_id": map_version()}))
            .headers(&headers),
    ));
    assert_eq!(different.status, StatusCode::CONFLICT, "{}", different.body);
    assert_eq!(different.body["code"], "idempotency_conflict");
}

#[test]
fn characters_need_an_explicit_controller_on_update_and_hide_it_from_players() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign_id = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        support::Actor::new(&app, &campaign_id, &owner),
        &player,
        "player",
    ));
    let character = support::run(support::create_character(&app, &campaign_id, &owner));
    let path = uri(
        &campaign_id,
        &format!("/characters/{}", character["id"].as_str().unwrap()),
    );

    let hidden = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &path).by(&player),
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND, "{}", hidden.body);

    let omitted = support::run(call(
        &app,
        support::ApiCall::new(Method::PATCH, &path)
            .by(&owner)
            .json(json!({"name": "Hero", "expected_revision": 1})),
    ));
    assert_eq!(omitted.status, StatusCode::BAD_REQUEST, "{}", omitted.body);
    assert_eq!(omitted.body["code"], "invalid_request");

    let assigned = support::run(call(
        &app,
        support::ApiCall::new(Method::PATCH, &path)
            .by(&owner)
            .json(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(assigned.status, StatusCode::OK, "{}", assigned.body);

    let visible = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &path).by(&player),
    ));
    assert_eq!(visible.status, StatusCode::OK, "{}", visible.body);
    assert_eq!(visible.body["controller_id"], player);

    // Clearing the controller must move the actor row back to DM-only, so the character
    // becomes an NPC the player can no longer read.
    let cleared = support::run(call(
        &app,
        support::ApiCall::new(Method::PATCH, &path)
            .by(&owner)
            .json(json!({"name": "Hero", "controller_id": null, "expected_revision": 2})),
    ));
    assert_eq!(cleared.status, StatusCode::OK, "{}", cleared.body);
    assert_eq!(cleared.body["controller_id"], serde_json::Value::Null);
    assert_eq!(cleared.body["revision"], 3);

    let hidden_again = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &path).by(&player),
    ));
    assert_eq!(
        hidden_again.status,
        StatusCode::NOT_FOUND,
        "{}",
        hidden_again.body
    );
    let still_visible_to_dm = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &path).by(&owner),
    ));
    assert_eq!(
        still_visible_to_dm.status,
        StatusCode::OK,
        "{}",
        still_visible_to_dm.body
    );
}

#[test]
fn removing_a_member_who_controls_a_character_is_a_conflict() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let player = id(91);
    let campaign_id = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        support::Actor::new(&app, &campaign_id, &owner),
        &player,
        "player",
    ));
    let character = support::run(support::create_character(&app, &campaign_id, &owner));
    let assigned = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(
                &campaign_id,
                &format!("/characters/{}", character["id"].as_str().unwrap()),
            ),
        )
        .by(&owner)
        .json(json!({"name": "Hero", "controller_id": player, "expected_revision": 1})),
    ));
    assert_eq!(assigned.status, StatusCode::OK, "{}", assigned.body);

    let removed = support::run(call(
        &app,
        support::ApiCall::new(
            Method::DELETE,
            &uri(&campaign_id, &format!("/members/{player}")),
        )
        .by(&owner),
    ));
    assert_eq!(removed.status, StatusCode::CONFLICT, "{}", removed.body);
    assert_eq!(removed.body["code"], "resource_in_use");
}
