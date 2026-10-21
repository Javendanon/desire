//! WebAssembly boundary tests.

use desire_wasm::{GridPoint, RouteIdentity, RouteSpan, RoutingGrid};

fn request() -> RouteIdentity {
    RouteIdentity::new(9, 4)
}

#[test]
fn plans_a_route_across_the_wasm_boundary() {
    let grid = RoutingGrid::new(3, 1, vec![1, 2, 3]);
    let span = RouteSpan::new(&GridPoint::new(0, 0), &GridPoint::new(2, 0));
    let outcome = grid.plan(&request(), &span);
    assert!(outcome.is_ok());
    assert_eq!(outcome.cost(), 5);
    assert_eq!(outcome.path(), vec![0, 0, 1, 0, 2, 0]);
    assert_eq!(outcome.request_id(), 9);
    assert!(outcome.error_message().is_empty());
}

#[test]
fn returns_explicit_errors_instead_of_panicking() {
    let grid = RoutingGrid::new(2, 1, vec![1]);
    let span = RouteSpan::new(&GridPoint::new(0, 0), &GridPoint::new(1, 0));
    let outcome = grid.plan(&request(), &span);
    assert!(!outcome.is_ok());
    assert_eq!(outcome.cost(), 0);
    assert!(outcome.path().is_empty());
    assert!(outcome.error_message().contains("expected"));
}
