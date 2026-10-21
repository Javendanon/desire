//! Contract tests for the pure routing core.

use desire_core::routing::{
    BLOCKED_CELL, Cell, Grid, MAX_GRID_CELLS, RouteRequest, RoutingError, find_route,
};

fn grid<'a>(width: u32, height: u32, costs: &'a [u32]) -> Grid<'a> {
    Grid::new(width, height, costs).expect("fixture grid must be valid")
}

fn request(request_id: u32, revision: u32, start: Cell, goal: Cell) -> RouteRequest {
    RouteRequest {
        request_id,
        revision,
        start,
        goal,
    }
}

fn flat_path(cells: &[Cell]) -> Vec<u32> {
    cells.iter().flat_map(|cell| [cell.x, cell.y]).collect()
}

#[test]
fn sums_destination_cell_costs() {
    let map = grid(3, 1, &[1, 2, 3]);
    let plan = find_route(&map, &request(7, 1, Cell::new(0, 0), Cell::new(2, 0)))
        .expect("straight line must be routable");
    assert_eq!(plan.cost, 5);
    assert_eq!(plan.request_id, 7);
    assert_eq!(plan.revision, 1);
    assert_eq!(flat_path(&plan.cells), vec![0, 0, 1, 0, 2, 0]);
}

#[test]
fn prefers_cheaper_longer_route() {
    let costs = [
        1, 1, 1, 1, //
        1, 9, 9, 1, //
        1, 1, 1, 1,
    ];
    let plan = find_route(
        &grid(4, 3, &costs),
        &request(1, 2, Cell::new(0, 1), Cell::new(3, 1)),
    )
    .expect("detour must be routable");
    assert_eq!(plan.cost, 5, "route through the expensive row must lose");
}

#[test]
fn rejects_a_fully_blocked_wall() {
    let costs = [
        1,
        BLOCKED_CELL,
        1, //
        1,
        BLOCKED_CELL,
        1, //
        1,
        BLOCKED_CELL,
        1,
    ];
    let error = find_route(
        &grid(3, 3, &costs),
        &request(1, 1, Cell::new(0, 0), Cell::new(2, 0)),
    )
    .expect_err("wall must make the goal unreachable");
    assert_eq!(error, RoutingError::NoPath);
}

#[test]
fn walks_around_an_obstacle() {
    let costs = [
        1,
        BLOCKED_CELL,
        1, //
        1,
        1,
        1, //
        1,
        1,
        1,
    ];
    let plan = find_route(
        &grid(3, 3, &costs),
        &request(1, 1, Cell::new(0, 0), Cell::new(2, 0)),
    )
    .expect("obstacle can be bypassed");
    assert_eq!(plan.cost, 4, "detour adds two destination cells");
}

#[test]
fn allows_zero_cost_cells() {
    let plan = find_route(
        &grid(3, 1, &[0, 0, 0]),
        &request(1, 1, Cell::new(0, 0), Cell::new(2, 0)),
    )
    .expect("zero-cost cells are traversable");
    assert_eq!(plan.cost, 0);
    assert_eq!(plan.cells.len(), 3);
}

#[test]
fn same_cell_has_zero_cost_and_one_point() {
    let map = grid(2, 2, &[1, 1, 1, 1]);
    let start = Cell::new(1, 1);
    let plan = find_route(&map, &request(1, 1, start, start)).expect("empty route is valid");
    assert_eq!(plan.cost, 0);
    assert_eq!(plan.cells, vec![start]);
}

#[test]
fn route_is_deterministic() {
    let costs = [1; 25];
    let map = grid(5, 5, &costs);
    let first = find_route(&map, &request(1, 1, Cell::new(0, 0), Cell::new(4, 4)))
        .expect("open grid must be routable");
    for _ in 0..10 {
        let next = find_route(&map, &request(1, 1, Cell::new(0, 0), Cell::new(4, 4)))
            .expect("repeat must be routable");
        assert_eq!(next.cells, first.cells);
    }
    assert_eq!(first.cost, 8);
    assert_eq!(flat_path(&first.cells), {
        let mut expected = Vec::with_capacity(18);
        for x in 0..5 {
            expected.extend([x, 0]);
        }
        for y in 1..5 {
            expected.extend([4, y]);
        }
        expected
    });
}

#[test]
fn reports_blocked_endpoints() {
    let map = grid(2, 1, &[BLOCKED_CELL, 1]);
    let start_blocked = find_route(&map, &request(1, 1, Cell::new(0, 0), Cell::new(1, 0)));
    assert_eq!(
        start_blocked.expect_err("blocked start must fail"),
        RoutingError::StartBlocked { x: 0, y: 0 }
    );
    let goal_blocked = find_route(&map, &request(1, 1, Cell::new(1, 0), Cell::new(0, 0)));
    assert_eq!(
        goal_blocked.expect_err("blocked goal must fail"),
        RoutingError::GoalBlocked { x: 0, y: 0 }
    );
}

#[test]
fn reports_out_of_bounds_endpoints() {
    let map = grid(2, 2, &[1, 1, 1, 1]);
    let start = find_route(&map, &request(1, 1, Cell::new(2, 0), Cell::new(1, 1)));
    assert_eq!(
        start.expect_err("start outside grid must fail"),
        RoutingError::StartOutOfBounds { x: 2, y: 0 }
    );
    let goal = find_route(&map, &request(1, 1, Cell::new(1, 1), Cell::new(0, 2)));
    assert_eq!(
        goal.expect_err("goal outside grid must fail"),
        RoutingError::GoalOutOfBounds { x: 0, y: 2 }
    );
}

#[test]
fn rejects_invalid_grids_and_identities() {
    assert_eq!(
        Grid::new(0, 1, &[]).expect_err("zero width must fail"),
        RoutingError::EmptyGrid
    );
    assert_eq!(
        Grid::new(2, 2, &[1, 1, 1]).expect_err("short buffer must fail"),
        RoutingError::BufferLengthMismatch {
            expected: 4,
            actual: 3
        }
    );
    let map = grid(1, 1, &[1]);
    assert_eq!(
        find_route(&map, &request(1, 0, Cell::new(0, 0), Cell::new(0, 0)))
            .expect_err("revision zero must fail"),
        RoutingError::InvalidRevision
    );
    assert_eq!(
        find_route(&map, &request(0, 1, Cell::new(0, 0), Cell::new(0, 0)))
            .expect_err("request id zero must fail"),
        RoutingError::InvalidRequestId
    );
}

#[test]
fn reports_cost_overflow_and_grid_bounds() {
    let error = find_route(
        &grid(3, 1, &[1, u32::MAX - 1, u32::MAX - 1]),
        &request(1, 1, Cell::new(0, 0), Cell::new(2, 0)),
    )
    .expect_err("total above u32 must be explicit");
    assert_eq!(error, RoutingError::CostOverflow);
    let too_large = u64::from(MAX_GRID_CELLS) + 1;
    assert_eq!(
        Grid::new(MAX_GRID_CELLS + 1, 1, &[]).expect_err("over-limit grid must fail"),
        RoutingError::GridTooLarge { cells: too_large }
    );
    assert_eq!(
        Grid::new(1, 0, &[]).expect_err("zero height must fail"),
        RoutingError::EmptyGrid
    );
}

#[test]
fn matches_typescript_reference_cost() {
    // Same fixture and expected cost as tools/routing/reference.ts.
    let costs = [
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
    let plan = find_route(
        &grid(6, 4, &costs),
        &request(1, 4, Cell::new(0, 0), Cell::new(5, 3)),
    )
    .expect("reference fixture must be routable");
    assert_eq!(plan.cost, 7);
}
