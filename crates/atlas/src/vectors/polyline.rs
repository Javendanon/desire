//! Rasterises polylines of a given pixel width into a mask.

use serde::Deserialize;

use super::PixelPoint;
use crate::raster_ops::Size;

#[derive(Clone, Debug, Deserialize)]
pub struct Polyline {
    pub points: Vec<PixelPoint>,
    /// Full width in pixels. Pixel centres within half of it are painted.
    pub width: f64,
}

/// One segment's painting: its ends, half its width, and the target mask.
struct Segment {
    from: PixelPoint,
    to: PixelPoint,
    half: f64,
}

impl Segment {
    /// Pixel range along one axis that the segment's padded bounding box covers (empty when
    /// the box lies outside the image).
    fn span(&self, axis: usize, cells: usize) -> std::ops::Range<usize> {
        let low = (self.from[axis].min(self.to[axis]) - self.half)
            .floor()
            .max(0.0);
        let high = (self.from[axis].max(self.to[axis]) + self.half).ceil();
        let end = (high + 1.0).min(cells as f64).max(low);
        low as usize..end as usize
    }

    /// Whether the pixel centre lies within half the width of the segment.
    fn covers(&self, x: usize, y: usize) -> bool {
        let [ax, ay] = self.from;
        let (dx, dy) = (self.to[0] - ax, self.to[1] - ay);
        let length2 = match dx * dx + dy * dy {
            0.0 => 1.0,
            length2 => length2,
        };
        let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
        let t = (((cx - ax) * dx + (cy - ay) * dy) / length2).clamp(0.0, 1.0);
        let (ex, ey) = (cx - ax - t * dx, cy - ay - t * dy);
        ex * ex + ey * ey <= self.half * self.half
    }

    fn paint(&self, mask: &mut [u8], size: Size) {
        for y in self.span(1, size.height) {
            for x in self.span(0, size.width) {
                if self.covers(x, y) {
                    mask[y * size.width + x] = 1;
                }
            }
        }
    }
}

/// Marks pixels whose centre lies within half the width of any segment. O(Σ segment area).
pub fn paint_polylines(mask: &mut [u8], size: Size, lines: &[Polyline]) {
    for line in lines {
        for pair in line.points.windows(2) {
            let segment = Segment {
                from: pair[0],
                to: pair[1],
                half: line.width / 2.0,
            };
            segment.paint(mask, size);
        }
    }
}
