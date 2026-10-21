//! WebAssembly boundary for the shared routing core.
//!
//! Input costs are copied once into Wasm memory and the path is copied once
//! back out. No Wasm view escapes this module, so a later memory growth cannot
//! invalidate a JavaScript `Uint32Array`.

use desire_core::routing::{Cell, Grid, RoutePlan, RouteRequest, RoutingError, find_route};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    desire_core::PROTOCOL_VERSION
}

/// Integer cell coordinate; x grows east, y grows south.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct GridPoint {
    pub x: u32,
    pub y: u32,
}

#[wasm_bindgen]
impl GridPoint {
    #[wasm_bindgen(constructor)]
    pub fn new(x: u32, y: u32) -> Self {
        Self { x, y }
    }
}

impl From<GridPoint> for Cell {
    fn from(point: GridPoint) -> Self {
        Self::new(point.x, point.y)
    }
}

/// Start and goal cells for one routing request.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct RouteSpan {
    start: GridPoint,
    goal: GridPoint,
}

#[wasm_bindgen]
impl RouteSpan {
    #[wasm_bindgen(constructor)]
    pub fn new(start: &GridPoint, goal: &GridPoint) -> Self {
        Self {
            start: *start,
            goal: *goal,
        }
    }
}

/// Request identity used by the worker to discard obsolete results.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct RouteIdentity {
    pub request_id: u32,
    pub revision: u32,
}

#[wasm_bindgen]
impl RouteIdentity {
    #[wasm_bindgen(constructor)]
    pub fn new(request_id: u32, revision: u32) -> Self {
        Self {
            request_id,
            revision,
        }
    }
}

/// Owned grid buffer held for one or more route requests.
#[wasm_bindgen]
pub struct RoutingGrid {
    width: u32,
    height: u32,
    costs: Vec<u32>,
}

#[wasm_bindgen]
impl RoutingGrid {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, costs: Vec<u32>) -> Self {
        Self {
            width,
            height,
            costs,
        }
    }

    /// Plans one route; validation and search errors arrive as outcomes.
    pub fn plan(&self, identity: &RouteIdentity, span: &RouteSpan) -> RouteOutcome {
        let request = RouteRequest {
            request_id: identity.request_id,
            revision: identity.revision,
            start: Cell::from(span.start),
            goal: Cell::from(span.goal),
        };
        let plan = Grid::new(self.width, self.height, &self.costs)
            .and_then(|grid| find_route(&grid, &request));
        RouteOutcome { request, plan }
    }
}

/// Typed result or failure for one request identity.
#[wasm_bindgen]
pub struct RouteOutcome {
    request: RouteRequest,
    plan: Result<RoutePlan, RoutingError>,
}

#[wasm_bindgen]
impl RouteOutcome {
    pub fn request_id(&self) -> u32 {
        self.request.request_id
    }

    pub fn revision(&self) -> u32 {
        self.request.revision
    }

    pub fn is_ok(&self) -> bool {
        self.plan.is_ok()
    }

    pub fn cost(&self) -> u32 {
        self.plan.as_ref().map_or(0, |plan| plan.cost)
    }

    /// Flat `[x0, y0, x1, y1, ...]` path; empty on failure.
    pub fn path(&self) -> Vec<u32> {
        self.plan
            .as_ref()
            .map(|plan| {
                plan.cells
                    .iter()
                    .flat_map(|cell| [cell.x, cell.y])
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn error_message(&self) -> String {
        self.plan
            .as_ref()
            .err()
            .map_or_else(String::new, ToString::to_string)
    }
}
