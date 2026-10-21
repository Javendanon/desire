//! Differential check of the scaled A* heuristic against a plain Dijkstra.
//!
//! Every grid here has a positive minimum cost, so the heuristic is active
//! (`h = distance * min_cost`); a zero-cost cell would reduce A* to Dijkstra.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use desire_core::routing::{BLOCKED_CELL, Cell, Grid, RouteRequest, RoutingError, find_route};

const GRIDS: u32 = 200;
const SIDE: u32 = 9;
const MIN_COST: u32 = 2;
const COST_SPREAD: u32 = 7;
const BLOCKED_PER_TEN: u32 = 2;

/// Deterministic linear congruential generator; no external dependency.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, bound: u32) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) % u64::from(bound)) as u32
    }
}

fn random_costs(rng: &mut Lcg) -> Vec<u32> {
    (0..SIDE * SIDE)
        .map(|_| {
            if rng.next(10) < BLOCKED_PER_TEN {
                BLOCKED_CELL
            } else {
                MIN_COST + rng.next(COST_SPREAD)
            }
        })
        .collect()
}

fn neighbours(index: usize) -> impl Iterator<Item = usize> {
    let side = SIDE as usize;
    let (x, y) = (index % side, index / side);
    let west = x.checked_sub(1).map(|wx| y * side + wx);
    let east = (x + 1 < side).then(|| y * side + x + 1);
    let north = y.checked_sub(1).map(|ny| ny * side + x);
    let south = (y + 1 < side).then(|| (y + 1) * side + x);
    [west, east, north, south].into_iter().flatten()
}

/// Reference cost with the core's convention: destination cells are charged. O(n log n).
fn dijkstra(costs: &[u32], start: usize, goal: usize) -> Option<u64> {
    let mut best = vec![u64::MAX; costs.len()];
    let mut frontier = BinaryHeap::from([Reverse((0_u64, start))]);
    best[start] = 0;
    while let Some(Reverse((distance, cell))) = frontier.pop() {
        if cell == goal {
            return Some(distance);
        }
        if distance > best[cell] {
            continue;
        }
        for next in neighbours(cell).filter(|&next| costs[next] != BLOCKED_CELL) {
            let candidate = distance + u64::from(costs[next]);
            if candidate < best[next] {
                best[next] = candidate;
                frontier.push(Reverse((candidate, next)));
            }
        }
    }
    None
}

fn corner_request(revision: u32) -> RouteRequest {
    RouteRequest {
        request_id: revision,
        revision,
        start: Cell::new(0, 0),
        goal: Cell::new(SIDE - 1, SIDE - 1),
    }
}

#[test]
fn scaled_heuristic_matches_dijkstra_on_positive_cost_grids() {
    let mut rng = Lcg(0x00d1_2a57);
    let goal = (SIDE * SIDE - 1) as usize;
    let mut routed = 0;
    for revision in 1..=GRIDS {
        let mut costs = random_costs(&mut rng);
        costs[0] = MIN_COST;
        costs[goal] = MIN_COST;
        let grid = Grid::new(SIDE, SIDE, &costs).expect("fixture grid must be valid");
        let result = find_route(&grid, &corner_request(revision));
        match (dijkstra(&costs, 0, goal), result) {
            (Some(expected), Ok(plan)) => {
                assert_eq!(u64::from(plan.cost), expected, "grid {revision}: {costs:?}");
                routed += 1;
            }
            (None, Err(RoutingError::NoPath)) => {}
            (expected, actual) => panic!("grid {revision}: {expected:?} vs {actual:?}"),
        }
    }
    assert!(
        routed > GRIDS / 2,
        "fixture must exercise mostly routable grids: {routed}"
    );
}
