//! Anonymous login admission is isolated by client network, never source port or browser headers.
use crate::{
    oidc_flow::Fixture,
    support::{self, ApiCall, Response},
};
use axum::http::{Method, StatusCode};

const CLIENT_QUOTA: u16 = 8;
/// Pending flows one IPv6 /48 (or IPv4 /24) may hold, whatever addresses it rotates through.
const NETWORK_BUDGET: usize = 64;

fn start(fixture: &Fixture, port: u16) -> Response {
    support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/auth/login")
            .with_peer(format!("192.0.2.1:{port}").parse().unwrap())
            .headers(&[("x-forwarded-for", &format!("198.51.100.{port}"))]),
    ))
}

#[test]
fn an_abusive_client_is_throttled_without_blocking_another_client() {
    let fixture = Fixture::new("");
    for port in 1..=CLIENT_QUOTA {
        assert_eq!(start(&fixture, port).status, StatusCode::SEE_OTHER);
    }
    let rejected = start(&fixture, CLIENT_QUOTA + 1);
    assert_eq!(rejected.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(rejected.body["code"], "oidc_rate_limited");
    assert_eq!(rejected.headers["cache-control"], "no-store");
    assert!(!rejected.headers.contains_key("set-cookie"));
    fixture.begin();
}

#[test]
fn concurrent_requests_cannot_exceed_one_clients_quota() {
    let fixture = Fixture::new("");
    let barrier = &std::sync::Barrier::new(usize::from(CLIENT_QUOTA * 2));
    let statuses = std::thread::scope(|scope| {
        let fixture = &fixture;
        let workers: Vec<_> = (1..=CLIENT_QUOTA * 2)
            .map(|port| {
                scope.spawn(move || {
                    barrier.wait();
                    start(fixture, port).status
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>()
    });
    let accepted = statuses
        .iter()
        .filter(|status| **status == StatusCode::SEE_OTHER)
        .count();
    let rejected = statuses
        .iter()
        .filter(|status| **status == StatusCode::TOO_MANY_REQUESTS)
        .count();
    assert_eq!(
        (accepted, rejected),
        (usize::from(CLIENT_QUOTA), usize::from(CLIENT_QUOTA))
    );
    fixture.begin();
}

#[test]
fn a_callback_releases_its_client_quota() {
    let fixture = Fixture::new("");
    let first = fixture.begin();
    for _ in 1..CLIENT_QUOTA {
        fixture.begin();
    }
    let rejected = support::run(support::call(
        &fixture.app,
        ApiCall::new(Method::GET, "/api/v1/auth/login"),
    ));
    assert_eq!(rejected.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(fixture.finish(&first).status, StatusCode::SEE_OTHER);
    fixture.begin();
}

#[test]
fn rotating_addresses_inside_one_ipv6_network_cannot_lock_out_another_client() {
    const PENDING_FLOW_CAPACITY: usize = 1024;
    let fixture = Fixture::new("");
    let statuses: Vec<_> = (0..PENDING_FLOW_CAPACITY)
        .map(|index| {
            let peer = format!("[2001:db8:1:{:x}::{:x}]:40000", index % 256, index + 1);
            support::run(support::call(
                &fixture.app,
                ApiCall::new(Method::GET, "/api/v1/auth/login").with_peer(peer.parse().unwrap()),
            ))
            .status
        })
        .collect();
    let accepted = statuses
        .iter()
        .filter(|status| **status == StatusCode::SEE_OTHER)
        .count();
    assert_eq!(accepted, NETWORK_BUDGET);
    fixture.begin();
}
