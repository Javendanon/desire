//! Static frontend hosting: hashed assets, app-route fallback and the API boundary.
use crate::support;
use axum::{
    Router,
    http::{Method, StatusCode, header},
    routing::get,
};
use desire_api::static_files;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

const INDEX: &str = "<!doctype html><div id=\"root\"></div>";
const ASSET: &str = "console.log('asset');";

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    /// A throw-away build output with one hashed asset and the app shell.
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "desire-static-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("index.html"), INDEX).unwrap();
        std::fs::write(root.join("assets/app-4f3a1c9d.js"), ASSET).unwrap();
        Self { root }
    }

    fn router(&self) -> Router {
        static_files::attach(Router::new(), Some(self.root.clone()))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.root) {
            eprintln!("static fixture cleanup failed: {error}");
        }
    }
}

fn fetch(app: &Router, path: &str) -> support::Response {
    support::run(support::call(app, support::ApiCall::new(Method::GET, path)))
}

fn header(response: &support::Response, name: header::HeaderName) -> &str {
    response
        .headers
        .get(&name)
        .unwrap_or_else(|| panic!("missing header {name}"))
        .to_str()
        .unwrap()
}

#[test]
fn a_hashed_asset_is_served_with_a_long_cache() {
    let fixture = Fixture::new();
    let response = fetch(&fixture.router(), "/assets/app-4f3a1c9d.js");
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body, ASSET);
    assert_eq!(
        header(&response, header::CACHE_CONTROL),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        header(&response, header::CONTENT_TYPE),
        "text/javascript; charset=utf-8"
    );
}

#[test]
fn an_unknown_app_route_falls_back_to_the_index() {
    let fixture = Fixture::new();
    let response = fetch(&fixture.router(), "/campaigns/waterdeep/characters");
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body, INDEX);
    assert_eq!(header(&response, header::CACHE_CONTROL), "no-cache");
    assert_eq!(
        header(&response, header::CONTENT_TYPE),
        "text/html; charset=utf-8"
    );
}

#[test]
fn api_paths_never_receive_the_index() {
    let fixture = Fixture::new();
    let app = static_files::attach(
        Router::new().route("/api/health", get(|| async { "ok" })),
        Some(fixture.root.clone()),
    );
    let health = fetch(&app, "/api/health");
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.body, "ok");

    for path in ["/api", "/api/v1/unknown", "/api/v1/campaigns"] {
        let response = fetch(&app, path);
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
        assert_ne!(response.body, INDEX, "{path}");
    }
}

#[test]
fn without_a_directory_static_hosting_stays_off() {
    let app = static_files::attach(Router::new(), None);
    for path in ["/", "/assets/app-4f3a1c9d.js", "/campaigns/waterdeep"] {
        let response = fetch(&app, path);
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }
}

#[test]
fn traversal_attempts_never_leave_the_static_directory() {
    let fixture = Fixture::new();
    let app = fixture.router();
    for path in [
        "/../Cargo.toml",
        "/%2e%2e/Cargo.toml",
        "/assets/../../Cargo.toml",
        "/.git/config",
    ] {
        let response = fetch(&app, path);
        assert_eq!(response.status, StatusCode::OK, "{path}");
        assert_eq!(response.body, INDEX, "{path}");
    }
}
