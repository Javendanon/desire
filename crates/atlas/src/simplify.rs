//! Douglas–Peucker simplification for open polylines and closed rings, ported from
//! `tools/assets/src/raster/simplify.ts` (distances with V8's `hypot`, see `js`).

use crate::js;
use crate::vectors::PixelPoint;

/// Distance from `point` to the line through the chord's ends.
fn distance_to_chord(point: PixelPoint, chord: [PixelPoint; 2]) -> f64 {
    let ([px, py], [[ax, ay], [bx, by]]) = (point, chord);
    let (dx, dy) = (bx - ax, by - ay);
    let length = js::hypot(&[dx, dy]);
    if length == 0.0 {
        return js::hypot(&[px - ax, py - ay]);
    }
    (dy * px - dx * py + bx * ay - by * ax).abs() / length
}

/// The interior point farthest from the chord between the ends, with its distance. Ties keep
/// the first, as the TypeScript loop does.
fn farthest_from_chord(points: &[PixelPoint]) -> (usize, f64) {
    let (first, last) = (points[0], points[points.len() - 1]);
    let mut farthest = (0, 0.0);
    for (index, &point) in points.iter().enumerate().take(points.len() - 1).skip(1) {
        let distance = distance_to_chord(point, [first, last]);
        if distance > farthest.1 {
            farthest = (index, distance);
        }
    }
    farthest
}

/// Keeps both ends and every point farther than `tolerance` from its chord. O(n log n) typical.
pub fn simplify_line(points: &[PixelPoint], tolerance: f64) -> Vec<PixelPoint> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let (split, distance) = farthest_from_chord(points);
    if distance <= tolerance {
        return vec![points[0], points[points.len() - 1]];
    }
    let mut head = simplify_line(&points[..=split], tolerance);
    head.pop();
    head.extend(simplify_line(&points[split..], tolerance));
    head
}

/// Index of the point farthest from the ring's first point (the first such, after index 0).
fn farthest_from_start(ring: &[PixelPoint]) -> usize {
    let from_start = |[x, y]: PixelPoint| js::hypot(&[x - ring[0][0], y - ring[0][1]]);
    let mut split = 1;
    for (index, &point) in ring.iter().enumerate().skip(2) {
        if from_start(point) > from_start(ring[split]) {
            split = index;
        }
    }
    split
}

/// Simplifies a closed ring (first point not repeated), split at the point farthest from start.
pub fn simplify_ring(ring: &[PixelPoint], tolerance: f64) -> Vec<PixelPoint> {
    if ring.len() <= 3 {
        return ring.to_vec();
    }
    let split = farthest_from_start(ring);
    let mut first = simplify_line(&ring[..=split], tolerance);
    let closing: Vec<PixelPoint> = ring[split..].iter().chain(&ring[..1]).copied().collect();
    let mut second = simplify_line(&closing, tolerance);
    first.pop();
    second.pop();
    first.extend(second);
    first
}
