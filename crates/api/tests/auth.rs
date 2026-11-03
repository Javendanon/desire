//! Account sessions replace the development header and enforce campaign role isolation.
use crate::support::{self, TestDb, call, id, uri};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::ApiCall;

const PASSWORD: &str = "correct horse battery staple";

fn register(app: &axum::Router, username: &str) -> Value {
    let response = support::run(call(
        app,
        ApiCall::new(Method::POST, "/api/v1/auth/accounts")
            .json(json!({"username": username, "password": PASSWORD})),
    ));
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body
}

fn login(app: &axum::Router, username: &str, password: &str) -> support::Response {
    support::run(call(
        app,
        ApiCall::new(Method::POST, "/api/v1/auth/sessions")
            .json(json!({"username": username, "password": password})),
    ))
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

fn with_token<'a>(method: Method, path: &'a str, token: &'a str) -> ApiCall<'a> {
    let _ = bearer(token);
    ApiCall::new(method, path).bearer(token)
}

#[test]
fn accounts_create_sessions_and_never_store_raw_tokens() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);
    let session = register(&app, "Alice");
    let token = session["token"].as_str().unwrap().to_string();
    let user_id = session["user_id"].as_str().unwrap().to_string();
    assert_eq!(token.len(), 64);
    assert_eq!(session["token_type"], "bearer");

    let campaigns = support::run(call(
        &app,
        with_token(Method::GET, "/api/v1/campaigns", &token),
    ));
    assert_eq!(campaigns.status, StatusCode::OK, "{}", campaigns.body);

    let created = support::run(call(
        &app,
        with_token(Method::POST, "/api/v1/campaigns", &token)
            .json(json!({"name": "Synthetic", "rules_edition": "dnd_2014", "city_id": null})),
    ));
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.body);
    assert_eq!(created.body["owner_id"], user_id);

    let identity = support::run(call(
        &app,
        with_token(Method::GET, "/api/v1/auth/identity", &token),
    ));
    assert_eq!(identity.status, StatusCode::OK, "{}", identity.body);
    assert_eq!(identity.body["user_id"], user_id);
    assert_eq!(identity.body["username"], "alice");

    let stored: String = db
        .connection()
        .query_one("SELECT token_hash FROM identity.sessions", &[])
        .unwrap()
        .get(0);
    assert_ne!(stored, token);
    assert_eq!(stored.len(), 64);
}

#[test]
fn missing_invalid_and_revoked_sessions_are_rejected() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);
    let session = register(&app, "alice");
    let token = session["token"].as_str().unwrap().to_string();

    let missing = support::run(call(&app, ApiCall::new(Method::GET, "/api/v1/campaigns")));
    assert_eq!(missing.status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing.body["code"], "unauthenticated");

    let dev_header = support::run(call(
        &app,
        ApiCall::new(Method::GET, "/api/v1/campaigns").by(&id(90)),
    ));
    assert_eq!(dev_header.status, StatusCode::UNAUTHORIZED);
    assert_eq!(dev_header.body["code"], "unauthenticated");

    let malformed = support::run(call(
        &app,
        with_token(Method::GET, "/api/v1/campaigns", "not-a-token"),
    ));
    assert_eq!(malformed.status, StatusCode::UNAUTHORIZED);

    let wrong = login(&app, "alice", "definitely not the password");
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong.body["code"], "unauthenticated");

    let logout = support::run(call(
        &app,
        with_token(Method::DELETE, "/api/v1/auth/sessions/current", &token),
    ));
    assert_eq!(logout.status, StatusCode::NO_CONTENT, "{}", logout.body);

    let revoked = support::run(call(
        &app,
        with_token(Method::GET, "/api/v1/campaigns", &token),
    ));
    assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
}

#[test]
fn expired_sessions_are_rejected() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);
    let session = register(&app, "alice");
    let token = session["token"].as_str().unwrap().to_string();
    db.connection()
        .execute(
            concat!(
                "UPDATE identity.sessions SET created_at = now() - interval '2 hours', ",
                "expires_at = now() - interval '1 second'"
            ),
            &[],
        )
        .unwrap();
    let response = support::run(call(
        &app,
        with_token(Method::GET, "/api/v1/campaigns", &token),
    ));
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
}

#[test]
fn players_cannot_act_as_dm_or_read_dm_only_content() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);
    let dm = register(&app, "dungeon-master");
    let player = register(&app, "player");
    let dm_token = dm["token"].as_str().unwrap();
    let player_token = player["token"].as_str().unwrap();
    let player_id = player["user_id"].as_str().unwrap();

    let campaign = support::run(call(
        &app,
        with_token(Method::POST, "/api/v1/campaigns", dm_token)
            .json(json!({"name": "Synthetic", "rules_edition": "dnd_2014", "city_id": null})),
    ));
    assert_eq!(campaign.status, StatusCode::CREATED, "{}", campaign.body);
    let campaign_id = campaign.body["id"].as_str().unwrap().to_string();

    let member = support::run(call(
        &app,
        with_token(Method::POST, &uri(&campaign_id, "/members"), dm_token)
            .json(json!({"user_id": player_id, "role": "player"})),
    ));
    assert_eq!(member.status, StatusCode::CREATED, "{}", member.body);

    let session = support::run(call(
        &app,
        with_token(Method::POST, &uri(&campaign_id, "/sessions"), dm_token)
            .json(json!({"title": "Synthetic session"})),
    ));
    assert_eq!(session.status, StatusCode::CREATED, "{}", session.body);
    let session_id = session.body["id"].as_str().unwrap().to_string();

    let visible = support::run(call(
        &app,
        with_token(Method::POST, &uri(&campaign_id, "/journal"), dm_token)
            .json(json!({"session_id": session_id, "body": "Shared recap",
                "visibility": "players"})),
    ));
    assert_eq!(visible.status, StatusCode::CREATED, "{}", visible.body);
    let secret = support::run(call(
        &app,
        with_token(Method::POST, &uri(&campaign_id, "/journal"), dm_token)
            .json(json!({"session_id": session_id, "body": "Private secret",
                "visibility": "dm"})),
    ));
    assert_eq!(secret.status, StatusCode::CREATED, "{}", secret.body);

    let rename = support::run(call(
        &app,
        with_token(Method::PATCH, &uri(&campaign_id, ""), player_token)
            .json(json!({"name": "Denied", "expected_revision": 1})),
    ));
    assert_eq!(rename.status, StatusCode::FORBIDDEN, "{}", rename.body);

    let hidden = support::run(call(
        &app,
        with_token(
            Method::GET,
            &uri(
                &campaign_id,
                &format!("/journal/{}", secret.body["id"].as_str().unwrap()),
            ),
            player_token,
        ),
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND, "{}", hidden.body);

    let sync = support::run(call(
        &app,
        with_token(Method::GET, &uri(&campaign_id, "/sync"), player_token),
    ));
    assert_eq!(sync.status, StatusCode::OK, "{}", sync.body);
    assert_eq!(sync.body["role"], "player");
    let journal = sync.body["snapshot"]["journal"].as_array().unwrap();
    assert_eq!(journal.len(), 1, "{}", sync.body);
    assert_eq!(journal[0]["body"], "Shared recap");
    assert!(!sync.body.to_string().contains("Private secret"));
}

#[test]
fn account_payloads_are_bounded_and_duplicates_conflict() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);

    for body in [
        json!({"username": "ab", "password": PASSWORD}),
        json!({"username": "alice", "password": "short"}),
        json!({"username": "alice!", "password": PASSWORD}),
        json!({"username": "alice", "password": PASSWORD, "role": "dm"}),
    ] {
        let response = support::run(call(
            &app,
            ApiCall::new(Method::POST, "/api/v1/auth/accounts").json(body),
        ));
        assert_eq!(
            response.status,
            StatusCode::BAD_REQUEST,
            "{}",
            response.body
        );
    }

    register(&app, "alice");
    let duplicate = support::run(call(
        &app,
        ApiCall::new(Method::POST, "/api/v1/auth/accounts")
            .json(json!({"username": "ALICE", "password": PASSWORD})),
    ));
    assert_eq!(duplicate.status, StatusCode::CONFLICT, "{}", duplicate.body);

    let login_ok = login(&app, "ALICE", PASSWORD);
    assert_eq!(login_ok.status, StatusCode::OK, "{}", login_ok.body);
    assert_eq!(login_ok.body["username"], "alice");
}
