//! Cross-campaign and role isolation for every campaign-owned resource.
mod support;

use axum::{
    Router,
    http::{Method, StatusCode},
};
use serde_json::{Value, json};
use support::{Response, TestDb, call, id, map_version, uri};

/// One row created by the campaign's DM, plus what a player may see and whether v1 can
/// delete it (scenes cannot: their outbox events are history).
struct Row {
    suffix: String,
    patch: Value,
    player_reads: bool,
    deletable: bool,
}

fn fixtures(app: &Router, campaign_id: &str, owner: &str, player: &str) -> Vec<Row> {
    let scene = support::run(support::create_scene(app, campaign_id, owner));
    let character = support::run(support::create_character(app, campaign_id, owner));
    let session = support::run(support::create_session(app, campaign_id, owner));
    let session_id = session["id"].as_str().unwrap().to_string();
    let recap = support::run(support::create_journal(
        app,
        campaign_id,
        owner,
        &session_id,
        "players",
    ));
    let secret = support::run(support::create_journal(
        app,
        campaign_id,
        owner,
        &session_id,
        "dm",
    ));
    let lore = support::run(support::create_knowledge(
        app,
        campaign_id,
        owner,
        "players",
    ));
    let hidden_lore = support::run(support::create_knowledge(app, campaign_id, owner, "dm"));

    assert_eq!(character["controller_id"], Value::Null);
    let provenance = json!({"source": "Synthetic", "attribution": "Synthetic",
        "evidence": "synthetic"});
    let rows = vec![
        Row {
            suffix: format!("/scenes/{}", text(&scene, "id")),
            patch: json!({"name": "Denied", "map_version_id": map_version(),
                "expected_revision": 1}),
            player_reads: true,
            deletable: false,
        },
        Row {
            suffix: format!("/characters/{}", text(&character, "id")),
            patch: json!({"name": "Denied", "controller_id": player, "expected_revision": 1}),
            player_reads: false,
            deletable: true,
        },
        Row {
            suffix: format!("/journal/{}", text(&recap, "id")),
            patch: json!({"body": "Denied", "visibility": "players", "expected_revision": 1}),
            player_reads: true,
            deletable: true,
        },
        Row {
            suffix: format!("/journal/{}", text(&secret, "id")),
            patch: json!({"body": "Denied", "visibility": "dm", "expected_revision": 1}),
            player_reads: false,
            deletable: true,
        },
        Row {
            suffix: format!("/knowledge/{}", text(&lore, "id")),
            patch: json!({"title": "Denied", "body": "Denied", "visibility": "players",
                "provenance": provenance, "expected_revision": 1}),
            player_reads: true,
            deletable: true,
        },
        Row {
            suffix: format!("/knowledge/{}", text(&hidden_lore, "id")),
            patch: json!({"title": "Denied", "body": "Denied", "visibility": "dm",
                "provenance": provenance, "expected_revision": 1}),
            player_reads: false,
            deletable: true,
        },
    ];
    rows
}

fn text(body: &Value, field: &str) -> String {
    body[field].as_str().unwrap().to_string()
}

fn assert_denied(response: &Response, status: StatusCode, code: &str, case: &str) {
    assert_eq!(response.status, status, "{case}: {}", response.body);
    assert_eq!(response.body["code"], code, "{case}: {}", response.body);
}

#[test]
fn non_members_and_foreign_dms_cannot_touch_another_campaign() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));
    let other_dm = id(95);
    support::run(support::campaign(&app, &other_dm));
    let outsider = id(92);

    for row in fixtures(&app, &campaign_id, &owner, &id(91)) {
        let path = uri(&campaign_id, &row.suffix);
        for caller in [&outsider, &other_dm] {
            let read = support::run(call(&app, Method::GET, &path, Some(caller), None));
            assert_denied(&read, StatusCode::NOT_FOUND, "not_found", &path);
            let patched = support::run(call(
                &app,
                Method::PATCH,
                &path,
                Some(caller),
                Some(row.patch.clone()),
            ));
            assert_denied(&patched, StatusCode::NOT_FOUND, "not_found", &path);
            if row.deletable {
                let deleted = support::run(call(&app, Method::DELETE, &path, Some(caller), None));
                assert_denied(&deleted, StatusCode::NOT_FOUND, "not_found", &path);
            }
        }
        let unchanged = support::run(call(&app, Method::GET, &path, Some(&owner), None));
        assert_eq!(
            unchanged.status,
            StatusCode::OK,
            "{path}: {}",
            unchanged.body
        );
        assert_eq!(unchanged.body["revision"], 1, "{path}: {}", unchanged.body);
    }
}

#[test]
fn players_cannot_write_and_only_read_player_visible_rows() {
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

    for row in fixtures(&app, &campaign_id, &owner, &player) {
        let path = uri(&campaign_id, &row.suffix);
        let read = support::run(call(&app, Method::GET, &path, Some(&player), None));
        let expected = if row.player_reads {
            StatusCode::OK
        } else {
            StatusCode::NOT_FOUND
        };
        assert_eq!(read.status, expected, "{path}: {}", read.body);

        let patched = support::run(call(
            &app,
            Method::PATCH,
            &path,
            Some(&player),
            Some(row.patch.clone()),
        ));
        assert_denied(&patched, StatusCode::FORBIDDEN, "forbidden", &path);
        if row.deletable {
            let deleted = support::run(call(&app, Method::DELETE, &path, Some(&player), None));
            assert_denied(&deleted, StatusCode::FORBIDDEN, "forbidden", &path);
        }
    }
}

#[test]
fn player_collections_hide_dm_only_rows() {
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
    fixtures(&app, &campaign_id, &owner, &player);

    // The only character is an uncontrolled NPC, so it is DM-only.
    for (collection, player_count, dm_count) in
        [("characters", 0, 1), ("journal", 1, 2), ("knowledge", 1, 2)]
    {
        let path = uri(&campaign_id, &format!("/{collection}"));
        let as_player = support::run(call(&app, Method::GET, &path, Some(&player), None));
        assert_eq!(
            as_player.status,
            StatusCode::OK,
            "{path}: {}",
            as_player.body
        );
        assert_eq!(
            as_player.body["items"].as_array().unwrap().len(),
            player_count,
            "{path}: {}",
            as_player.body
        );
        let as_dm = support::run(call(&app, Method::GET, &path, Some(&owner), None));
        assert_eq!(
            as_dm.body["items"].as_array().unwrap().len(),
            dm_count,
            "{path}: {}",
            as_dm.body
        );
    }
}

#[test]
fn deleting_missing_rows_returns_not_found() {
    let db = TestDb::new();
    let app = support::app_for(&db);
    let owner = id(90);
    let campaign_id = support::run(support::campaign(&app, &owner));

    for collection in ["characters", "journal", "knowledge"] {
        let path = uri(&campaign_id, &format!("/{collection}/{}", id(999)));
        let response = support::run(call(&app, Method::DELETE, &path, Some(&owner), None));
        assert_denied(&response, StatusCode::NOT_FOUND, "not_found", &path);
    }

    let member = support::run(call(
        &app,
        Method::DELETE,
        &uri(&campaign_id, &format!("/members/{}", id(998))),
        Some(&owner),
        None,
    ));
    assert_denied(&member, StatusCode::NOT_FOUND, "not_found", "members");
}
