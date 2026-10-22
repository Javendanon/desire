//! Row-major raster operations on masks and class grids, ported from
//! `tools/assets/src/raster/raster-ops.ts` with the same results (parity tests). Every operation
//! reads its input in as few passes as it needs and allocates only its output: no inversions or
//! transposes in between.

use rayon::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size {
    pub width: usize,
    pub height: usize,
}

impl Size {
    pub fn pixels(self) -> usize {
        self.width * self.height
    }
}

/// What a square-window reach marks: pixels within the radius of a seed pixel get `hit`, the
/// rest `miss`. Dilation seeds on set pixels and marks 1. Erosion is the same pass with unset
/// pixels as seeds and the marks swapped, so it needs no inversion before or after.
#[derive(Clone, Copy)]
struct Reach {
    radius: usize,
    seed: fn(u8) -> bool,
    hit: u8,
    miss: u8,
}

/// Square dilation by `radius` pixels. O(pixels) whatever the radius.
pub fn dilate(mask: &[u8], size: Size, radius: usize) -> Vec<u8> {
    let rule = Reach {
        radius,
        seed: |value| value != 0,
        hit: 1,
        miss: 0,
    };
    reach(mask, size, rule)
}

/// Square erosion: a pixel survives when its whole window is set. O(pixels).
pub fn erode(mask: &[u8], size: Size, radius: usize) -> Vec<u8> {
    let rule = Reach {
        radius,
        seed: |value| value == 0,
        hit: 0,
        miss: 1,
    };
    reach(mask, size, rule)
}

/// Columns per parallel task of the column pass: wide enough that a task streams whole cache
/// lines, narrow enough to give every core several strips of a 6,000-pixel-wide map.
const STRIP_COLUMNS: usize = 256;

/// Separable square reach: along rows, then along columns, both in parallel. Two passes over
/// the image, whatever the radius.
fn reach(mask: &[u8], size: Size, rule: Reach) -> Vec<u8> {
    let mut rows = vec![0; mask.len()];
    rows.par_chunks_mut(size.width)
        .zip(mask.par_chunks(size.width))
        .for_each(|(out, row)| reach_row(row, out, rule));
    let mut out = vec![rule.miss; rows.len()];
    strips(&mut out, size)
        .into_par_iter()
        .enumerate()
        .for_each(|(strip, cells)| {
            let first = strip * STRIP_COLUMNS;
            ColumnPass::new(&rows, size.width, first, rule).run(cells);
        });
    out
}

/// The output cut into vertical strips: for each strip, its slice of every row, top to bottom.
/// The slices are disjoint, so strips can be written in parallel without copying.
fn strips(out: &mut [u8], size: Size) -> Vec<Vec<&mut [u8]>> {
    let count = size.width.div_ceil(STRIP_COLUMNS);
    let mut strips: Vec<Vec<&mut [u8]>> = (0..count).map(|_| Vec::new()).collect();
    for row in out.chunks_mut(size.width) {
        for (strip, cells) in row.chunks_mut(STRIP_COLUMNS).enumerate() {
            strips[strip].push(cells);
        }
    }
    strips
}

/// Marks 1 where a seed lies within the radius on the same row: one sweep each way, each
/// remembering the last seed it passed.
fn reach_row(row: &[u8], out: &mut [u8], rule: Reach) {
    let mut last = None;
    for (x, &value) in row.iter().enumerate() {
        last = if (rule.seed)(value) { Some(x) } else { last };
        out[x] = u8::from(last.is_some_and(|seed| x - seed <= rule.radius));
    }
    last = None;
    for (x, &value) in row.iter().enumerate().rev() {
        last = if (rule.seed)(value) { Some(x) } else { last };
        out[x] |= u8::from(last.is_some_and(|seed| seed - x <= rule.radius));
    }
}

/// The column half of a reach over one strip: its columns advance together, row by row.
/// `last` holds, per column, the last row whose row pass was reached.
struct ColumnPass<'a> {
    rows: &'a [u8],
    width: usize,
    first: usize,
    last: Vec<Option<usize>>,
    rule: Reach,
}

impl<'a> ColumnPass<'a> {
    fn new(rows: &'a [u8], width: usize, first: usize, rule: Reach) -> Self {
        let columns = STRIP_COLUMNS.min(width - first);
        ColumnPass {
            rows,
            width,
            first,
            last: vec![None; columns],
            rule,
        }
    }

    /// Down the strip, then back up, marking every cell within the radius of a reached row.
    fn run(mut self, mut cells: Vec<&mut [u8]>) {
        for (y, row) in cells.iter_mut().enumerate() {
            self.visit(y, row);
        }
        self.last.fill(None);
        for (y, row) in cells.iter_mut().enumerate().rev() {
            self.visit(y, row);
        }
    }

    fn visit(&mut self, y: usize, row: &mut [u8]) {
        let reached = &self.rows[y * self.width + self.first..][..row.len()];
        for ((cell, seen), &value) in row.iter_mut().zip(&mut self.last).zip(reached) {
            *seen = if value == 1 { Some(y) } else { *seen };
            if seen.is_some_and(|seed| seed.abs_diff(y) <= self.rule.radius) {
                *cell = self.rule.hit;
            }
        }
    }
}

/// `1` where the mask is `0` and the other way round.
pub fn invert(mask: &[u8]) -> Vec<u8> {
    mask.par_iter().map(|&value| u8::from(value == 0)).collect()
}

/// The class histogram of one output row's window, sliding along the row.
struct SlidingWindow<'a> {
    classes: &'a [u8],
    width: usize,
    rows: std::ops::RangeInclusive<usize>,
    counts: Vec<i32>,
}

impl SlidingWindow<'_> {
    fn add_column(&mut self, x: usize) {
        for row in self.rows.clone() {
            self.counts[usize::from(self.classes[row * self.width + x])] += 1;
        }
    }

    fn drop_column(&mut self, x: usize) {
        for row in self.rows.clone() {
            self.counts[usize::from(self.classes[row * self.width + x])] -= 1;
        }
    }

    /// The class with most votes. Ties go to the lower id, and the centre wins unless beaten.
    fn winner(&self, centre: u8) -> u8 {
        let mut best = usize::from(centre);
        for (value, &count) in self.counts.iter().enumerate() {
            if count > self.counts[best] || (count == self.counts[best] && value < best) {
                best = value;
            }
        }
        best as u8
    }
}

/// One majority pass: the grid, its window radius and how many class ids it holds.
struct Majority<'a> {
    classes: &'a [u8],
    size: Size,
    radius: usize,
    values: usize,
}

impl Majority<'_> {
    /// Output row `y`: the window enters at the right and leaves at the left. O(width · r).
    fn row(&self, y: usize) -> Vec<u8> {
        let (size, radius) = (self.size, self.radius);
        let mut window = SlidingWindow {
            classes: self.classes,
            width: size.width,
            rows: y.saturating_sub(radius)..=(y + radius).min(size.height - 1),
            counts: vec![0; self.values],
        };
        (0..=radius.min(size.width - 1)).for_each(|x| window.add_column(x));
        (0..size.width)
            .map(|x| {
                if x > 0 && x + radius < size.width {
                    window.add_column(x + radius);
                }
                if x > radius {
                    window.drop_column(x - radius - 1);
                }
                window.winner(self.classes[y * size.width + x])
            })
            .collect()
    }
}

/// Majority filter over a square window. Ties go to the lower class id. O(pixels · r).
pub fn majority(classes: &[u8], size: Size, radius: usize) -> Vec<u8> {
    if radius == 0 {
        return classes.to_vec();
    }
    let largest = classes.par_iter().copied().max().unwrap_or(0);
    let pass = Majority {
        classes,
        size,
        radius,
        values: usize::from(largest) + 1,
    };
    (0..size.height)
        .into_par_iter()
        .flat_map_iter(|y| pass.row(y))
        .collect()
}

pub struct Components {
    /// Component of each pixel, numbered in scan order; `-1` on background.
    pub labels: Vec<i32>,
    pub sizes: Vec<usize>,
}

/// Flood fill state shared by every component: one stack, reused.
struct Labeller<'a> {
    mask: &'a [u8],
    size: Size,
    labels: Vec<i32>,
    stack: Vec<usize>,
}

impl Labeller<'_> {
    fn is_unlabelled(&self, index: usize) -> bool {
        self.mask[index] != 0 && self.labels[index] < 0
    }

    /// Labels the component holding `start` with `id`. Returns its pixel count.
    fn fill(&mut self, start: usize, id: i32) -> usize {
        // The hot loop works on locals: a slice of the labels and the stack moved out of `self`.
        // Through `self`, each push could move the vectors, so their pointers were reloaded on
        // every step: 13 % slower on the full map, measured against the inline version.
        let (mask, size) = (self.mask, self.size);
        let mut stack = std::mem::take(&mut self.stack);
        let labels = self.labels.as_mut_slice();
        labels[start] = id;
        stack.push(start);
        let mut count = 0;
        while let Some(index) = stack.pop() {
            count += 1;
            for next in neighbours4(index, size) {
                if mask[next] != 0 && labels[next] < 0 {
                    labels[next] = id;
                    stack.push(next);
                }
            }
        }
        self.stack = stack;
        count
    }
}

/// 4-connected components of non-zero pixels, in scan order. O(pixels).
pub fn components(mask: &[u8], size: Size) -> Components {
    let mut labeller = Labeller {
        mask,
        size,
        labels: vec![-1; mask.len()],
        stack: Vec::new(),
    };
    let mut sizes = Vec::new();
    for start in 0..mask.len() {
        if labeller.is_unlabelled(start) {
            let id = i32::try_from(sizes.len()).expect("fewer than 2^31 components");
            sizes.push(labeller.fill(start, id));
        }
    }
    Components {
        labels: labeller.labels,
        sizes,
    }
}

/// The in-image 4-neighbours of `index`, in the order left, right, up, down.
pub fn neighbours4(index: usize, size: Size) -> impl Iterator<Item = usize> {
    let x = index % size.width;
    let left = (x > 0).then(|| index - 1);
    let right = (x + 1 < size.width).then(|| index + 1);
    let up = (index >= size.width).then(|| index - size.width);
    let down = (index + size.width < size.pixels()).then(|| index + size.width);
    [left, right, up, down].into_iter().flatten()
}
