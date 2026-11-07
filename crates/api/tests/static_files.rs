//! Static frontend hosting: hashed assets, app-route fallback, the API boundary and the flag.
use crate::support;
use axum::{
    Router,
    http::{Method, StatusCode, header},
    routing::get,
};
use desire_api::static_files;
use desire_core::flags::FlagSource;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

const INDEX: &str = "<!doctype html><div id=\"root\"></div>";
const ASSET: &str = "console.log('asset');";

fn temporary(name: &str) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    std::env::temp_dir().join(format!(
        "desire-static-{}-{}-{name}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

struct Fixture {
    root: PathBuf,
    flags: PathBuf,
}

impl Fixture {
    /// A throw-away build output with one hashed asset, the app shell and a flags file.
    fn new() -> Self {
        let root = temporary("build");
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("index.html"), INDEX).unwrap();
        std::fs::write(root.join("assets/app-4f3a1c9d.js"), ASSET).unwrap();
        let flags = temporary("flags.txt");
        std::fs::write(&flags, "static_site = on\n").unwrap();
        Self { root, flags }
    }

    fn source(&self) -> FlagSource {
        FlagSource::file(self.flags.clone())
    }

    fn set(&self, on: bool) {
        let value = if on { "on" } else { "off" };
        std::fs::write(&self.flags, format!("static_site = {value}\n")).unwrap();
    }

    fn router(&self) -> Router {
        static_files::attach(Router::new(), Some(self.root.clone()), self.source())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for path in [&self.root, &self.flags] {
            if let Err(error) = remove(path) {
                eprintln!("static fixture cleanup failed: {error}");
            }
        }
    }
}

fn remove(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
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
        fixture.source(),
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
    let fixture = Fixture::new();
    let app = static_files::attach(Router::new(), None, fixture.source());
    for path in ["/", "/assets/app-4f3a1c9d.js", "/campaigns/waterdeep"] {
        let response = fetch(&app, path);
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }
}

#[test]
fn the_flag_switches_hosting_off_and_on_without_a_restart() {
    let fixture = Fixture::new();
    let app = fixture.router();
    fixture.set(false);
    for path in ["/", "/assets/app-4f3a1c9d.js", "/campaigns/waterdeep"] {
        let response = fetch(&app, path);
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }

    fixture.set(true);
    let asset = fetch(&app, "/assets/app-4f3a1c9d.js");
    assert_eq!(asset.status, StatusCode::OK);
    assert_eq!(asset.body, ASSET);
}

#[test]
fn a_missing_flags_file_keeps_hosting_off() {
    let fixture = Fixture::new();
    std::fs::remove_file(&fixture.flags).unwrap();
    let response = fetch(&fixture.router(), "/campaigns/waterdeep");
    assert_eq!(response.status, StatusCode::NOT_FOUND);
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
