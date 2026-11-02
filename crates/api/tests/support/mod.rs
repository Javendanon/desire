//! Real PostgreSQL checks: the shared harness starts a socket-only disposable cluster.
use axum::{
    Router,
    body::to_bytes,
    http::{Method, Request, StatusCode, header},
};
use desire_api::{AppState, app};
use desire_core::contracts::common::Provenance;
use desire_persistence::{CatalogRepository, CatalogSeed, migrations};
use postgres::{Client, Config, NoTls};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Disposable database identity; fixtures and the app open their own connections.
pub struct TestDb {
    name: String,
}

impl TestDb {
    pub fn new() -> Self {
        let name = database_name();
        let mut admin = admin_client();
        admin
            .batch_execute(&format!("CREATE DATABASE {name}"))
            .unwrap();
        let mut client = connect(&name);
        migrations::apply(&mut client).unwrap();
        CatalogRepository::seed(&mut client, &catalog()).unwrap();
        Self { name }
    }

    pub fn state(&self) -> AppState {
        AppState::with_config(config(&self.name), connect(&self.name))
    }

    pub fn connection(&self) -> Client {
        connect(&self.name)
    }

    /// A libpq URL for the disposable cluster, used to start the real binary.
    pub fn url(&self) -> String {
        let socket = std::env::var("DESIRE_TEST_SOCKET").expect(
            "run bash crates/persistence/test-postgres.sh; no external database is allowed",
        );
        let host = socket.replace('/', "%2F");
        format!("postgresql://desire_test@{host}/{}", self.name)
    }

    /// Terminates every other backend on this database, as a database restart would.
    pub fn drop_connections(&self) {
        admin_client()
            .batch_execute(&format!(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                 WHERE datname = '{}' AND pid <> pg_backend_pid()",
                self.name
            ))
            .unwrap();
    }
}

fn config(name: &str) -> Config {
    let socket = std::env::var("DESIRE_TEST_SOCKET")
        .expect("run bash crates/persistence/test-postgres.sh; no external database is allowed");
    let mut config = Config::new();
    config.host_path(socket).user("desire_test").dbname(name);
    config
}

fn connect(name: &str) -> Client {
    config(name).connect(NoTls).unwrap()
}

fn admin_client() -> Client {
    connect("postgres")
}

fn database_name() -> String {
    static NEXT_DATABASE: AtomicUsize = AtomicUsize::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before 1970")
        .as_nanos();
    let sequence = NEXT_DATABASE.fetch_add(1, Ordering::Relaxed);
    format!("d09_{}_{nanos}_{sequence}", std::process::id())
}

/// Keep every check on one thread without adding another dependency.
pub fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

pub fn uri(campaign: &str, suffix: &str) -> String {
    format!("/api/v1/campaigns/{campaign}{suffix}")
}

pub fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012x}")
}

pub fn provenance() -> Provenance {
    Provenance {
        source: "fixture:D09".into(),
        attribution: "Synthetic test content".into(),
        evidence: desire_core::contracts::common::Evidence::Synthetic,
    }
}

fn catalog() -> CatalogSeed {
    let provenance = serde_json::to_value(provenance()).unwrap();
    serde_json::from_value(json!({
        "worlds": [{"id": id(1), "name": "Synthetic world", "provenance": provenance}],
        "eras": [{"id": id(2), "world_id": id(1), "name": "Synthetic era"}],
        "cities": [{"id": id(3), "era_id": id(2), "name": "Waterdeep",
            "provenance": provenance}],
        "map_versions": [{"id": id(6), "map_id": id(60), "city_id": id(3),
            "revision": 1, "calibration": null, "provenance": provenance}]
    }))
    .unwrap()
}

pub fn map_version() -> String {
    id(6)
}

pub struct Response {
    pub status: StatusCode,
    pub body: Value,
}

/// Dispatch one HTTP request through the real router, with an optional caller identity.
pub async fn call(
    app: &Router,
    method: Method,
    uri: &str,
    caller: Option<&str>,
    body: Option<Value>,
) -> Response {
    call_with_headers(app, method, uri, caller, body, &[]).await
}

pub async fn call_with_headers(
    app: &Router,
    method: Method,
    uri: &str,
    caller: Option<&str>,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Response {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(caller) = caller {
        request = request.header("x-desire-user", caller);
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let request = match body {
        Some(body) => request
            .header(header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(body.to_string()))
            .unwrap(),
        None => request.body(axum::body::Body::empty()).unwrap(),
    };
    let response = tower::ServiceExt::oneshot(app.clone(), request)
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    Response { status, body }
}

/// Create a campaign through the API and return its server-assigned ID.
pub async fn campaign(app: &Router, owner: &str) -> String {
    let response = call(
        app,
        Method::POST,
        "/api/v1/campaigns",
        Some(owner),
        Some(
            json!({"name": "Synthetic campaign", "rules_edition": "dnd_2014",
            "city_id": id(3)}),
        ),
    )
    .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body["id"].as_str().unwrap().to_string()
}

/// Add a member through the API so the membership row matches production paths.
pub async fn member(app: &Router, campaign_id: &str, owner: &str, user_id: &str, role: &str) {
    let response = call(
        app,
        Method::POST,
        &format!("/api/v1/campaigns/{campaign_id}/members"),
        Some(owner),
        Some(json!({"user_id": user_id, "role": role})),
    )
    .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
}

pub async fn create_character(app: &Router, campaign_id: &str, caller: &str) -> Value {
    let response = call(
        app,
        Method::POST,
        &format!("/api/v1/campaigns/{campaign_id}/characters"),
        Some(caller),
        Some(json!({"name": "Synthetic hero", "controller_id": null,
            "rules_edition": "dnd_2014"})),
    )
    .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body
}

pub async fn create_scene(app: &Router, campaign_id: &str, caller: &str) -> Value {
    created(
        app,
        &format!("/api/v1/campaigns/{campaign_id}/scenes"),
        caller,
        json!({"name": "Dock", "map_version_id": map_version()}),
    )
    .await
}

pub async fn create_session(app: &Router, campaign_id: &str, caller: &str) -> Value {
    created(
        app,
        &format!("/api/v1/campaigns/{campaign_id}/sessions"),
        caller,
        json!({"title": "Synthetic session"}),
    )
    .await
}

pub async fn create_journal(
    app: &Router,
    campaign_id: &str,
    caller: &str,
    session_id: &str,
    visibility: &str,
) -> Value {
    created(
        app,
        &format!("/api/v1/campaigns/{campaign_id}/journal"),
        caller,
        json!({"session_id": session_id, "body": "Synthetic recap",
            "visibility": visibility}),
    )
    .await
}

pub async fn create_knowledge(
    app: &Router,
    campaign_id: &str,
    caller: &str,
    visibility: &str,
) -> Value {
    created(
        app,
        &format!("/api/v1/campaigns/{campaign_id}/knowledge"),
        caller,
        json!({"title": "Synthetic lore", "body": "Synthetic body",
            "visibility": visibility, "provenance": provenance()}),
    )
    .await
}

async fn created(app: &Router, path: &str, caller: &str, body: Value) -> Value {
    let response = call(app, Method::POST, path, Some(caller), Some(body)).await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body
}

pub fn app_for(db: &TestDb) -> Router {
    app(db.state())
}
