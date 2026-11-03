//! Two API instances must agree on retries after both miss the initial replay lookup.
use crate::support::{self, TestDb, call_with_headers, id, map_version, uri};
use axum::http::{Method, StatusCode};
use desire_api::{AppState, app};
use postgres::Client;
use serde_json::json;
use std::{
    thread,
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Request {
    path: String,
    owner: String,
    name: String,
    key: String,
}

fn spawn_request(
    mut client: Client,
    request: Request,
    isolation: &str,
) -> thread::JoinHandle<support::Response> {
    client
        .batch_execute(&format!(
            "SET default_transaction_isolation = '{isolation}'; \
        SET application_name = 'd09_idempotency_race'"
        ))
        .unwrap();
    thread::spawn(move || {
        let router = app(AppState::from_client(client));
        support::run(call_with_headers(
            &router,
            Method::POST,
            &request.path,
            Some(&request.owner),
            Some(json!({"name":request.name,
                "map_version_id":map_version()})),
            &[("idempotency-key", &request.key)],
        ))
    })
}

fn both_wait_on_stream(client: &mut Client) -> bool {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let count: i64 = client
            .query_one(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() \
             AND application_name = 'd09_idempotency_race' AND wait_event_type = 'Lock' \
             AND query LIKE '%campaign.streams%'",
                &[],
            )
            .unwrap()
            .get(0);
        if count == 2 {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    false
}

struct Fixture {
    db: TestDb,
    request: Request,
    campaign: String,
}

impl Fixture {
    fn new() -> Self {
        let db = TestDb::new();
        let setup = support::app_for(&db);
        let owner = id(90);
        let campaign = support::run(support::campaign(&setup, &owner));
        let request = Request {
            path: uri(&campaign, "/scenes"),
            owner,
            name: "Dock".into(),
            key: id(500),
        };
        db.connection()
            .execute(
                "INSERT INTO campaign.streams (campaign_id) VALUES ($1::text::uuid)",
                &[&campaign],
            )
            .unwrap();
        Self {
            db,
            request,
            campaign,
        }
    }
}

fn race(isolation: &str, different: bool) -> (Vec<support::Response>, i64) {
    let f = Fixture::new();
    let mut observer = f.db.connection();
    let mut guard = f.db.connection();
    let mut tx = guard.transaction().unwrap();
    tx.query_one(
        "SELECT revision FROM campaign.streams WHERE campaign_id = $1::text::uuid \
        FOR UPDATE",
        &[&f.campaign],
    )
    .unwrap();
    let mut second = f.request.clone();
    if different {
        second.name = "Market".into();
    }
    let handles = [
        spawn_request(f.db.connection(), f.request, isolation),
        spawn_request(f.db.connection(), second, isolation),
    ];
    let blocked = both_wait_on_stream(&mut observer);
    tx.commit().unwrap();
    let responses = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert!(
        blocked,
        "both independent API instances must miss preflight before release"
    );
    let events = observer
        .query_one("SELECT count(*) FROM campaign.outbox", &[])
        .unwrap()
        .get(0);
    (responses, events)
}

#[test]
fn concurrent_scene_retries_replay_across_api_instances() {
    for isolation in ["read committed", "repeatable read"] {
        let (responses, events) = race(isolation, false);
        for response in &responses {
            assert_eq!(
                response.status,
                StatusCode::CREATED,
                "{isolation}: {}",
                response.body
            );
        }
        assert_eq!(responses[0].body, responses[1].body);
        assert_eq!(events, 1);
    }
}

#[test]
fn concurrent_different_scene_requests_keep_idempotency_conflict() {
    for isolation in ["read committed", "repeatable read"] {
        let (responses, events) = race(isolation, true);
        assert_eq!(
            responses
                .iter()
                .filter(|r| r.status == StatusCode::CREATED)
                .count(),
            1
        );
        let rejected = responses
            .iter()
            .find(|r| r.status != StatusCode::CREATED)
            .unwrap();
        assert_eq!(
            rejected.status,
            StatusCode::CONFLICT,
            "{isolation}: {}",
            rejected.body
        );
        assert_eq!(rejected.body["code"], "idempotency_conflict");
        assert_eq!(events, 1);
    }
}
