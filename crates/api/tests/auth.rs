//! OIDC cookie sessions enforce campaign roles and never expose shared-table secrets.
use crate::{
    oidc_flow::Fixture,
    support::{self, ApiCall, TestDb, call, id, uri},
};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

#[test]
fn oidc_is_explicitly_unavailable_without_configuration() {
    let db = TestDb::new();
    let app = support::strict_app_for(&db);
    let response = support::run(call(&app, ApiCall::new(Method::GET, "/api/v1/auth/login")));
    assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
    for path in ["/api/v1/auth/accounts", "/api/v1/auth/sessions"] {
        let removed = support::run(call(&app, ApiCall::new(Method::POST, path)));
        assert_eq!(removed.status, StatusCode::NOT_FOUND);
    }
}

#[test]
fn login_issues_a_cookie_and_stores_only_its_hash_and_expiration() {
    let fixture = Fixture::new("");
    let session = fixture.login("alice");
    let token = session["token"].as_str().unwrap();
    assert_eq!(token.len(), 64);
    let row = fixture
        .db
        .connection()
        .query_one(
            "SELECT token_hash, expires_at > now() FROM identity.sessions",
            &[],
        )
        .unwrap();
    let stored: String = row.get(0);
    assert_ne!(stored, token);
    assert_eq!(stored, desire_api::auth::session::token_hash(token));
    assert!(row.get::<_, bool>(1));
    let created = create_campaign(&fixture, token);
    assert_eq!(created["owner_id"], session["user_id"]);
}

#[test]
fn missing_malformed_and_unknown_sessions_never_fall_back_to_the_header() {
    let fixture = Fixture::new("");
    for request in [
        ApiCall::new(Method::GET, "/api/v1/campaigns"),
        ApiCall::new(Method::GET, "/api/v1/campaigns").by(&id(90)),
        ApiCall::new(Method::GET, "/api/v1/campaigns")
            .session("malformed")
            .by(&id(90)),
        ApiCall::new(Method::GET, "/api/v1/campaigns").session(&"0".repeat(64)),
    ] {
        let response = support::run(call(&fixture.app, request));
        assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    }
}

#[test]
fn logout_deletes_the_server_session_and_expires_the_cookie() {
    let fixture = Fixture::new("");
    let session = fixture.login("alice");
    let token = session["token"].as_str().unwrap();
    let logout = support::run(call(
        &fixture.app,
        ApiCall::new(Method::DELETE, "/api/v1/auth/sessions/current").session(token),
    ));
    assert_eq!(logout.status, StatusCode::NO_CONTENT, "{}", logout.body);
    assert!(
        logout.headers["set-cookie"]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    let count: i64 = fixture
        .db
        .connection()
        .query_one("SELECT count(*) FROM identity.sessions", &[])
        .unwrap()
        .get(0);
    assert_eq!(count, 0);
    let revoked = support::run(call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/campaigns").session(token),
    ));
    assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
}

#[test]
fn private_api_responses_and_authentication_failures_are_not_shared_cacheable() {
    let fixture = Fixture::new("");
    let session = fixture.login("alice");
    let token = session["token"].as_str().unwrap();
    for (request, status) in [
        (
            ApiCall::new(Method::GET, "/api/v1/campaigns").session(token),
            StatusCode::OK,
        ),
        (
            ApiCall::new(Method::GET, "/api/v1/campaigns"),
            StatusCode::UNAUTHORIZED,
        ),
    ] {
        let response = support::run(call(&fixture.app, request));
        assert_eq!(response.status, status);
        assert_eq!(
            response
                .headers
                .get("cache-control")
                .map(|value| value.to_str().unwrap()),
            Some("no-store")
        );
    }
}

#[test]
fn expired_sessions_are_rejected() {
    let fixture = Fixture::new("");
    let session = fixture.login("alice");
    fixture
        .db
        .connection()
        .execute(
            concat!(
                "UPDATE identity.sessions SET created_at = now() - interval '2 hours', ",
                "expires_at = now() - interval '1 second'"
            ),
            &[],
        )
        .unwrap();
    let response = support::run(call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/campaigns").session(session["token"].as_str().unwrap()),
    ));
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
}

fn create_campaign(fixture: &Fixture, token: &str) -> Value {
    let response = support::run(call(
        &fixture.app,
        ApiCall::new(Method::POST, "/api/v1/campaigns")
            .session(token)
            .json(json!({"name": "Synthetic", "rules_edition": "dnd_2014", "city_id": null})),
    ));
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body
}

fn campaign_with_player(fixture: &Fixture, dm: &Value, player: &Value) -> String {
    let token = dm["token"].as_str().unwrap();
    let campaign = create_campaign(fixture, token);
    let campaign_id = campaign["id"].as_str().unwrap();
    let member = support::run(call(
        &fixture.app,
        ApiCall::new(Method::POST, &uri(campaign_id, "/members"))
            .session(token)
            .json(json!({"user_id": player["user_id"], "role": "player"})),
    ));
    assert_eq!(member.status, StatusCode::CREATED, "{}", member.body);
    campaign_id.into()
}

fn journal_entries(fixture: &Fixture, token: &str, campaign: &str) -> String {
    let session = support::run(call(
        &fixture.app,
        ApiCall::new(Method::POST, &uri(campaign, "/sessions"))
            .session(token)
            .json(json!({"title": "Synthetic session"})),
    ));
    assert_eq!(session.status, StatusCode::CREATED, "{}", session.body);
    let mut secret_id = String::new();
    for (body, visibility) in [("Shared recap", "players"), ("Private secret", "dm")] {
        let entry = support::run(call(
            &fixture.app,
            ApiCall::new(Method::POST, &uri(campaign, "/journal"))
                .session(token)
                .json(json!({"session_id": session.body["id"], "body": body,
                    "visibility": visibility})),
        ));
        assert_eq!(entry.status, StatusCode::CREATED, "{}", entry.body);
        secret_id = entry.body["id"].as_str().unwrap().into();
    }
    secret_id
}

#[test]
fn players_cannot_act_as_dm_even_with_the_owner_header() {
    let fixture = Fixture::new("");
    let dm = fixture.login("dungeon-master");
    let player = fixture.login("player");
    let campaign = campaign_with_player(&fixture, &dm, &player);
    let rename = support::run(call(
        &fixture.app,
        ApiCall::new(Method::PATCH, &uri(&campaign, ""))
            .session(player["token"].as_str().unwrap())
            .headers(&[("x-desire-user", dm["user_id"].as_str().unwrap())])
            .json(json!({"name": "Denied", "expected_revision": 1})),
    ));
    assert_eq!(rename.status, StatusCode::FORBIDDEN, "{}", rename.body);
}

#[test]
fn two_oidc_clients_sync_without_exposing_dm_journal_entries() {
    let fixture = Fixture::new("");
    let dm = fixture.login("dungeon-master");
    let player = fixture.login("player");
    let campaign = campaign_with_player(&fixture, &dm, &player);
    let secret_id = journal_entries(&fixture, dm["token"].as_str().unwrap(), &campaign);
    let player_token = player["token"].as_str().unwrap();
    let hidden = support::run(call(
        &fixture.app,
        ApiCall::new(
            Method::GET,
            &uri(&campaign, &format!("/journal/{secret_id}")),
        )
        .session(player_token),
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND, "{}", hidden.body);
    let sync = support::run(call(
        &fixture.app,
        ApiCall::new(Method::GET, &uri(&campaign, "/sync")).session(player_token),
    ));
    assert_eq!(sync.status, StatusCode::OK, "{}", sync.body);
    assert_eq!(sync.body["role"], "player");
    assert_eq!(
        sync.body["snapshot"]["journal"].as_array().unwrap().len(),
        1
    );
    assert!(!sync.body.to_string().contains("Private secret"));
}
