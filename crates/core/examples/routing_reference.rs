//! Prints the shared reference fixture so TypeScript can compare route cost.

use desire_core::routing::{BLOCKED_CELL, Cell, Grid, RouteRequest, RoutingError, find_route};

const WIDTH: u32 = 6;
const HEIGHT: u32 = 4;
const COSTS: [u32; 24] = [
    1,
    1,
    1,
    BLOCKED_CELL,
    1,
    1, //
    1,
    9,
    1,
    9,
    9,
    1, //
    1,
    1,
    0,
    1,
    1,
    1, //
    1,
    9,
    9,
    9,
    9,
    1,
];

fn main() -> Result<(), RoutingError> {
    let grid = Grid::new(WIDTH, HEIGHT, &COSTS)?;
    let request = RouteRequest {
        request_id: 1,
        revision: 4,
        start: Cell::new(0, 0),
        goal: Cell::new(5, 3),
    };
    let plan = find_route(&grid, &request)?;
    println!("cost={} path_points={}", plan.cost, plan.cells.len());
    Ok(())
}
