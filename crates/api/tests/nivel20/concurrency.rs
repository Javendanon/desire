//! Controlled source responses prove import ordering without timing-based sleeps.
use super::*;
use std::{sync::mpsc, time::Duration};
use support::Response;
use tokio::sync::oneshot;

struct PendingRead {
    accepted: oneshot::Receiver<()>,
    release: mpsc::Sender<()>,
}

/// Each response waits for the test to release it, after the request has reached the source.
fn controlled_source(bodies: Vec<String>) -> (String, Vec<PendingRead>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let mut pending = Vec::new();
    let mut responses = Vec::new();
    for body in bodies {
        let (accepted, received) = oneshot::channel();
        let (release, released) = mpsc::channel();
        pending.push(PendingRead {
            accepted: received,
            release,
        });
        responses.push((body, accepted, released));
    }
    thread::spawn(move || {
        for (body, accepted, released) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            thread::spawn(move || {
                let request = read_request(&mut stream);
                accepted.send(()).unwrap();
                released.recv_timeout(Duration::from_secs(5)).unwrap();
                let (status, body) = request_answer(&request, 200, body);
                write_response(&mut stream, status, &body, None);
            });
        }
    });
    (base_url, pending)
}

fn overlapping_imports(
    initial: Option<&str>,
    delayed: &str,
    winner: &str,
) -> (Response, Response, Value) {
    let db = TestDb::new();
    let owner = id(90);
    let local_app = support::app_for(&db);
    let campaign = support::run(support::campaign(&local_app, &owner));
    if let Some(name) = initial {
        let source = FakeSource::start(vec![(200, source_body(name, "2026-10-01T00:00:00Z"))]);
        support::run(import_with(&router(&db, &source), &campaign, &owner));
    }
    let bodies = [delayed, winner].map(|name| source_body(name, "2026-10-01T00:00:00Z"));
    let (base_url, pending) = controlled_source(bodies.into());
    let app = router_with(&db, &base_url);
    support::run(drive_overlap(&app, &campaign, &owner, pending))
}

async fn drive_overlap(
    app: &Router,
    campaign: &str,
    owner: &str,
    pending: Vec<PendingRead>,
) -> (Response, Response, Value) {
    let mut pending = pending.into_iter();
    let delayed = pending.next().unwrap();
    let winner = pending.next().unwrap();
    let delayed_app = app.clone();
    let request = source_call(Method::POST, campaign, owner, "/import");
    let delayed_response = tokio::spawn(async move { call(&delayed_app, request).await });
    delayed.accepted.await.unwrap();
    let winner_app = app.clone();
    let request = source_call(Method::POST, campaign, owner, "/import");
    let winner_response = tokio::spawn(async move { call(&winner_app, request).await });
    winner.accepted.await.unwrap();
    winner.release.send(()).unwrap();
    let winner_response = winner_response.await.unwrap();
    delayed.release.send(()).unwrap();
    let delayed_response = delayed_response.await.unwrap();
    let local = call(
        app,
        ApiCall::new(
            Method::GET,
            &format!("/api/v1/campaigns/{campaign}/nivel20"),
        )
        .by(owner),
    )
    .await;
    assert_eq!(local.status, StatusCode::OK, "{}", local.body);
    (delayed_response, winner_response, local.body)
}

#[test]
fn overlapping_identical_imports_only_write_once() {
    for initial in [None, Some("Original")] {
        let (delayed, winner, local) = overlapping_imports(initial, "Current", "Current");
        assert_eq!(winner.status, StatusCode::OK, "{}", winner.body);
        assert_eq!(delayed.status, StatusCode::OK, "{}", delayed.body);
        assert_eq!(
            winner.body["status"],
            if initial.is_some() { "changed" } else { "new" }
        );
        assert_eq!(winner.body["imported"], true);
        assert_eq!(delayed.body["status"], "unchanged");
        assert_eq!(delayed.body["imported"], false);
        assert_eq!(delayed.body["changed_fields"], json!([]));
        assert_eq!(delayed.body["previous"], winner.body["stored"]);
        assert_eq!(delayed.body["stored"], winner.body["stored"]);
        assert_eq!(local, winner.body["stored"]);
    }
}

#[test]
fn out_of_order_source_responses_cannot_overwrite_a_newer_import() {
    // Includes a delayed response that looked unchanged against its pre-network snapshot.
    for initial in [None, Some("Original"), Some("Old response")] {
        let (delayed, winner, local) = overlapping_imports(initial, "Old response", "New response");
        assert_eq!(winner.status, StatusCode::OK, "{}", winner.body);
        assert_eq!(winner.body["imported"], true);
        assert_eq!(delayed.status, StatusCode::CONFLICT, "{}", delayed.body);
        assert_eq!(delayed.body["code"], "conflict");
        assert_eq!(local, winner.body["stored"]);
        assert_eq!(local["campaign"]["name"], "New response");
    }
}
