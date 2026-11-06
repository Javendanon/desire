//! Negative OIDC and CSRF cases use only the local provider, never Google.
use crate::{
    oidc_flow::{Fixture, Flow, cookie_pair},
    oidc_provider::Fault,
    support::{self, ApiCall},
};
use axum::http::{Method, StatusCode};
use desire_api::auth::session::SESSION_COOKIE;

fn replace_parameter(flow: &mut Flow, name: &str, value: &str) {
    let pairs: Vec<_> = flow
        .callback
        .query_pairs()
        .map(|(key, old)| {
            let replacement = if key == name {
                value.to_string()
            } else {
                old.into_owned()
            };
            (key.into_owned(), replacement)
        })
        .collect();
    flow.callback.query_pairs_mut().clear().extend_pairs(pairs);
}

fn assert_no_identity(fixture: &Fixture) {
    let count: i64 = fixture
        .db
        .connection()
        .query_one("SELECT count(*) FROM identity.accounts", &[])
        .unwrap()
        .get(0);
    assert_eq!(count, 0);
}

#[test]
fn incorrect_claims_and_signatures_never_create_an_identity() {
    let fixture = Fixture::new("");
    for fault in [
        Fault::Nonce,
        Fault::Audience,
        Fault::Issuer,
        Fault::Signature,
        Fault::Expired,
        Fault::Unverified,
        Fault::MissingEmail,
    ] {
        fixture
            .provider
            .profile("alice", "alice@example.test", fault);
        let response = fixture.finish(&fixture.begin());
        assert_eq!(
            response.status,
            StatusCode::UNAUTHORIZED,
            "{fault:?}: {}",
            response.body
        );
        assert_eq!(response.body["code"], "unauthenticated");
        assert!(
            !response
                .headers
                .get_all("set-cookie")
                .iter()
                .any(|header| header
                    .to_str()
                    .unwrap()
                    .starts_with(&format!("{SESSION_COOKIE}=")))
        );
        assert_no_identity(&fixture);
    }
}

#[test]
fn state_and_the_initiating_browser_are_required() {
    let fixture = Fixture::new("");
    let mut wrong_state = fixture.begin();
    replace_parameter(&mut wrong_state, "state", "foreign-state");
    assert_eq!(
        fixture.finish(&wrong_state).status,
        StatusCode::UNAUTHORIZED
    );
    let mut wrong_browser = fixture.begin();
    wrong_browser.browser = "__Host-desire-oidc=foreign-browser".into();
    assert_eq!(
        fixture.finish(&wrong_browser).status,
        StatusCode::UNAUTHORIZED
    );
    assert_no_identity(&fixture);
}

#[test]
fn the_allowlist_is_optional_and_case_insensitive_but_enforced_after_verification() {
    let fixture = Fixture::new(" Allowed@Example.Test , second@example.test ");
    fixture
        .provider
        .profile("blocked", "blocked@example.test", Fault::None);
    assert_eq!(
        fixture.finish(&fixture.begin()).status,
        StatusCode::UNAUTHORIZED
    );
    assert_no_identity(&fixture);
    fixture
        .provider
        .profile("allowed", "allowed@example.test", Fault::None);
    assert_eq!(
        fixture.finish(&fixture.begin()).status,
        StatusCode::SEE_OTHER
    );
}

#[test]
fn neither_a_callback_nor_an_authorization_code_can_be_reused() {
    let fixture = Fixture::new("");
    let first = fixture.begin();
    assert_eq!(fixture.finish(&first).status, StatusCode::SEE_OTHER);
    assert_eq!(fixture.finish(&first).status, StatusCode::UNAUTHORIZED);
    let code = first
        .callback
        .query_pairs()
        .find(|(key, _)| key == "code")
        .unwrap()
        .1;
    let mut second = fixture.begin();
    replace_parameter(&mut second, "code", &code);
    assert_eq!(fixture.finish(&second).status, StatusCode::UNAUTHORIZED);
    let count: i64 = fixture
        .db
        .connection()
        .query_one("SELECT count(*) FROM identity.sessions", &[])
        .unwrap()
        .get(0);
    assert_eq!(count, 1);
}

#[test]
fn only_issuer_and_subject_select_accounts_even_when_email_changes_or_is_shared() {
    let fixture = Fixture::new("");
    let first = fixture.login("alice");
    fixture
        .provider
        .profile("alice", "renamed@example.test", Fault::None);
    let changed = fixture.finish(&fixture.begin());
    let pair = cookie_pair(&changed, SESSION_COOKIE);
    let identity = support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/auth/identity").headers(&[("cookie", &pair)]),
    ));
    assert_eq!(identity.body["user_id"], first["user_id"]);
    assert_eq!(identity.body["email"], "renamed@example.test");
    fixture
        .provider
        .profile("different-subject", "renamed@example.test", Fault::None);
    let different = fixture.finish(&fixture.begin());
    let pair = cookie_pair(&different, SESSION_COOKIE);
    let identity = support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/auth/identity").headers(&[("cookie", &pair)]),
    ));
    assert_ne!(identity.body["user_id"], first["user_id"]);
}

#[test]
fn cookie_mutations_reject_missing_null_foreign_and_duplicate_origins() {
    let fixture = Fixture::new("");
    let session = fixture.login("alice");
    let token = session["token"].as_str().unwrap();
    let cookie = format!("{SESSION_COOKIE}={token}");
    for origin in [None, Some("null"), Some("https://foreign.example.test")] {
        let mut headers = vec![("cookie", cookie.as_str())];
        if let Some(origin) = origin {
            headers.push(("origin", origin));
        }
        let response = support::run(support::call(
            &fixture.app,
            ApiCall::new(Method::DELETE, "/api/v1/auth/sessions/current").headers(&headers),
        ));
        assert_eq!(response.status, StatusCode::FORBIDDEN, "{}", response.body);
    }
    let duplicate = support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::DELETE, "/api/v1/auth/sessions/current")
            .session(token)
            .headers(&[("origin", "https://foreign.example.test")]),
    ));
    assert_eq!(duplicate.status, StatusCode::FORBIDDEN);
    let still_valid = support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/auth/identity").session(token),
    ));
    assert_eq!(still_valid.status, StatusCode::OK);
}
