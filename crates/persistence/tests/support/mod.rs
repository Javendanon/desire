//! Every test uses its own database in the socket-only disposable cluster.
use postgres::{Client, Config, NoTls};
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_DATABASE: AtomicUsize = AtomicUsize::new(0);

pub fn connect(name: &str) -> Client {
    let socket = std::env::var("DESIRE_TEST_SOCKET")
        .expect("run bash crates/persistence/test-postgres.sh; no external database is allowed");
    Config::new()
        .host_path(socket)
        .user("desire_test")
        .dbname(name)
        .connect(NoTls)
        .unwrap()
}

pub fn database() -> Client {
    let mut admin = connect("postgres");
    let name = format!(
        "d08_{}_{}",
        std::process::id(),
        NEXT_DATABASE.fetch_add(1, Ordering::Relaxed)
    );
    admin
        .batch_execute(&format!("CREATE DATABASE {name}"))
        .unwrap();
    connect(&name)
}

pub fn catalog() -> desire_persistence::CatalogSeed {
    let provenance = serde_json::json!({
        "source": "fixture:D08", "attribution": "Synthetic test content", "evidence": "synthetic"
    });
    serde_json::from_value(serde_json::json!({
        "worlds": [{"id": id(1), "name": "Synthetic world", "provenance": provenance}],
        "eras": [{"id": id(2), "world_id": id(1), "name": "Synthetic era"}],
        "cities": [{"id": id(3), "era_id": id(2), "name": "Waterdeep",
            "provenance": provenance}],
        "places": [{"id": id(5), "city_id": id(3), "district_id": null,
            "name": "Synthetic place", "provenance": provenance, "anchors": []}],
        "map_versions": [{"id": id(6), "map_id": id(60), "city_id": id(3),
            "revision": 1, "calibration": null, "provenance": provenance}],
        "knowledge_entries": [{"id": id(50), "revision": 1, "rules_edition": "dnd_2014",
            "language": "en", "title": "Synthetic condition", "body": "Not official rules",
            "provenance": provenance}]
    }))
    .unwrap()
}

pub fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012x}")
}
