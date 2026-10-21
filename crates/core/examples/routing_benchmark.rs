//! Measures native routing compute and bounded transfer sizes for D12.

use std::hint::black_box;
use std::time::Instant;

use desire_core::routing::{Cell, Grid, RouteRequest, RoutingError, find_route};

const GRID_SIZE: u32 = 256;
const RUNS: u32 = 20;
const OPEN_COST: u32 = 1;
const BYTES_PER_COST: u32 = 4;
const BYTES_PER_PATH_POINT: u32 = 8;

fn main() -> Result<(), RoutingError> {
    let cells = (GRID_SIZE * GRID_SIZE) as usize;
    let costs = vec![OPEN_COST; cells];
    let grid = Grid::new(GRID_SIZE, GRID_SIZE, &costs)?;
    let request = RouteRequest {
        request_id: 1,
        revision: 1,
        start: Cell::new(0, 0),
        goal: Cell::new(GRID_SIZE - 1, GRID_SIZE - 1),
    };
    let started = Instant::now();
    let mut plan = None;
    for _ in 0..RUNS {
        plan = Some(black_box(find_route(black_box(&grid), &request)?));
    }
    let elapsed = started.elapsed();
    report(cells as u32, plan.expect("benchmark ran at least once"));
    let average_ms = elapsed.as_secs_f64() * 1000.0 / f64::from(RUNS);
    println!("average_compute_ms={average_ms:.3}");
    Ok(())
}

fn report(input_cells: u32, plan: desire_core::routing::RoutePlan) {
    let input_bytes = input_cells * BYTES_PER_COST;
    let output_bytes = plan.cells.len() as u32 * BYTES_PER_PATH_POINT;
    println!("grid_cells={input_cells}");
    println!("path_points={}", plan.cells.len());
    println!("route_cost={}", plan.cost);
    println!("input_transfer_bytes={input_bytes}");
    println!("output_transfer_bytes={output_bytes}");
}
