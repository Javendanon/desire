//! Borrowed cost grid. The caller owns the buffer and the map format.

use super::error::RoutingError;

/// Maximum cells accepted in one transfer (4 MiB of `u32` input).
pub const MAX_GRID_CELLS: u32 = 1_048_576;

/// Sentinel cost for an obstacle. Any other value, including zero, is traversable.
pub const BLOCKED_CELL: u32 = u32::MAX;

/// Integer cell coordinate; x grows east, y grows south (raster order).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cell {
    pub x: u32,
    pub y: u32,
}

impl Cell {
    pub const fn new(x: u32, y: u32) -> Self {
        Self { x, y }
    }

    pub(crate) fn index(self, width: u32) -> u32 {
        self.y * width + self.x
    }
}

/// Validated view over a flat, row-major cost buffer.
pub struct Grid<'a> {
    width: u32,
    height: u32,
    costs: &'a [u32],
    min_cost: u32,
}

impl std::fmt::Debug for Grid<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Grid")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("min_cost", &self.min_cost)
            .finish_non_exhaustive()
    }
}

impl<'a> Grid<'a> {
    /// Validates dimensions and buffer length without copying.
    pub fn new(width: u32, height: u32, costs: &'a [u32]) -> Result<Self, RoutingError> {
        if width == 0 || height == 0 {
            return Err(RoutingError::EmptyGrid);
        }
        let cells = u64::from(width) * u64::from(height);
        if cells > u64::from(MAX_GRID_CELLS) {
            return Err(RoutingError::GridTooLarge { cells });
        }
        if costs.len() != cells as usize {
            return Err(RoutingError::BufferLengthMismatch {
                expected: cells as usize,
                actual: costs.len(),
            });
        }
        let min_cost = costs
            .iter()
            .copied()
            .filter(|cost| *cost != BLOCKED_CELL)
            .min()
            .unwrap_or(0);
        Ok(Self {
            width,
            height,
            costs,
            min_cost,
        })
    }

    pub const fn width(&self) -> u32 {
        self.width
    }

    pub const fn height(&self) -> u32 {
        self.height
    }

    /// Cost of a cell, or `None` when the coordinate is outside the grid.
    pub fn cost(&self, cell: Cell) -> Option<u32> {
        if cell.x >= self.width || cell.y >= self.height {
            return None;
        }
        self.cost_at(cell.index(self.width))
    }

    pub(crate) fn min_cost(&self) -> u32 {
        self.min_cost
    }

    pub(crate) fn cost_at(&self, index: u32) -> Option<u32> {
        self.costs.get(index as usize).copied()
    }

    pub(crate) fn cell_at(&self, index: u32) -> Cell {
        Cell::new(index % self.width, index / self.width)
    }
}
