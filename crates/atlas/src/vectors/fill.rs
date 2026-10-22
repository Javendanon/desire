//! Scanline fill of pixel-space polygons into a mask, even-odd rule. Rows are independent, so
//! they fill in parallel.

use rayon::prelude::*;

use super::PixelPoint;
use crate::raster_ops::Size;

/// x positions where the horizontal line `y` crosses the ring's edges.
fn crossings(ring: &[PixelPoint], y: f64, xs: &mut Vec<f64>) {
    let edges = ring.iter().zip(ring.iter().cycle().skip(1));
    for (&[ax, ay], &[bx, by]) in edges {
        if (ay <= y && by > y) || (by <= y && ay > y) {
            xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
    }
}

/// Sets the pixels between each pair of sorted crossings whose centres lie inside.
fn fill_row(row: &mut [u8], xs: &mut [f64]) {
    xs.sort_by(f64::total_cmp);
    let last = (row.len() - 1) as f64;
    for pair in xs.chunks_exact(2) {
        let from = (pair[0] - 0.5).ceil().max(0.0);
        let to = (pair[1] - 0.5).floor().min(last);
        if to >= from {
            row[from as usize..=to as usize].fill(1);
        }
    }
}

/// Sets every pixel whose centre is inside the union of rings. O(height · edges + area).
pub fn fill_polygons(mask: &mut [u8], size: Size, rings: &[Vec<PixelPoint>]) {
    mask.par_chunks_mut(size.width)
        .enumerate()
        .for_each(|(row, cells)| {
            let mut xs = Vec::new();
            let y = row as f64 + 0.5;
            rings.iter().for_each(|ring| crossings(ring, y, &mut xs));
            if xs.len() > 1 {
                fill_row(cells, &mut xs);
            }
        });
}
