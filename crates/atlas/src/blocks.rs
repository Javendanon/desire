//! City blocks: the land between streets, traced into polygons, ported from
//! `tools/assets/src/raster/blocks.ts`. Boundaries follow pixel edges between a component and
//! its background, always with the component on the same hand, so outer rings and holes come
//! out with opposite winding. Where two blocks touch only at a corner, the label picks the path.
//!
//! The order of blocks numbers the lots and so the house ids. Edges are therefore visited exactly
//! as the TypeScript `Map` does (start vertices in first-seen order, edges in insertion order),
//! here through a stable sort by start vertex instead of a hash map over every grid vertex.

use std::collections::HashMap;

use rayon::prelude::*;
use serde::Deserialize;

use crate::raster_ops::{Size, components};
use crate::simplify::simplify_ring;
use crate::surface::Surface;
use crate::vectors::PixelPoint;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceOptions {
    pub min_area_px: usize,
    pub tolerance_px: f64,
    /// Holes smaller than this are classification noise and join their block.
    #[serde(default)]
    pub min_hole_area_px: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub outer: Vec<PixelPoint>,
    pub holes: Vec<Vec<PixelPoint>>,
    pub area_px: usize,
}

/// Urban pixels that are not street, water or pier: the land blocks are made of. O(pixels).
pub fn block_mask(classes: &[u8], urban: &[u8]) -> Vec<u8> {
    let not_block = [Surface::Street, Surface::Water, Surface::Pier].map(|s| s as u8);
    classes
        .par_iter()
        .zip(urban)
        .map(|(class, &inside)| u8::from(inside == 1 && !not_block.contains(class)))
        .collect()
}

/// One side of a pixel: the neighbour that makes it a boundary, and the edge's corners relative
/// to the pixel's top-left, ordered to keep the block on the same hand. Index = direction
/// (right, down, left, up).
struct Side {
    neighbour: [isize; 2],
    from: [usize; 2],
    to: [usize; 2],
}

const SIDES: [Side; 4] = [
    Side {
        neighbour: [0, -1],
        from: [0, 0],
        to: [1, 0],
    },
    Side {
        neighbour: [1, 0],
        from: [1, 0],
        to: [1, 1],
    },
    Side {
        neighbour: [0, 1],
        from: [1, 1],
        to: [0, 1],
    },
    Side {
        neighbour: [-1, 0],
        from: [0, 1],
        to: [0, 0],
    },
];
/// At a corner shared by one block, prefer turning right, then straight, then left.
const TURN_PREFERENCE: [usize; 3] = [1, 0, 3];

#[derive(Clone, Copy)]
struct Edge {
    from: u32,
    to: u32,
    label: i32,
    direction: usize,
}

/// Boundary edges of every labelled pixel, grouped by start vertex in a stable order.
struct Boundary {
    edges: Vec<Edge>,
    used: Vec<bool>,
    /// Edge indices sorted by start vertex, insertion order kept within a vertex.
    by_from: Vec<u32>,
    width: usize,
}

impl Boundary {
    /// O(pixels + perimeter · log perimeter).
    fn trace(labels: &[i32], size: Size) -> Self {
        let edges = Labels { labels, size }.edges();
        let mut by_from: Vec<u32> = (0..edges.len() as u32).collect();
        by_from.sort_by_key(|&edge| edges[edge as usize].from);
        let used = vec![false; edges.len()];
        Boundary {
            edges,
            used,
            by_from,
            width: size.width,
        }
    }

    /// Edges starting at `vertex`, in insertion order.
    fn outgoing(&self, vertex: u32) -> &[u32] {
        let start = self
            .by_from
            .partition_point(|&e| self.edges[e as usize].from < vertex);
        let end = self
            .by_from
            .partition_point(|&e| self.edges[e as usize].from <= vertex);
        &self.by_from[start..end]
    }

    /// The unused edge of the same label that continues `current`, by turn preference.
    fn next(&self, current: usize) -> Option<usize> {
        let edge = self.edges[current];
        let candidates: Vec<usize> = self
            .outgoing(edge.to)
            .iter()
            .map(|&e| e as usize)
            .filter(|&e| !self.used[e] && self.edges[e].label == edge.label)
            .collect();
        let turned = TURN_PREFERENCE.iter().find_map(|turn| {
            let wanted = (edge.direction + turn) % SIDES.len();
            candidates
                .iter()
                .copied()
                .find(|&e| self.edges[e].direction == wanted)
        });
        turned.or(candidates.first().copied())
    }

    /// Follows unused edges from `start` until the loop closes, as pixel-corner points.
    fn follow(&mut self, start: usize) -> Vec<PixelPoint> {
        let mut ring = Vec::new();
        let mut edge = Some(start);
        while let Some(current) = edge.filter(|&e| !self.used[e]) {
            self.used[current] = true;
            let vertex = self.edges[current].from as usize;
            ring.push([
                (vertex % (self.width + 1)) as f64,
                (vertex / (self.width + 1)) as f64,
            ]);
            edge = self.next(current);
        }
        ring
    }

    /// Every loop, grouped by label in first-seen order.
    fn loops(mut self) -> Vec<(i32, Vec<Vec<PixelPoint>>)> {
        let mut loops: Vec<(i32, Vec<Vec<PixelPoint>>)> = Vec::new();
        let mut slot: HashMap<i32, usize> = HashMap::new();
        for first in 0..self.edges.len() {
            let group = self.outgoing(self.edges[first].from).to_vec();
            if group[0] as usize != first {
                continue;
            }
            for edge in group.into_iter().map(|e| e as usize) {
                if self.used[edge] {
                    continue;
                }
                let label = self.edges[edge].label;
                let ring = self.follow(edge);
                let index = *slot.entry(label).or_insert_with(|| {
                    loops.push((label, Vec::new()));
                    loops.len() - 1
                });
                loops[index].1.push(ring);
            }
        }
        loops
    }
}

/// Component labels over the image, `-1` on background.
struct Labels<'a> {
    labels: &'a [i32],
    size: Size,
}

impl Labels<'_> {
    /// The boundary edges of every labelled pixel, in pixel order and side order.
    fn edges(&self) -> Vec<Edge> {
        let width = self.size.width;
        let mut edges = Vec::new();
        for (index, &label) in self.labels.iter().enumerate().filter(|&(_, &l)| l >= 0) {
            let (x, y) = (index % width, index / width);
            let vertex = |[dx, dy]: [usize; 2]| ((y + dy) * (width + 1) + x + dx) as u32;
            for (direction, side) in SIDES.iter().enumerate() {
                if self.is_background([x, y], side.neighbour) {
                    let (from, to) = (vertex(side.from), vertex(side.to));
                    edges.push(Edge {
                        from,
                        to,
                        label,
                        direction,
                    });
                }
            }
        }
        edges
    }

    /// Whether the neighbour at `offset` from `pixel` is background or off the image.
    fn is_background(&self, pixel: [usize; 2], offset: [isize; 2]) -> bool {
        let x = pixel[0]
            .checked_add_signed(offset[0])
            .filter(|&x| x < self.size.width);
        let y = pixel[1]
            .checked_add_signed(offset[1])
            .filter(|&y| y < self.size.height);
        match (x, y) {
            (Some(x), Some(y)) => self.labels[y * self.size.width + x] < 0,
            _ => true,
        }
    }
}

fn signed_area(ring: &[PixelPoint]) -> f64 {
    let next = ring.iter().cycle().skip(1);
    ring.iter()
        .zip(next)
        .fold(0.0, |sum, (&[x, y], &[nx, ny])| sum + x * ny - nx * y)
        / 2.0
}

/// The largest ring is the outline. The others, if large enough, are holes.
fn to_block(mut rings: Vec<Vec<PixelPoint>>, area_px: usize, options: &TraceOptions) -> Block {
    rings.sort_by(|a, b| signed_area(b).abs().total_cmp(&signed_area(a).abs()));
    let tolerance = options.tolerance_px;
    let holes = rings[1..]
        .iter()
        .filter(|ring| signed_area(ring).abs() >= options.min_hole_area_px)
        .map(|ring| simplify_ring(ring, tolerance))
        .collect();
    Block {
        outer: simplify_ring(&rings[0], tolerance),
        holes,
        area_px,
    }
}

/// Traces each 4-connected component of `mask` large enough into a block.
/// O(pixels + perimeter · log perimeter).
pub fn trace_blocks(mask: &[u8], size: Size, options: &TraceOptions) -> Vec<Block> {
    let found = components(mask, size);
    let kept: Vec<i32> = found
        .labels
        .par_iter()
        .map(|&label| {
            let large = label >= 0 && found.sizes[label as usize] >= options.min_area_px;
            if large { label } else { -1 }
        })
        .collect();
    Boundary::trace(&kept, size)
        .loops()
        .into_iter()
        .map(|(label, rings)| to_block(rings, found.sizes[label as usize], options))
        .collect()
}
