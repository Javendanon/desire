//! HTTP contract and integration checks against the real persistence adapters.
mod support;

use axum::http::{Method, StatusCode};
use serde_json::json;
use support::{TestDb, call, id, uri};

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
    let session = id(70);
    db.seed_session(&campaign_id, &session);

    for (body, visibility) in [("Public recap", "players"), ("Secret plans", "dm")] {
        let created = support::run(call(
            &app,
            Method::POST,
            &uri(&campaign_id, "/journal"),
            Some(&owner),
            Some(json!({"session_id": session, "body": body, "visibility": visibility})),
        ));
        assert_eq!(created.status, StatusCode::CREATED, "{}", created.body);
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
    let dm_entry_id = dm_list.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["visibility"] == "dm")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let player_creates_dm = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/journal"),
        Some(&player),
        Some(json!({"session_id": session, "body": "Player secret", "visibility": "dm"})),
    ));
    assert_eq!(player_creates_dm.status, StatusCode::FORBIDDEN);

    let player_entry = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/journal"),
        Some(&player),
        Some(json!({"session_id": session, "body": "Player note", "visibility": "players"})),
    ));
    assert_eq!(player_entry.status, StatusCode::CREATED);

    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/journal/{dm_entry_id}")),
        Some(&player),
        None,
    ));
    assert_ne!(hidden.status, StatusCode::OK);
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

    let provenance = json!({"source": "Synthetic", "attribution": "Synthetic",
        "evidence": "synthetic"});
    for (title, visibility) in [("Public lore", "players"), ("Dm lore", "dm")] {
        let created = support::run(call(
            &app,
            Method::POST,
            &uri(&campaign_id, "/knowledge"),
            Some(&owner),
            Some(json!({"title": title, "body": "Synthetic body",
                "visibility": visibility, "provenance": provenance})),
        ));
        assert_eq!(created.status, StatusCode::CREATED, "{}", created.body);
    }

    let forbidden = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/knowledge"),
        Some(&player),
        Some(
            json!({"title": "Player lore", "body": "Body", "visibility": "players",
            "provenance": provenance}),
        ),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let player_list = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, "/knowledge"),
        Some(&player),
        None,
    ));
    assert_eq!(player_list.status, StatusCode::OK);
    assert_eq!(player_list.body["items"].as_array().unwrap().len(), 1);

    let hidden = support::run(call(
        &app,
        Method::GET,
        &uri(&campaign_id, &format!("/knowledge/{}", id(999))),
        Some(&player),
        None,
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);
}

#[test]
fn note_updates_and_deletes_use_expected_revisions() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let session = id(70);
    db.seed_session(&campaign_id, &session);

    let journal = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/journal"),
        Some(&owner),
        Some(json!({"session_id": session, "body": "Original", "visibility": "players"})),
    ));
    assert_eq!(journal.status, StatusCode::CREATED, "{}", journal.body);
    let journal_id = journal.body["id"].as_str().unwrap().to_string();

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/journal/{journal_id}")),
        Some(&owner),
        Some(json!({"body": "Edited", "visibility": "dm", "expected_revision": 1})),
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
        Some(json!({"body": "Stale", "visibility": "dm", "expected_revision": 1})),
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

    let provenance = json!({"source": "Synthetic", "attribution": "Synthetic",
        "evidence": "synthetic"});
    let knowledge = support::run(call(
        &app,
        Method::POST,
        &uri(&campaign_id, "/knowledge"),
        Some(&owner),
        Some(
            json!({"title": "Original", "body": "Body", "visibility": "players",
            "provenance": provenance}),
        ),
    ));
    assert_eq!(knowledge.status, StatusCode::CREATED, "{}", knowledge.body);
    let knowledge_id = knowledge.body["id"].as_str().unwrap().to_string();

    let updated = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/knowledge/{knowledge_id}")),
        Some(&owner),
        Some(
            json!({"title": "Edited", "body": "New body", "visibility": "dm",
            "provenance": provenance, "expected_revision": 1}),
        ),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);
    assert_eq!(updated.body["title"], "Edited");
    assert_eq!(updated.body["revision"], 2);

    let stale = support::run(call(
        &app,
        Method::PATCH,
        &uri(&campaign_id, &format!("/knowledge/{knowledge_id}")),
        Some(&owner),
        Some(json!({"title": "Stale", "body": "Body", "visibility": "dm",
            "provenance": provenance, "expected_revision": 1})),
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
