//! Database lock contention must not inherit a stale REPEATABLE READ snapshot.
use super::*;
use postgres::Client;
use std::time::{Duration, Instant};
use support::Response;

fn spawn_import(db: &TestDb, campaign: &str, name: &str) -> thread::JoinHandle<Response> {
    let mut client = db.connection();
    client
        .batch_execute(
            "SET default_transaction_isolation = 'repeatable read'; \
         SET application_name = 'd19_import_race'",
        )
        .unwrap();
    let source = FakeSource::start(vec![(200, source_body(name, "2026-10-01T00:00:00Z"))]);
    let mut state = AppState::from_client(client);
    state.nivel20 = Nivel20Client::new(source.base_url).unwrap();
    state.flags = flags_on();
    let campaign = campaign.to_string();
    thread::spawn(move || {
        let app = app(state);
        support::run(call(
            &app,
            source_call(Method::POST, &campaign, &id(90), "/import"),
        ))
    })
}

/// Observe actual lock waits instead of assuming a request reached its save after a sleep.
fn wait_for_imports(observer: &mut Client, expected: i64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        let count: i64 = observer
            .query_one(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() \
             AND application_name = 'd19_import_race' AND wait_event_type = 'Lock' \
             AND query LIKE '%campaign.campaigns%FOR UPDATE%'",
                &[],
            )
            .unwrap()
            .get(0);
        if count == expected {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    false
}

fn contending_imports(initial: Option<&str>, second_name: &str) -> (Response, Response, Value) {
    let db = TestDb::new();
    let owner = id(90);
    let app = support::app_for(&db);
    let campaign = support::run(support::campaign(&app, &owner));
    if let Some(name) = initial {
        let source = FakeSource::start(vec![(200, source_body(name, "2026-10-01T00:00:00Z"))]);
        support::run(import_with(&router(&db, &source), &campaign, &owner));
    }
    let mut observer = db.connection();
    let mut guard = db.connection();
    let mut transaction = guard.transaction().unwrap();
    transaction
        .query_one(
            "SELECT id FROM campaign.campaigns WHERE id = $1::text::uuid FOR UPDATE",
            &[&campaign],
        )
        .unwrap();
    let first = spawn_import(&db, &campaign, "Current");
    let first_waiting = wait_for_imports(&mut observer, 1);
    let second = spawn_import(&db, &campaign, second_name);
    let both_waiting = wait_for_imports(&mut observer, 2);
    transaction.commit().unwrap();
    let first = first.join().unwrap();
    let second = second.join().unwrap();
    assert!(
        first_waiting && both_waiting,
        "both saves must contend on the campaign lock"
    );
    let local = support::run(call(
        &router_with(&db, &unreachable_base_url()),
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(&owner),
    ));
    assert_eq!(local.status, StatusCode::OK, "{}", local.body);
    (first, second, local.body)
}

#[test]
fn contending_identical_imports_ignore_the_session_isolation_default() {
    for initial in [None, Some("Original")] {
        let (first, second, local) = contending_imports(initial, "Current");
        assert_eq!(first.status, StatusCode::OK, "{}", first.body);
        assert_eq!(second.status, StatusCode::OK, "{}", second.body);
        assert_eq!(first.body["imported"], true);
        assert_eq!(second.body["status"], "unchanged");
        assert_eq!(second.body["imported"], false);
        assert_eq!(second.body["stored"], first.body["stored"]);
        assert_eq!(local, first.body["stored"]);
    }
}

#[test]
fn contending_stale_imports_ignore_the_session_isolation_default() {
    for initial in [None, Some("Original"), Some("Old")] {
        let (first, second, local) = contending_imports(initial, "Old");
        assert_eq!(first.status, StatusCode::OK, "{}", first.body);
        assert_eq!(second.status, StatusCode::CONFLICT, "{}", second.body);
        assert_eq!(second.body["code"], "revision_conflict");
        assert_eq!(local, first.body["stored"]);
    }
}
