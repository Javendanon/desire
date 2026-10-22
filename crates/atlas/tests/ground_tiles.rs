//! Ground tiles: cut along the sector grid, seamless where tiles meet.

use desire_atlas::ground::HeightField;
use desire_atlas::raster_ops::Size;
use desire_atlas::tiles::{TileGrid, albedo_tile, height_tile, smooth};

/// A 10 × 7 px map in tiles of 4 px with 2-px cells: 3 × 2 tiles, the last ones partial.
fn grid() -> TileGrid {
    TileGrid::new(Size { width: 10, height: 7 }, 4, 2)
}

fn field() -> HeightField {
    let (columns, rows) = (5, 4);
    let heights = (0..columns * rows).map(|cell| cell as f32 / 10.0).collect();
    HeightField { columns, rows, heights }
}

#[test]
fn tiles_follow_the_grid_with_partial_edges() {
    let grid = grid();
    assert_eq!((grid.columns, grid.rows), (3, 2));
    let rects: Vec<[usize; 4]> = (0..6).map(|index| grid.pixels(index)).collect();
    assert_eq!(rects[0], [0, 0, 4, 4]);
    assert_eq!(rects[2], [8, 0, 2, 4]);
    assert_eq!(rects[5], [8, 4, 2, 3]);
    assert_eq!(grid.cells(5), [4, 2, 1, 2]);
}

#[test]
fn albedo_tiles_are_the_map_pixels_of_their_rectangle() {
    let grid = grid();
    let rgb: Vec<u8> = (0..70).flat_map(|pixel| [pixel as u8, 0, 1]).collect();
    let tile = albedo_tile(&rgb, &grid, 5);
    assert_eq!(tile.len(), 2 * 3 * 3);
    assert_eq!(&tile[..6], &[48, 0, 1, 49, 0, 1]);
    assert_eq!(&tile[tile.len() - 3..], &[69, 0, 1]);
}

#[test]
fn neighbouring_height_tiles_share_their_edge_vertices() {
    let grid = grid();
    let field = field();
    let left = height_tile(&field, &grid, 0);
    let right = height_tile(&field, &grid, 1);
    // Tile 0 covers cells 0–1 and carries cell column 2 as its extra vertex column.
    assert_eq!(left.len(), 3 * 3);
    for row in 0..3 {
        assert_eq!(left[row * 3 + 2], right[row * 3], "row {row}");
    }
    let below = height_tile(&field, &grid, 3);
    assert_eq!(&left[6..9], &below[0..3]);
}

#[test]
fn the_map_edge_repeats_its_last_cell_and_heights_are_centimetres() {
    let grid = grid();
    let tile = height_tile(&grid_field_last(), &grid, 5);
    // Tile 5: cell column 4 only, cell rows 2–3; the extra column and row clamp to the edge.
    assert_eq!(tile.len(), 2 * 3);
    assert_eq!(tile[0], tile[1]);
    assert_eq!(tile[4], tile[5]);
    assert_eq!(tile[2], 140);
}

fn grid_field_last() -> HeightField {
    let mut field = field();
    field.heights[3 * 5 + 4] = 1.4;
    field
}

#[test]
fn smoothing_averages_the_clipped_three_by_three_neighbourhood() {
    let field = HeightField { columns: 3, rows: 1, heights: vec![0.0, 3.0, 6.0] };
    assert_eq!(smooth(&field, 1).heights, vec![1.5, 3.0, 4.5]);
    assert_eq!(smooth(&field, 0).heights, field.heights);
}
