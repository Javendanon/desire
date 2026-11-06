//! Optional hosting of the compiled frontend from `DESIRE_STATIC_DIR`.
//!
//! Absent, the router answers only the API, exactly as before. Present, a `GET` or `HEAD`
//! path that is not a file returns `index.html` so the client router can resolve it.
//! `/api` and `/api/*` never fall back: an unknown API route stays a 404.
//!
//! `DESIRE_STATIC_DIR` is startup configuration, not a runtime flag: `docs/flags.md`
//! requires a re-read file for a switch that changes without a restart, and this path is
//! only read when the process starts. Unset is the safe state.

use axum::{
    Router,
    extract::State,
    http::{Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
};

/// Vite writes content-hashed filenames under this prefix.
const ASSET_PREFIX: &str = "/assets/";
const ASSET_CACHE: &str = "public, max-age=31536000, immutable";
const PAGE_CACHE: &str = "no-cache";
/// Vite appends eight hash characters; a shorter suffix is an ordinary file name.
const MIN_HASH_LENGTH: usize = 8;
const HTML: &str = "text/html; charset=utf-8";
const INDEX: &str = "index.html";

/// Markup-to-content-type table; unknown extensions fall back to a binary stream.
const TYPES: &[(&str, &str)] = &[
    ("html", HTML),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json"),
    ("map", "application/json"),
    ("wasm", "application/wasm"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("txt", "text/plain; charset=utf-8"),
    ("glb", "model/gltf-binary"),
    ("gltf", "model/gltf+json"),
];

/// Read the startup setting. A missing variable keeps static hosting off.
pub fn from_env() -> Result<Option<PathBuf>, String> {
    match std::env::var_os("DESIRE_STATIC_DIR") {
        None => Ok(None),
        Some(value) => configured(PathBuf::from(value)),
    }
}

/// A configured directory must be a build output: without `index.html` the app routes
/// would answer 500 later, so the server refuses to start instead.
fn configured(directory: PathBuf) -> Result<Option<PathBuf>, String> {
    if directory.as_os_str().is_empty() {
        return Err("DESIRE_STATIC_DIR is empty".into());
    }
    if !directory.join(INDEX).is_file() {
        return Err(format!(
            "DESIRE_STATIC_DIR has no {INDEX}: {}",
            directory.display()
        ));
    }
    Ok(Some(directory))
}

/// Add the static fallback to an assembled router. `None` changes nothing.
pub fn attach(router: Router, directory: Option<PathBuf>) -> Router {
    let Some(directory) = directory else {
        return router;
    };
    let files = Router::new()
        .fallback(static_file)
        .with_state(Arc::new(directory));
    router.fallback_service(files)
}

async fn static_file(State(root): State<Arc<PathBuf>>, method: Method, uri: Uri) -> Response {
    if !matches!(method, Method::GET | Method::HEAD) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = uri.path();
    if reserved(path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(relative) = safe_relative(path) {
        match read_regular_file(&root.join(relative)).await {
            Ok(Some(bytes)) => {
                let content_type = content_type(Path::new(relative));
                return file_response(bytes, content_type, cache_for(path));
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!(
                    "static: cannot read {}: {error}",
                    root.join(relative).display()
                );
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }
    index(&root).await
}

/// A missing file or directory is an app route; the shell resolves it in the browser.
async fn index(root: &Path) -> Response {
    match tokio::fs::read(root.join(INDEX)).await {
        Ok(bytes) => file_response(bytes, HTML, PAGE_CACHE),
        Err(error) => {
            eprintln!(
                "static: cannot read {}: {error}",
                root.join(INDEX).display()
            );
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `Ok(None)` means "not a regular file"; other I/O errors must be reported, not hidden.
async fn read_regular_file(path: &Path) -> Result<Option<Vec<u8>>, std::io::Error> {
    match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => tokio::fs::read(path).await.map(Some),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Only plain relative paths reach the filesystem: no hidden segments, no `.` or `..`,
/// no percent-encoding and no empty segment. Anything else falls back to the shell.
fn safe_relative(path: &str) -> Option<&str> {
    let relative = path.strip_prefix('/')?;
    let plain = |segment: &str| {
        !segment.is_empty()
            && !segment.starts_with('.')
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    relative.split('/').all(plain).then_some(relative)
}

fn reserved(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/")
}

/// Only a content-hashed build asset is immutable. `public/` files keep their names
/// (`mark.svg`, `abbey.jpg`), so they must be revalidated like the shell.
fn cache_for(path: &str) -> &'static str {
    let hashed = path
        .rsplit('/')
        .next()
        .and_then(|name| name.split_once('-'))
        .is_some_and(|(_, rest)| hash_like(rest));
    if path.starts_with(ASSET_PREFIX) && hashed {
        ASSET_CACHE
    } else {
        PAGE_CACHE
    }
}

/// Vite appends a content hash after the last dash: `index-DAi1n9St.css`.
fn hash_like(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or(value);
    stem.len() >= MIN_HASH_LENGTH
        && stem
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn content_type(path: &Path) -> &'static str {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| {
            TYPES
                .iter()
                .find(|(known, _)| known.eq_ignore_ascii_case(extension))
        })
        .map_or("application/octet-stream", |(_, value)| *value)
}

/// The body is always the file; the HTTP server strips it for `HEAD` and keeps the
/// matching `Content-Length`, so a `HEAD` probe reports the real size.
fn file_response(bytes: Vec<u8>, content_type: &'static str, cache: &'static str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_relative_paths_keep_their_segments() {
        assert_eq!(safe_relative("/index.html"), Some("index.html"));
        assert_eq!(
            safe_relative("/assets/app-4f3a1c.js"),
            Some("assets/app-4f3a1c.js")
        );
        assert_eq!(
            safe_relative("/campaigns/waterdeep"),
            Some("campaigns/waterdeep")
        );
    }

    #[test]
    fn traversal_hidden_and_encoded_paths_are_rejected() {
        for path in [
            "/",
            "/../Cargo.toml",
            "/assets/../index.html",
            "/.git/config",
            "/%2e%2e/Cargo.toml",
            "/assets//app.js",
            "//etc/passwd",
            "no-leading-slash",
        ] {
            assert_eq!(safe_relative(path), None, "{path}");
        }
    }

    #[test]
    fn only_api_paths_are_reserved() {
        assert!(reserved("/api"));
        assert!(reserved("/api/health"));
        assert!(!reserved("/apiary"));
        assert!(!reserved("/campaigns/api"));
    }

    #[test]
    fn hashed_assets_are_the_only_long_lived_cache() {
        assert_eq!(cache_for("/assets/app-4f3a1c9d.js"), ASSET_CACHE);
        assert_eq!(cache_for("/assets/index-DAi1n9St.css"), ASSET_CACHE);
        assert_eq!(cache_for("/assets/mark.svg"), PAGE_CACHE);
        assert_eq!(cache_for("/assets/abbey.jpg"), PAGE_CACHE);
        assert_eq!(cache_for("/index.html"), PAGE_CACHE);
        assert_eq!(cache_for("/favicon.ico"), PAGE_CACHE);
    }

    #[test]
    fn known_extensions_have_a_content_type_and_others_are_binary() {
        assert_eq!(content_type(Path::new("a.wasm")), "application/wasm");
        assert_eq!(content_type(Path::new("a.WASM")), "application/wasm");
        assert_eq!(
            content_type(Path::new("a.unknownext")),
            "application/octet-stream"
        );
        assert_eq!(
            content_type(Path::new("no-extension")),
            "application/octet-stream"
        );
    }
}
