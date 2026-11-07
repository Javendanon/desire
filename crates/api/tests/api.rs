//! HTTP contract and integration checks against the real persistence adapters.
mod support;

mod auth;
mod character_revision;
mod db_timeout;
mod diagnostics;
mod idempotency;
mod identity_concurrency;
mod isolation;
mod layers;
mod login_admission;
mod login_proxy;
mod nivel20;
mod notes;
mod oidc_flow;
mod oidc_provider;
mod oidc_security;
mod outage;
mod outage_proxy;
mod pagination_contract;
mod patch_response;
mod realtime;
mod resources;
mod scene_concurrency;
mod server;
mod server_policy;
mod static_files;

use axum::http::{Method, StatusCode};
use desire_core::contracts::campaign::Campaign;
use serde_json::json;
use support::{TestDb, call, id, map_version, uri};

#[test]
fn health_stays_public() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let response = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/health"),
    ));
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body["status"], "ok");
}

#[test]
fn protected_routes_require_a_caller_identity() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let missing = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns"),
    ));
    assert_eq!(missing.status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing.body["code"], "unauthenticated");
    assert_eq!(missing.body["request_id"].as_str().unwrap().len(), 36);

    let invalid = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns").by("not-a-uuid"),
    ));
    assert_eq!(invalid.status, StatusCode::UNAUTHORIZED);
    assert_eq!(invalid.body["code"], "unauthenticated");
}

#[test]
fn malformed_path_identifiers_are_rejected() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let response = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns/not-a-uuid").by(&id(90)),
    ));
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.body["code"], "invalid_request");
}

#[test]
fn campaign_create_read_and_contract_shape() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));

    let response = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &uri(&campaign_id, "")).by(&owner),
    ));
    assert_eq!(response.status, StatusCode::OK);
    let campaign: Campaign = serde_json::from_value(response.body).unwrap();
    assert_eq!(campaign.id, campaign_id);
    assert_eq!(campaign.owner_id, owner);
    assert_eq!(campaign.revision, 1);
    assert_eq!(campaign.city_id.as_deref(), Some(id(3).as_str()));

    let list = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns").by(&owner),
    ));
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.body["items"].as_array().unwrap().len(), 1);
    assert_eq!(list.body["items"][0]["id"], campaign_id);
}

#[test]
fn campaign_lists_only_include_the_callers_memberships() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let first = support::run(support::campaign(&app, &id(90)));
    let second = support::run(support::campaign(&app, &id(91)));

    let first_list = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns").by(&id(90)),
    ));
    let ids: Vec<&str> = first_list.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec![first.as_str()]);
    assert!(!ids.contains(&second.as_str()));
}

#[test]
fn cross_campaign_reads_are_hidden() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));

    let other = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &uri(&campaign_id, "")).by(&id(91)),
    ));
    assert_eq!(other.status, StatusCode::NOT_FOUND);
    assert_eq!(other.body["code"], "not_found");

    let scene = support::run(call(
        &app,
        support::ApiCall::new(
            Method::GET,
            &uri(&campaign_id, &format!("/scenes/{}", id(902))),
        )
        .by(&id(91)),
    ));
    assert_eq!(scene.status, StatusCode::NOT_FOUND);
}

#[test]
fn campaign_rename_requires_dm_and_current_revision() {
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
        support::ApiCall::new(Method::PATCH, &uri(&campaign_id, ""))
            .by(&player)
            .json(json!({"name": "Renamed", "expected_revision": 1})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);
    assert_eq!(forbidden.body["code"], "forbidden");

    let stale = support::run(call(
        &app,
        support::ApiCall::new(Method::PATCH, &uri(&campaign_id, ""))
            .by(&owner)
            .json(json!({"name": "Renamed", "expected_revision": 7})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(stale.body["code"], "revision_conflict");

    let renamed = support::run(call(
        &app,
        support::ApiCall::new(Method::PATCH, &uri(&campaign_id, ""))
            .by(&owner)
            .json(json!({"name": "Renamed", "expected_revision": 1})),
    ));
    assert_eq!(renamed.status, StatusCode::OK);
    assert_eq!(renamed.body["name"], "Renamed");
    assert_eq!(renamed.body["revision"], 2);
}

#[test]
fn members_are_listed_added_and_removed_without_touching_the_owner() {
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

    let duplicate = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/members"))
            .by(&owner)
            .json(json!({"user_id": player, "role": "player"})),
    ));
    assert_eq!(duplicate.status, StatusCode::CONFLICT);
    assert_eq!(duplicate.body["code"], "conflict");

    let players_add = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, &uri(&campaign_id, "/members"))
            .by(&player)
            .json(json!({"user_id": id(92), "role": "player"})),
    ));
    assert_eq!(players_add.status, StatusCode::FORBIDDEN);

    let list = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &uri(&campaign_id, "/members")).by(&player),
    ));
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.body["items"].as_array().unwrap().len(), 2);

    let owner_removal = support::run(call(
        &app,
        support::ApiCall::new(
            Method::DELETE,
            &uri(&campaign_id, &format!("/members/{owner}")),
        )
        .by(&owner),
    ));
    assert_eq!(owner_removal.status, StatusCode::CONFLICT);
    assert_eq!(owner_removal.body["code"], "conflict");

    let removed = support::run(call(
        &app,
        support::ApiCall::new(
            Method::DELETE,
            &uri(&campaign_id, &format!("/members/{player}")),
        )
        .by(&owner),
    ));
    assert_eq!(removed.status, StatusCode::NO_CONTENT);

    let after = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, &uri(&campaign_id, "/members")).by(&owner),
    ));
    assert_eq!(after.body["items"].as_array().unwrap().len(), 1);
}

#[test]
fn pagination_limits_offsets_and_validation() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    for _ in 0..3 {
        support::run(support::campaign(&app, &id(90)));
    }

    let first = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns?limit=2").by(&id(90)),
    ));
    assert_eq!(first.body["items"].as_array().unwrap().len(), 2);
    assert_eq!(first.body["has_more"], true);

    let second = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns?limit=2&offset=2").by(&id(90)),
    ));
    assert_eq!(second.body["items"].as_array().unwrap().len(), 1);
    assert_eq!(second.body["has_more"], false);

    for query in [
        "limit=0",
        "limit=101",
        "limit=abc",
        "limit=-1",
        "offset=not-a-number",
    ] {
        let response = support::run(call(
            &app,
            support::ApiCall::new(Method::GET, &format!("/api/v1/campaigns?{query}")).by(&id(90)),
        ));
        assert_eq!(response.status, StatusCode::BAD_REQUEST, "{query}");
        assert_eq!(response.body["code"], "invalid_request", "{query}");
        assert_eq!(
            response.body["request_id"].as_str().unwrap().len(),
            36,
            "{query}"
        );
    }
}

#[test]
fn invalid_requests_and_unknown_ids_are_reported_consistently() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);

    let blank = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, "/api/v1/campaigns")
            .by(&owner)
            .json(json!({"name": "   ", "rules_edition": "dnd_2014", "city_id": null})),
    ));
    assert_eq!(blank.status, StatusCode::BAD_REQUEST);
    assert_eq!(blank.body["code"], "invalid_request");

    let unknown_field = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, "/api/v1/campaigns")
            .by(&owner)
            .json(
                json!({"name": "Valid", "rules_edition": "dnd_2014", "city_id": null,
            "extra": true}),
            ),
    ));
    assert_eq!(unknown_field.status, StatusCode::BAD_REQUEST);

    let bad_edition = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, "/api/v1/campaigns")
            .by(&owner)
            .json(json!({"name": "Valid", "rules_edition": "dnd_1999", "city_id": null})),
    ));
    assert_eq!(bad_edition.status, StatusCode::BAD_REQUEST);

    for path in [
        format!("/api/v1/campaigns/{}", id(900)),
        uri(&id(900), &format!("/scenes/{}", id(901))),
        uri(&id(900), &format!("/characters/{}", id(902))),
        uri(&id(900), &format!("/journal/{}", id(903))),
        uri(&id(900), &format!("/knowledge/{}", id(904))),
    ] {
        let response = support::run(call(
            &app,
            support::ApiCall::new(Method::GET, &path).by(&owner),
        ));
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }
}

#[test]
fn updates_of_missing_resources_return_not_found() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let provenance = json!({"source": "Synthetic", "attribution": "Synthetic",
        "evidence": "synthetic"});
    let cases = [
        (
            format!("/api/v1/campaigns/{}", id(900)),
            json!({"name": "Missing", "expected_revision": 1}),
        ),
        (
            uri(&campaign_id, &format!("/scenes/{}", id(901))),
            json!({"name": "Missing", "map_version_id": map_version(),
                "expected_revision": 1}),
        ),
        (
            uri(&campaign_id, &format!("/characters/{}", id(902))),
            json!({"name": "Missing", "controller_id": null, "expected_revision": 1}),
        ),
        (
            uri(&campaign_id, &format!("/journal/{}", id(903))),
            json!({"body": "Missing", "visibility": "players", "expected_revision": 1}),
        ),
        (
            uri(&campaign_id, &format!("/knowledge/{}", id(904))),
            json!({"title": "Missing", "body": "Missing", "visibility": "players",
                "provenance": provenance, "expected_revision": 1}),
        ),
    ];
    for (path, body) in cases {
        let response = support::run(call(
            &app,
            support::ApiCall::new(Method::PATCH, &path)
                .by(&owner)
                .json(body),
        ));
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(response.body["code"], "not_found", "{path}");
    }
}

#[test]
fn text_with_nul_characters_is_rejected_before_the_database() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);

    let created = support::run(call(
        &app,
        support::ApiCall::new(Method::POST, "/api/v1/campaigns")
            .by(&owner)
            .json(json!({"name": "Nul\u{0}name", "rules_edition": "dnd_2014", "city_id": null})),
    ));
    assert_eq!(created.status, StatusCode::BAD_REQUEST, "{}", created.body);
    assert_eq!(created.body["code"], "invalid_request");

    let campaign_id = support::run(support::campaign(&app, &owner));
    let session = support::run(support::create_session(&app, &campaign_id, &owner));
    let entry = support::run(support::create_journal(
        support::Actor::new(&app, &campaign_id, &owner),
        session["id"].as_str().unwrap(),
        "players",
    ));
    let patched = support::run(call(
        &app,
        support::ApiCall::new(
            Method::PATCH,
            &uri(
                &campaign_id,
                &format!("/journal/{}", entry["id"].as_str().unwrap()),
            ),
        )
        .by(&owner)
        .json(json!({"body": "Nul\u{0}body", "visibility": "players",
            "expected_revision": 1})),
    ));
    assert_eq!(patched.status, StatusCode::BAD_REQUEST, "{}", patched.body);
    assert_eq!(patched.body["code"], "invalid_request");
}

#[test]
fn the_api_reconnects_after_the_database_drops_the_connection() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    support::run(support::campaign(&app, &owner));
    db.drop_connections();

    // The next request notices the dead socket before running work and replaces the client.
    let recovered = support::run(call(
        &app,
        support::ApiCall::new(Method::GET, "/api/v1/campaigns").by(&owner),
    ));
    assert_eq!(recovered.status, StatusCode::OK, "{}", recovered.body);
    assert_eq!(recovered.body["items"].as_array().unwrap().len(), 1);
}
