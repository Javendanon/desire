//! Deterministic A* over four-neighbour cells.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::error::RoutingError;
use super::grid::{BLOCKED_CELL, Cell, Grid};
use super::{RoutePlan, RouteRequest};

const NO_PARENT: u32 = u32::MAX;
const UNREACHED: u64 = u64::MAX;
const NEIGHBOR_COUNT: usize = 4;

struct Relaxation {
    from: u32,
    to: u32,
    cost: u64,
}

#[derive(Clone, Copy)]
enum Endpoint {
    Start,
    Goal,
}

impl Endpoint {
    fn out_of_bounds(self, cell: Cell) -> RoutingError {
        match self {
            Self::Start => RoutingError::StartOutOfBounds {
                x: cell.x,
                y: cell.y,
            },
            Self::Goal => RoutingError::GoalOutOfBounds {
                x: cell.x,
                y: cell.y,
            },
        }
    }

    fn blocked(self, cell: Cell) -> RoutingError {
        match self {
            Self::Start => RoutingError::StartBlocked {
                x: cell.x,
                y: cell.y,
            },
            Self::Goal => RoutingError::GoalBlocked {
                x: cell.x,
                y: cell.y,
            },
        }
    }
}

fn endpoint_index(grid: &Grid<'_>, cell: Cell, endpoint: Endpoint) -> Result<u32, RoutingError> {
    let cost = grid
        .cost(cell)
        .ok_or_else(|| endpoint.out_of_bounds(cell))?;
    if cost == BLOCKED_CELL {
        return Err(endpoint.blocked(cell));
    }
    Ok(cell.index(grid.width()))
}

pub(crate) fn find_route(
    grid: &Grid<'_>,
    request: &RouteRequest,
) -> Result<RoutePlan, RoutingError> {
    if request.revision == 0 {
        return Err(RoutingError::InvalidRevision);
    }
    let start = endpoint_index(grid, request.start, Endpoint::Start)?;
    let goal = endpoint_index(grid, request.goal, Endpoint::Goal)?;
    let (cost, cells) = Search::new(grid, start, goal).run()?;
    let cost = u32::try_from(cost).map_err(|_| RoutingError::CostOverflow)?;
    let plan = RoutePlan {
        request_id: request.request_id,
        revision: request.revision,
        cost,
        cells,
    };
    Ok(plan)
}

struct Search<'grid, 'costs> {
    grid: &'grid Grid<'costs>,
    distances: Vec<u64>,
    parents: Vec<u32>,
    expanded: Vec<bool>,
    frontier: BinaryHeap<Reverse<(u64, u64, u32)>>,
    start: u32,
    goal: u32,
}

impl<'grid, 'costs> Search<'grid, 'costs> {
    fn new(grid: &'grid Grid<'costs>, start: u32, goal: u32) -> Self {
        let cells = (grid.width() * grid.height()) as usize;
        let mut search = Self {
            grid,
            distances: vec![UNREACHED; cells],
            parents: vec![NO_PARENT; cells],
            expanded: vec![false; cells],
            frontier: BinaryHeap::new(),
            start,
            goal,
        };
        search.distances[start as usize] = 0;
        let estimate = search.heuristic(start);
        search.frontier.push(Reverse((estimate, estimate, start)));
        search
    }

    /// A* with deterministic ties: estimate, then heuristic, then cell index.
    fn run(&mut self) -> Result<(u64, Vec<Cell>), RoutingError> {
        while let Some(Reverse((_, _, index))) = self.frontier.pop() {
            if self.expanded[index as usize] {
                continue;
            }
            self.expanded[index as usize] = true;
            if index == self.goal {
                return self.finish();
            }
            self.expand(index)?;
        }
        Err(RoutingError::NoPath)
    }

    fn expand(&mut self, index: u32) -> Result<(), RoutingError> {
        let current_cost = self.distances[index as usize];
        for next in self.neighbors(index).into_iter().flatten() {
            let step = self
                .grid
                .cost_at(next)
                .ok_or(RoutingError::InvalidSearchState { cell: next })?;
            if step == BLOCKED_CELL {
                continue;
            }
            let relaxation = Relaxation {
                from: index,
                to: next,
                cost: current_cost + u64::from(step),
            };
            self.relax(relaxation);
        }
        Ok(())
    }

    fn relax(&mut self, relaxation: Relaxation) {
        if relaxation.cost >= self.distances[relaxation.to as usize] {
            return;
        }
        self.distances[relaxation.to as usize] = relaxation.cost;
        self.parents[relaxation.to as usize] = relaxation.from;
        let heuristic = self.heuristic(relaxation.to);
        let estimate = relaxation.cost + heuristic;
        self.frontier
            .push(Reverse((estimate, heuristic, relaxation.to)));
    }

    fn heuristic(&self, index: u32) -> u64 {
        let goal = self.grid.cell_at(self.goal);
        let cell = self.grid.cell_at(index);
        let steps = u64::from(cell.x.abs_diff(goal.x) + cell.y.abs_diff(goal.y));
        steps * u64::from(self.grid.min_cost())
    }

    fn neighbors(&self, index: u32) -> [Option<u32>; NEIGHBOR_COUNT] {
        let cell = self.grid.cell_at(index);
        let width = self.grid.width();
        let mut result = [None; NEIGHBOR_COUNT];
        if cell.y > 0 {
            result[0] = Some(index - width);
        }
        if cell.x + 1 < width {
            result[1] = Some(index + 1);
        }
        if cell.y + 1 < self.grid.height() {
            result[2] = Some(index + width);
        }
        if cell.x > 0 {
            result[NEIGHBOR_COUNT - 1] = Some(index - 1);
        }
        result
    }

    fn finish(&self) -> Result<(u64, Vec<Cell>), RoutingError> {
        let cost = self.distances[self.goal as usize];
        Ok((cost, self.reconstruct()?))
    }

    fn reconstruct(&self) -> Result<Vec<Cell>, RoutingError> {
        let mut cells = Vec::new();
        let mut index = self.goal;
        loop {
            cells.push(self.grid.cell_at(index));
            if index == self.start {
                break;
            }
            let parent = self.parents[index as usize];
            if parent == NO_PARENT {
                return Err(RoutingError::InvalidSearchState { cell: index });
            }
            index = parent;
        }
        cells.reverse();
        Ok(cells)
    }
}
