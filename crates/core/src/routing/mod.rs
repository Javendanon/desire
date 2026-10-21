//! Pure route calculation shared by the native API and the Wasm worker.
//!
//! The caller owns the map format: this module only accepts a flat row-major
//! `u32` cost buffer. `BLOCKED_CELL` marks an obstacle; any other value is a
//! non-negative traversal cost, and zero-cost cells are valid.

mod error;
mod grid;
mod search;

pub use error::RoutingError;
pub use grid::{BLOCKED_CELL, Cell, Grid, MAX_GRID_CELLS};

/// Typed request with the identity needed to discard stale results.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RouteRequest {
    /// Positive monotonic identifier assigned by the worker client.
    pub request_id: u32,
    /// Map revision that produced the cost buffer (D04 positive revision).
    pub revision: u32,
    pub start: Cell,
    pub goal: Cell,
}

/// Successful route for one request identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutePlan {
    pub request_id: u32,
    pub revision: u32,
    /// Sum of destination cell costs; the start cell is not charged.
    pub cost: u32,
    /// Inclusive start-to-goal path.
    pub cells: Vec<Cell>,
}

/// Finds a deterministic four-neighbour route over a non-negative cost grid.
///
/// A* with a Manhattan heuristic scaled by the grid's minimum cost. Ties are
/// resolved by estimate, heuristic and cell index so repeated calls agree.
/// O(cells log cells) time and O(cells) memory.
pub fn find_route(grid: &Grid<'_>, request: &RouteRequest) -> Result<RoutePlan, RoutingError> {
    search::find_route(grid, request)
}
