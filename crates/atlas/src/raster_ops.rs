//! Row-major raster operations on masks and class grids, ported from
//! `tools/assets/src/raster/raster-ops.ts` with the same results (parity tests). Rows are
//! independent in every pass but the component flood fill, so those passes run in parallel.

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

/// `1` where the mask is `0` and the other way round.
pub fn invert(mask: &[u8]) -> Vec<u8> {
    mask.par_iter().map(|&value| u8::from(value == 0)).collect()
}

/// Marks each pixel within `radius` of a set pixel on its own row: one pass each way.
fn sweep_row(mask: &[u8], out: &mut [u8], radius: usize) {
    let mut seen: Option<usize> = None;
    for x in 0..mask.len() {
        if mask[x] != 0 {
            seen = Some(x);
        }
        if seen.is_some_and(|at| x - at <= radius) {
            out[x] = 1;
        }
    }
    seen = None;
    for x in (0..mask.len()).rev() {
        if mask[x] != 0 {
            seen = Some(x);
        }
        if seen.is_some_and(|at| at - x <= radius) {
            out[x] = 1;
        }
    }
}

/// Square dilation by `radius` pixels, separable: rows, then columns (by transposing, so the
/// column pass is a row pass too). O(pixels) whatever the radius.
pub fn dilate(mask: &[u8], size: Size, radius: usize) -> Vec<u8> {
    let mut rows = vec![0; mask.len()];
    rows.par_chunks_mut(size.width)
        .zip(mask.par_chunks(size.width))
        .for_each(|(out, row)| sweep_row(row, out, radius));
    let columns = transpose(&rows, size);
    let mut grown = vec![0; mask.len()];
    grown
        .par_chunks_mut(size.height)
        .zip(columns.par_chunks(size.height))
        .for_each(|(out, column)| sweep_row(column, out, radius));
    transpose(
        &grown,
        Size {
            width: size.height,
            height: size.width,
        },
    )
}

/// Square erosion: a pixel survives when its whole window is set. Complement of dilation.
pub fn erode(mask: &[u8], size: Size, radius: usize) -> Vec<u8> {
    invert(&dilate(&invert(mask), size, radius))
}

/// Row-major `size` grid to row-major `height × width` grid.
fn transpose(grid: &[u8], size: Size) -> Vec<u8> {
    let mut out = vec![0; grid.len()];
    out.par_chunks_mut(size.height)
        .enumerate()
        .for_each(|(x, column)| {
            for (y, cell) in column.iter_mut().enumerate() {
                *cell = grid[y * size.width + x];
            }
        });
    out
}

/// The class with most votes. Ties go to the lower id, and the centre wins unless beaten.
fn winner(counts: &[i32], centre: u8) -> u8 {
    let mut best = usize::from(centre);
    for (value, &count) in counts.iter().enumerate() {
        if count > counts[best] || (count == counts[best] && value < best) {
            best = value;
        }
    }
    best as u8
}

/// The rows of one output row's window, over a class grid.
struct Window<'a> {
    classes: &'a [u8],
    width: usize,
    from: usize,
    to: usize,
}

impl Window<'_> {
    /// Adds `delta` to the histogram for every pixel of column `x` inside the window.
    fn count_column(&self, counts: &mut [i32], x: usize, delta: i32) {
        for row in self.from..=self.to {
            counts[usize::from(self.classes[row * self.width + x])] += delta;
        }
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
    /// Output row `y`: a histogram slides along it, adding the entering column and dropping
    /// the leaving one.
    fn row(&self, y: usize) -> Vec<u8> {
        let (size, radius) = (self.size, self.radius);
        let window = Window {
            classes: self.classes,
            width: size.width,
            from: y.saturating_sub(radius),
            to: (y + radius).min(size.height - 1),
        };
        let mut counts = vec![0i32; self.values];
        for x in 0..=radius.min(size.width - 1) {
            window.count_column(&mut counts, x, 1);
        }
        (0..size.width)
            .map(|x| {
                if x > 0 && x + radius < size.width {
                    window.count_column(&mut counts, x + radius, 1);
                }
                if x > radius {
                    window.count_column(&mut counts, x - radius - 1, -1);
                }
                winner(&counts, self.classes[y * size.width + x])
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

/// 4-connected components of non-zero pixels, in scan order. O(pixels).
pub fn components(mask: &[u8], size: Size) -> Components {
    let mut labels = vec![-1i32; mask.len()];
    let mut sizes = Vec::new();
    let mut stack = Vec::new();
    for start in 0..mask.len() {
        if mask[start] == 0 || labels[start] >= 0 {
            continue;
        }
        let id = i32::try_from(sizes.len()).expect("fewer than 2^31 components");
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
        sizes.push(count);
    }
    Components { labels, sizes }
}

/// The in-image 4-neighbours of `index`, in the order left, right, up, down.
fn neighbours4(index: usize, size: Size) -> impl Iterator<Item = usize> {
    let x = index % size.width;
    let left = (x > 0).then(|| index - 1);
    let right = (x + 1 < size.width).then(|| index + 1);
    let up = (index >= size.width).then(|| index - size.width);
    let down = (index + size.width < size.pixels()).then(|| index + size.width);
    [left, right, up, down].into_iter().flatten()
}
