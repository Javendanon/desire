//! D19 read-only Nivel20 import: preview, idempotent import, mapping and source failures.
use crate::support;

mod concurrency;
mod database_concurrency;

use axum::{
    Router,
    http::{Method, StatusCode},
};
use desire_api::{AppState, app, nivel20::Nivel20Client};
use desire_core::flags::FlagSource;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
};
use support::{ApiCall, TestDb, call, id};

const SOURCE_PATH: &str = "/games/dnd-5/campaigns/109662-synthetic";
const EXTERNAL_ID: i64 = 109_662;

struct FakeSource {
    base_url: String,
    requests: Arc<Mutex<Vec<String>>>,
}

impl FakeSource {
    fn start(responses: Vec<(u16, String)>) -> Self {
        Self::start_with(responses, None)
    }

    /// `location` is sent as the `Location` header of the response, so a followed redirect
    /// would reach the target the test inspects.
    fn start_with(responses: Vec<(u16, String)>, location: Option<String>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                recorded.lock().unwrap().push(request.clone());
                let (status, body) = request_answer(&request, status, body);
                write_response(&mut stream, status, &body, location.as_deref());
            }
        });
        Self { base_url, requests }
    }

    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

fn write_response(
    stream: &mut std::net::TcpStream,
    status: u16,
    body: &str,
    location: Option<&str>,
) {
    let redirect = location.map_or_else(String::new, |url| format!("location: {url}\r\n"));
    let response = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: application/json\r\n\
         {redirect}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        reason(status),
        body.len()
    );
    stream.write_all(response.as_bytes()).unwrap();
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut received = Vec::new();
    let mut chunk = [0_u8; 1024];
    while !received.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut chunk).unwrap();
        if read == 0 {
            break;
        }
        received.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8_lossy(&received).into_owned()
}

/// The fake source rejects a wrong path or a missing JSON Accept header, so the test
/// proves the adapter's request instead of only its parsing.
fn request_answer(request: &str, status: u16, body: String) -> (u16, String) {
    let lower = request.to_ascii_lowercase();
    let path = request.lines().next().unwrap_or_default();
    if path != format!("GET {SOURCE_PATH} HTTP/1.1") {
        return (404, json!({"error": "wrong path"}).to_string());
    }
    if !lower.contains("\r\naccept: application/json\r\n") {
        return (406, json!({"error": "missing accept"}).to_string());
    }
    (status, body)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        302 => "Found",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        406 => "Not Acceptable",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Response",
    }
}

fn source_body(name: &str, updated_at: &str) -> String {
    json!({
        "id": EXTERNAL_ID,
        "game_id": 3,
        "name": name,
        "description": "Synthetic campaign description",
        "created_at": "2025-03-05T13:05:22.000-03:00",
        "updated_at": updated_at,
        "url": "https://nivel20.com/campaigns/109662-synthetic.json"
    })
    .to_string()
}

fn router(db: &TestDb, source: &FakeSource) -> Router {
    router_with(db, &source.base_url)
}

fn router_with(db: &TestDb, base_url: &str) -> Router {
    let mut state: AppState = db.state();
    state.nivel20 = Nivel20Client::new(base_url).unwrap();
    state.flags = flags_on();
    app(state)
}

/// One flags file per test process with the import flag on; each test owns its own server, so
/// the flag is injected through the state instead of the shared process environment.
fn flags_on() -> FlagSource {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    let path = PATH.get_or_init(|| {
        let path =
            std::env::temp_dir().join(format!("desire-nivel20-flags-{}.txt", std::process::id()));
        std::fs::write(&path, "nivel20_import = on\n").unwrap();
        path
    });
    FlagSource::file(path)
}

/// A port that no process listens on: the source is unreachable, as when Nivel20 is down.
fn unreachable_base_url() -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{address}")
}

fn source_call(method: Method, campaign_id: &str, caller: &str, action: &str) -> ApiCall<'static> {
    let path = format!("/api/v1/campaigns/{campaign_id}/nivel20{action}");
    let caller = caller.to_string();
    ApiCall::new(method, Box::leak(path.into_boxed_str()))
        .by(Box::leak(caller.into_boxed_str()))
        .json(json!({"source_path": SOURCE_PATH}))
}

async fn import_with(app: &Router, campaign_id: &str, caller: &str) -> Value {
    let response = call(
        app,
        source_call(Method::POST, campaign_id, caller, "/import"),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    response.body
}

#[test]
fn preview_is_read_only_and_import_is_idempotent() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![
        (
            200,
            source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
        ),
        (
            200,
            source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
        ),
        (
            200,
            source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
        ),
    ]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    let preview = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(preview.status, StatusCode::OK, "{}", preview.body);
    assert_eq!(preview.body["source"], "nivel20");
    assert_eq!(preview.body["status"], "new");
    assert_eq!(preview.body["external_id"], EXTERNAL_ID);
    assert_eq!(preview.body["campaign_id"], campaign);
    assert_eq!(preview.body["campaign"]["name"], "Synthetic campaign");
    assert!(preview.body["previous"].is_null());

    let absent = support::run(call(
        &app,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(absent.status, StatusCode::NOT_FOUND);

    let first = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/import"),
    ));
    assert_eq!(first.status, StatusCode::OK, "{}", first.body);
    assert_eq!(first.body["status"], "new");
    assert_eq!(first.body["imported"], true);
    assert_eq!(first.body["stored"]["external_id"], EXTERNAL_ID);
    assert_eq!(first.body["stored"]["campaign_id"], campaign);
    assert_eq!(
        first.body["stored"]["campaign"]["name"],
        "Synthetic campaign"
    );
    let first_imported_at = first.body["stored"]["imported_at"].as_str().unwrap();

    let again = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/import"),
    ));
    assert_eq!(again.status, StatusCode::OK, "{}", again.body);
    assert_eq!(again.body["status"], "unchanged");
    assert_eq!(again.body["imported"], false);
    assert_eq!(again.body["stored"]["imported_at"], first_imported_at);

    let local = support::run(call(
        &app,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(local.status, StatusCode::OK);
    assert_eq!(local.body["campaign"]["name"], "Synthetic campaign");
}

#[test]
fn a_changed_source_is_reported_and_reimported() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![
        (
            200,
            source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
        ),
        (
            200,
            source_body("Renamed campaign", "2026-11-01T10:00:00.000-03:00"),
        ),
        (
            200,
            source_body("Renamed campaign", "2026-11-01T10:00:00.000-03:00"),
        ),
    ]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/import"),
    ));

    let preview = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(preview.status, StatusCode::OK, "{}", preview.body);
    assert_eq!(preview.body["status"], "changed");
    assert_eq!(
        preview.body["previous"]["campaign"]["name"],
        "Synthetic campaign"
    );
    assert_eq!(preview.body["campaign"]["name"], "Renamed campaign");
    let changed = preview.body["changed_fields"].as_array().unwrap();
    assert!(changed.contains(&json!("name")));
    assert!(changed.contains(&json!("updated_at")));
    assert!(preview.body["stored"].is_null());

    let updated = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/import"),
    ));
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.body);
    assert_eq!(updated.body["status"], "changed");
    assert_eq!(updated.body["imported"], true);
    assert_eq!(
        updated.body["stored"]["campaign"]["name"],
        "Renamed campaign"
    );
}

#[test]
fn source_session_and_perimeter_errors_are_not_retried_or_bypassed() {
    for status in [401, 403, 429, 500] {
        let db = TestDb::new();
        let owner = id(90);
        let source = FakeSource::start(vec![(status, json!({"error": "synthetic"}).to_string())]);
        let app = router(&db, &source);
        let campaign = support::run(support::campaign(&app, &owner));

        let response = support::run(call(
            &app,
            source_call(Method::POST, &campaign, &owner, "/preview"),
        ));
        let expected = if matches!(status, 401 | 403) {
            (StatusCode::BAD_GATEWAY, "source_requires_session")
        } else if status == 429 {
            (StatusCode::SERVICE_UNAVAILABLE, "source_rate_limited")
        } else {
            (StatusCode::SERVICE_UNAVAILABLE, "source_unavailable")
        };
        assert_eq!(
            response.status, expected.0,
            "status {status}: {}",
            response.body
        );
        assert_eq!(response.body["code"], expected.1);
        assert_eq!(response.body["request_id"].as_str().unwrap().len(), 36);
    }
}

#[test]
fn a_login_redirect_is_a_session_error_and_is_not_followed() {
    let db = TestDb::new();
    let owner = id(90);
    let trap = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    trap.set_nonblocking(true).unwrap();
    let location = format!("http://{}/users/sign_in", trap.local_addr().unwrap());
    let source = FakeSource::start_with(
        vec![(302, json!({"error": "login"}).to_string())],
        Some(location),
    );
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    let response = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(
        response.status,
        StatusCode::BAD_GATEWAY,
        "{}",
        response.body
    );
    assert_eq!(response.body["code"], "source_requires_session");
    assert_eq!(
        source.requests().len(),
        1,
        "a login redirect must not be followed"
    );
    assert!(
        trap.accept().is_err(),
        "the adapter followed the Location header"
    );

    let absent = support::run(call(
        &app,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(absent.status, StatusCode::NOT_FOUND);
}

#[test]
fn an_unexpected_source_status_is_a_rejected_response_not_an_outage() {
    for status in [202, 406] {
        let db = TestDb::new();
        let owner = id(90);
        let source = FakeSource::start(vec![(status, json!({"error": "synthetic"}).to_string())]);
        let app = router(&db, &source);
        let campaign = support::run(support::campaign(&app, &owner));

        let response = support::run(call(
            &app,
            source_call(Method::POST, &campaign, &owner, "/preview"),
        ));
        assert_eq!(
            response.status,
            StatusCode::BAD_GATEWAY,
            "status {status}: {}",
            response.body
        );
        assert_eq!(response.body["code"], "source_rejected", "status {status}");
    }
}

#[test]
fn the_import_routes_stay_hidden_and_offline_while_the_flag_is_off() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(Vec::new());
    let campaign = support::run(support::campaign(&support::app_for(&db), &owner));

    let malformed = std::env::temp_dir().join(format!(
        "desire-nivel20-bad-flags-{}.txt",
        std::process::id()
    ));
    std::fs::write(&malformed, "nivel20_import = yes\n").unwrap();

    for flags in [FlagSource::none(), FlagSource::file(malformed)] {
        let mut state: AppState = db.state();
        state.nivel20 = Nivel20Client::new(&source.base_url).unwrap();
        state.flags = flags;
        let app = app(state);

        let stored = support::run(call(
            &app,
            ApiCall::new(
                Method::GET,
                &format!("/api/v1/campaigns/{campaign}/nivel20"),
            )
            .by(&owner),
        ));
        let preview = support::run(call(
            &app,
            source_call(Method::POST, &campaign, &owner, "/preview"),
        ));
        let imported = support::run(call(
            &app,
            source_call(Method::POST, &campaign, &owner, "/import"),
        ));

        for response in [stored, preview, imported] {
            assert_eq!(response.status, StatusCode::NOT_FOUND, "{}", response.body);
        }
        assert!(
            source.requests().is_empty(),
            "a disabled feature must not contact the source"
        );
    }
}

#[test]
fn malformed_source_payloads_and_paths_fail_without_writes() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![
        (200, "not-json".into()),
        (200, json!({"id": 7, "name": "Wrong id"}).to_string()),
    ]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    let invalid = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(invalid.status, StatusCode::BAD_GATEWAY);
    assert_eq!(invalid.body["code"], "source_rejected");

    let mismatch = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(mismatch.status, StatusCode::BAD_GATEWAY);
    assert_eq!(mismatch.body["code"], "source_rejected");

    let path = support::run(call(
        &app,
        ApiCall::new(
            Method::POST,
            &format!("/api/v1/campaigns/{campaign}/nivel20/preview"),
        )
        .by(&owner)
        .json(json!({"source_path": "/games/dnd-5/campaigns/../secret"})),
    ));
    assert_eq!(path.status, StatusCode::BAD_REQUEST);
    assert_eq!(path.body["code"], "invalid_request");

    let absent = support::run(call(
        &app,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(absent.status, StatusCode::NOT_FOUND);
}

#[test]
fn import_requires_the_dm_role_and_a_known_campaign() {
    let db = TestDb::new();
    let owner = id(90);
    let player = id(91);
    let source = FakeSource::start(Vec::new());
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(support::member(
        support::Actor::new(&app, &campaign, &owner),
        &player,
        "player",
    ));

    let forbidden = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &player, "/import"),
    ));
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);

    let hidden = support::run(call(
        &app,
        source_call(Method::POST, &id(999), &owner, "/preview"),
    ));
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);
}

#[test]
fn one_external_campaign_maps_to_one_local_campaign() {
    let db = TestDb::new();
    let owner = id(90);
    // One response: a local mapping conflict must be decided without a second source read.
    let source = FakeSource::start(vec![(
        200,
        source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
    )]);
    let app = router(&db, &source);
    let first = support::run(support::campaign(&app, &owner));
    let second = support::run(support::campaign(&app, &owner));

    let imported = support::run(import_with(&app, &first, &owner));
    assert_eq!(imported["status"], "new");

    let preview = support::run(call(
        &app,
        source_call(Method::POST, &second, &owner, "/preview"),
    ));
    assert_eq!(preview.status, StatusCode::CONFLICT, "{}", preview.body);
    assert_eq!(preview.body["code"], "conflict");

    let duplicate = support::run(call(
        &app,
        source_call(Method::POST, &second, &owner, "/import"),
    ));
    assert_eq!(duplicate.status, StatusCode::CONFLICT);
    assert_eq!(duplicate.body["code"], "conflict");
    assert_eq!(
        source.requests().len(),
        1,
        "a local mapping conflict must not contact the source"
    );

    let unwritten = support::run(call(
        &app,
        ApiCall::new(Method::GET, &format!("/api/v1/campaigns/{second}/nivel20")).by(&owner),
    ));
    assert_eq!(unwritten.status, StatusCode::NOT_FOUND);
}

#[test]
fn one_sessionless_read_carries_no_credentials_and_is_never_retried() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![(403, json!({"error": "synthetic"}).to_string())]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    let response = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(
        response.status,
        StatusCode::BAD_GATEWAY,
        "{}",
        response.body
    );

    let requests = source.requests();
    assert_eq!(requests.len(), 1, "a refused read must not be retried");
    let request = requests[0].to_ascii_lowercase();
    assert!(request.starts_with("get /games/dnd-5/campaigns/109662-synthetic http/1.1"));
    for header in [
        "cookie:",
        "authorization:",
        "x-csrf-token:",
        "x-xsrf-token:",
    ] {
        assert!(!request.contains(header), "the adapter sent {header}");
    }
}

#[test]
fn an_oversized_source_body_is_rejected_as_a_payload_error() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![(200, "{\"id\":".repeat(60_000))]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));

    let response = support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(
        response.status,
        StatusCode::BAD_GATEWAY,
        "{}",
        response.body
    );
    assert_eq!(response.body["code"], "source_rejected");
    assert!(
        response.body["message"]
            .as_str()
            .unwrap()
            .contains("does not understand")
    );
}

#[test]
fn local_snapshot_stays_readable_when_the_source_is_unreachable() {
    let db = TestDb::new();
    let owner = id(90);
    let source = FakeSource::start(vec![(
        200,
        source_body("Synthetic campaign", "2026-10-03T22:38:30.000-03:00"),
    )]);
    let app = router(&db, &source);
    let campaign = support::run(support::campaign(&app, &owner));
    support::run(call(
        &app,
        source_call(Method::POST, &campaign, &owner, "/import"),
    ));

    let offline = router_with(&db, &unreachable_base_url());
    let preview = support::run(call(
        &offline,
        source_call(Method::POST, &campaign, &owner, "/preview"),
    ));
    assert_eq!(
        preview.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{}",
        preview.body
    );
    assert_eq!(preview.body["code"], "source_unavailable");

    let local = support::run(call(
        &offline,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(local.status, StatusCode::OK, "{}", local.body);
    assert_eq!(local.body["campaign"]["name"], "Synthetic campaign");
    assert_eq!(local.body["external_id"], EXTERNAL_ID);
    assert_eq!(local.body["campaign_id"], campaign);
}
