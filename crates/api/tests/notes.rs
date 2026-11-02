//! HTTP contract and integration checks against the real persistence adapters.
use crate::support;

use axum::http::{Method, StatusCode};
use serde_json::Value;
use support::{TestDb, call, id, uri};

fn hidden_id(list: &Value, visibility: &str) -> String {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["visibility"] == visibility)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn sessions_are_created_by_dms_and_listed_by_members() {
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
        &uri(&campaign_id, "/sessions"),
        Some(&player),
        Some(serde_json::json!({"title": "Player session"})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let created = support::run(support::create_session(&app, &campaign_id, &owner));
    assert_eq!(created["revision"], 1);

    let list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/sessions"),
        Some(&player),
        None,
    ));
    assert_eq!(list.status, StatusCode::OK, "{}", list.body);
    assert_eq!(list.body["items"].as_array().unwrap().len(), 1);
}

#[test]
fn journal_entries_filter_dm_visibility_for_players() {
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
    let session = support::run(support::create_session(&app, &campaign_id, &owner));
    let session_id = session["id"].as_str().unwrap().to_string();

    for visibility in ["players", "dm"] {
        let created = support::run(support::create_journal(
            &app,
            &campaign_id,
            &owner,
            &session_id,
            visibility,
        ));
        assert_eq!(created["visibility"], visibility);
    }

    let player_list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/journal"),
        Some(&player),
        None,
    ));
    assert_eq!(player_list.status, StatusCode::OK);
    assert_eq!(player_list.body["items"].as_array().unwrap().len(), 1);

    let dm_list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/journal"),
        Some(&owner),
        None,
    ));
    assert_eq!(dm_list.body["items"].as_array().unwrap().len(), 2);
    let dm_entry_id = hidden_id(&dm_list.body, "dm");

    let player_creates_dm = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/journal"),
        Some(&player),
        Some(
            serde_json::json!({"session_id": session_id, "body": "Player secret",
            "visibility": "dm"}),
        ),
    ));
    assert_eq!(player_creates_dm.status, StatusCode::FORBIDDEN);

    let player_entry = support::run(support::create_journal(
        &app,
        &campaign_id,
        &player,
        &session_id,
        "players",
    ));
    assert_eq!(player_entry["visibility"], "players");

    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/journal/{dm_entry_id}")),
        Some(&player),
        None,
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND, "{}", hidden.body);
    assert_eq!(hidden.body["code"], "not_found");
}

#[test]
fn journal_sessions_must_belong_to_the_campaign() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let other_campaign = support::run(support::campaign(&app, &id(95)));
    let foreign = support::run(support::create_session(&app, &other_campaign, &id(95)));
    let foreign_id = foreign["id"].as_str().unwrap().to_string();

    let rejected = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/journal"),
        Some(&owner),
        Some(
            serde_json::json!({"session_id": foreign_id, "body": "Synthetic recap",
            "visibility": "players"}),
        ),
    ));
    assert_eq!(
        rejected.status,
        StatusCode::BAD_REQUEST,
        "{}",
        rejected.body
    );
    assert_eq!(rejected.body["code"], "invalid_request");
}

#[test]
fn knowledge_filters_dm_entries_and_only_dms_write() {
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
        &uri(&campaign_id, "/knowledge"),
        Some(&player),
        Some(serde_json::json!({"title": "Player lore", "body": "Body",
            "visibility": "players", "provenance": support::provenance()})),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    for visibility in ["players", "dm"] {
        support::run(support::create_knowledge(
            &app,
            &campaign_id,
            &owner,
            visibility,
        ));
    }

    let player_list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/knowledge"),
        Some(&player),
        None,
    ));
    assert_eq!(player_list.status, StatusCode::OK);
    assert_eq!(player_list.body["items"].as_array().unwrap().len(), 1);

    let dm_list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/knowledge"),
        Some(&owner),
        None,
    ));
    let dm_entry_id = hidden_id(&dm_list.body, "dm");

    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/knowledge/{dm_entry_id}")),
        Some(&player),
        None,
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND, "{}", hidden.body);
    assert_eq!(hidden.body["code"], "not_found");
}

#[test]
fn note_updates_and_deletes_use_expected_revisions() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let session = support::run(support::create_session(&app, &campaign_id, &owner));
    let session_id = session["id"].as_str().unwrap().to_string();

    let journal = support::run(support::create_journal(
        &app,
        &campaign_id,
        &owner,
        &session_id,
        "players",
    ));
    let journal_id = journal["id"].as_str().unwrap().to_string();

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/journal/{journal_id}")),
        Some(&owner),
        Some(serde_json::json!({"body": "Edited", "visibility": "dm",
            "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);
    assert_eq!(updated.body["body"], "Edited");
    assert_eq!(updated.body["visibility"], "dm");
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/journal/{journal_id}")),
        Some(&owner),
        Some(serde_json::json!({"body": "Stale", "visibility": "dm",
            "expected_revision": 1})),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let deleted = support::run(call(
        &app,
        Method::DELETE,
        &uri(&campaign_id, &format!("/journal/{journal_id}")),
        Some(&owner),
        None,
    ));
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let knowledge = support::run(support::create_knowledge(
        &app,
        &campaign_id,
        &owner,
        "players",
    ));
    let knowledge_id = knowledge["id"].as_str().unwrap().to_string();

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/knowledge/{knowledge_id}")),
        Some(&owner),
        Some(serde_json::json!({"title": "Edited", "body": "New body",
            "visibility": "dm", "provenance": support::provenance(),
            "expected_revision": 1})),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);
    assert_eq!(updated.body["title"], "Edited");
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/knowledge/{knowledge_id}")),
        Some(&owner),
        Some(
            serde_json::json!({"title": "Stale", "body": "Body", "visibility": "dm",
            "provenance": support::provenance(), "expected_revision": 1}),
        ),
    ));
    assert_eq!(stale.status, StatusCode::CONFLICT);

    let deleted = support::run(call(
        &app,
        Method::DELETE,
        &uri(&campaign_id, &format!("/knowledge/{knowledge_id}")),
        Some(&owner),
        None,
    ));
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let other_campaign = support::run(support::campaign(&app, &id(95)));
    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&other_campaign, "/knowledge"),
        Some(&id(95)),
        None,
    ));
    assert_eq!(hidden.status, StatusCode::OK);
    assert_eq!(hidden.body["items"].as_array().unwrap().len(), 0);
}
