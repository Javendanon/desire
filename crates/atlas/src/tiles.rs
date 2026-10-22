//! Ground tiles cut along the sector grid (`docs/waterdeep-3d/sector-format.md`, "Ground
//! tiles"): an albedo rectangle per tile and a height tile whose vertices sit at cell centres.
//! A height tile carries one extra vertex row and column from its neighbour, so tile meshes meet
//! with no gap (shading may differ a hair at the shared vertices, whose normals are one-sided).
//! Both are cut from fields computed over the whole map, so noise and smoothing are continuous
//! across tiles.

use rayon::prelude::*;

use crate::ground::HeightField;
use crate::raster_ops::Size;

/// The tile grid over the map: tiles of `tile_px` source pixels, cells of `cell_px`.
#[derive(Clone, Copy, Debug)]
pub struct TileGrid {
    pub size: Size,
    pub tile_px: usize,
    pub cell_px: usize,
    pub columns: usize,
    pub rows: usize,
}

impl TileGrid {
    /// # Panics
    /// When a tile is not a whole number of cells.
    pub fn new(size: Size, tile_px: usize, cell_px: usize) -> Self {
        assert!(
            tile_px.is_multiple_of(cell_px),
            "a tile must be a whole number of cells"
        );
        let (columns, rows) = (size.width.div_ceil(tile_px), size.height.div_ceil(tile_px));
        TileGrid {
            size,
            tile_px,
            cell_px,
            columns,
            rows,
        }
    }

    /// `[x, y, width, height]` of a tile in source pixels, partial at the map edges.
    pub fn pixels(&self, index: usize) -> [usize; 4] {
        let (x, y) = (
            (index % self.columns) * self.tile_px,
            (index / self.columns) * self.tile_px,
        );
        let width = self.tile_px.min(self.size.width - x);
        [x, y, width, self.tile_px.min(self.size.height - y)]
    }

    /// `[column, row, columns, rows]` of a tile's own cells in the map's cell grid.
    pub fn cells(&self, index: usize) -> [usize; 4] {
        let [x, y, width, height] = self.pixels(index);
        let cell = self.cell_px;
        let (column, row) = (x / cell, y / cell);
        [
            column,
            row,
            (x + width).div_ceil(cell) - column,
            (y + height).div_ceil(cell) - row,
        ]
    }
}

/// The tile's rectangle of a map-wide RGB buffer, row-major.
pub fn albedo_tile(rgb: &[u8], grid: &TileGrid, index: usize) -> Vec<u8> {
    let [x, y, width, height] = grid.pixels(index);
    (y..y + height)
        .flat_map(|row| {
            let start = (row * grid.size.width + x) * 3;
            rgb[start..start + width * 3].iter().copied()
        })
        .collect()
}

/// The tile's vertex heights in centimetres: its cells plus one shared row and column, the map's
/// last cell repeated at its edges. Row-major, `(columns + 1) × (rows + 1)`.
pub fn height_tile(field: &HeightField, grid: &TileGrid, index: usize) -> Vec<i16> {
    let [column, row, columns, rows] = grid.cells(index);
    let at = |i: usize, j: usize| {
        let cell =
            (row + j).min(field.rows - 1) * field.columns + (column + i).min(field.columns - 1);
        (f64::from(field.heights[cell]) * 100.0).round() as i16
    };
    (0..=rows)
        .flat_map(|j| (0..=columns).map(move |i| at(i, j)))
        .collect()
}

/// Mean of a cell's 3 × 3 neighbourhood, clipped at the field's edge.
fn neighbour_mean(field: &HeightField, cell: usize) -> f32 {
    let (column, row) = (cell % field.columns, cell / field.columns);
    let rows = row.saturating_sub(1)..=(row + 1).min(field.rows - 1);
    let columns = column.saturating_sub(1)..=(column + 1).min(field.columns - 1);
    let (sum, count) = rows
        .flat_map(|r| columns.clone().map(move |c| r * field.columns + c))
        .fold((0.0f32, 0.0f32), |(sum, count), c| {
            (sum + field.heights[c], count + 1.0)
        });
    sum / count
}

/// The field box-blurred `passes` times, so shores slope instead of stepping. O(cells · passes).
pub fn smooth(field: &HeightField, passes: usize) -> HeightField {
    let mut current = HeightField {
        heights: field.heights.clone(),
        ..*field
    };
    for _ in 0..passes {
        let heights = (0..current.heights.len())
            .into_par_iter()
            .map(|cell| neighbour_mean(&current, cell))
            .collect();
        current = HeightField { heights, ..current };
    }
    current
}

/// `ground.json`: how to find and place every ground tile.
#[derive(serde::Serialize)]
pub struct GroundIndex {
    pub format: &'static str,
    pub tile_px: usize,
    pub cell_px: usize,
    pub metres_per_pixel: f64,
    pub columns: usize,
    pub rows: usize,
    pub tiles: Vec<GroundEntry>,
}

/// One tile's line in `ground.json`: its pixel size and its own cells (vertices are one more
/// each way).
#[derive(serde::Serialize)]
pub struct GroundEntry {
    pub index: usize,
    pub width_px: usize,
    pub height_px: usize,
    pub cells_x: usize,
    pub cells_y: usize,
}

pub const GROUND_FORMAT: &str = "desire.ground-tiles/1";

impl TileGrid {
    pub fn index(&self, metres_per_pixel: f64) -> GroundIndex {
        let tiles = (0..self.columns * self.rows)
            .map(|index| {
                let [_, _, width_px, height_px] = self.pixels(index);
                let [_, _, cells_x, cells_y] = self.cells(index);
                GroundEntry {
                    index,
                    width_px,
                    height_px,
                    cells_x,
                    cells_y,
                }
            })
            .collect();
        GroundIndex {
            format: GROUND_FORMAT,
            tile_px: self.tile_px,
            cell_px: self.cell_px,
            metres_per_pixel,
            columns: self.columns,
            rows: self.rows,
            tiles,
        }
    }
}
