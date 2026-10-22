//! The uniform grid that replaces "check against everything placed so far" scans: a query must
//! return every box that could touch the one asked about (touching edges included), so pruning
//! with it never changes an exact overlap test's answer.

use desire_atlas::spatial::{Bounds, SpatialGrid};

fn square(x: f64, z: f64, side: f64) -> Bounds {
    Bounds {
        min: [x, z],
        max: [x + side, z + side],
    }
}

fn near(grid: &SpatialGrid, bounds: &Bounds) -> Vec<usize> {
    let mut ids: Vec<usize> = grid.near(bounds).collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

#[test]
fn a_query_finds_overlapping_and_touching_boxes_but_not_far_ones() {
    let mut grid = SpatialGrid::new(10.0);
    grid.insert(&square(0.0, 0.0, 5.0), 0);
    grid.insert(&square(5.0, 0.0, 5.0), 1);
    grid.insert(&square(100.0, 100.0, 5.0), 2);
    grid.insert(&square(-30.0, -30.0, 4.0), 3);
    assert_eq!(near(&grid, &square(2.0, 2.0, 1.0)), vec![0, 1]);
    assert_eq!(
        near(&grid, &square(10.0, 0.0, 1.0)),
        vec![1],
        "touching box 1 at x = 10"
    );
    assert_eq!(
        near(&grid, &square(-27.0, -27.0, 1.0)),
        vec![3],
        "negative cells"
    );
}

#[test]
fn a_box_wider_than_a_cell_is_found_from_any_cell_it_covers() {
    let mut grid = SpatialGrid::new(4.0);
    grid.insert(&square(0.0, 0.0, 30.0), 7);
    assert_eq!(near(&grid, &square(25.0, 25.0, 1.0)), vec![7]);
    assert_eq!(near(&grid, &square(40.0, 40.0, 1.0)), Vec::<usize>::new());
}

#[test]
fn every_pair_the_grid_skips_is_disjoint() {
    // Brute force over a jittered field of boxes: no pair whose boxes meet may be pruned.
    let boxes: Vec<Bounds> = (0..400)
        .map(|i| {
            let (x, z) = ((i * 37 % 211) as f64 * 0.73, (i * 91 % 197) as f64 * 0.61);
            square(x, z, 1.0 + (i % 7) as f64)
        })
        .collect();
    let mut grid = SpatialGrid::new(6.0);
    for (id, bounds) in boxes.iter().enumerate() {
        grid.insert(bounds, id);
    }
    for (id, bounds) in boxes.iter().enumerate() {
        let found = near(&grid, bounds);
        for (other, candidate) in boxes.iter().enumerate() {
            let meet = (0..2).all(|axis| {
                bounds.min[axis] <= candidate.max[axis] && candidate.min[axis] <= bounds.max[axis]
            });
            assert!(
                !meet || found.contains(&other),
                "{id} meets {other} but was pruned"
            );
        }
    }
}
