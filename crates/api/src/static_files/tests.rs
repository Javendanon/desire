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
    // Vite names chunks and workers `assets/[name]-[hash].js`, and a dashed chunk name
    // keeps its dashes in front of the hash.
    assert_eq!(cache_for("/assets/sector-worker-DAi1n9St.js"), ASSET_CACHE);
    assert_eq!(cache_for("/assets/app-4f3a_1c9d.js"), ASSET_CACHE);
    assert_eq!(cache_for("/assets/mark.svg"), PAGE_CACHE);
    assert_eq!(cache_for("/assets/abbey.jpg"), PAGE_CACHE);
    assert_eq!(cache_for("/assets/sector-worker.js"), PAGE_CACHE);
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
