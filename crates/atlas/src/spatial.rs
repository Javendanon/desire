//! A uniform grid over the plane for "which placed boxes could touch this one" queries. It turns
//! the "check against everything placed so far" scans in lot placement and ship spacing from
//! O(n²) into O(n · neighbours). A query returns every box whose cells it shares, touching edges
//! included, so pruning with it never changes an exact overlap test's answer.

use std::collections::HashMap;

/// An axis-aligned box in the plane: `[x, z]` corners, metres or pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min: [f64; 2],
    pub max: [f64; 2],
}

impl Bounds {
    /// The box around a set of points.
    pub fn around(points: impl IntoIterator<Item = [f64; 2]>) -> Self {
        points.into_iter().fold(
            Bounds {
                min: [f64::INFINITY; 2],
                max: [f64::NEG_INFINITY; 2],
            },
            |bounds, [x, z]| Bounds {
                min: [bounds.min[0].min(x), bounds.min[1].min(z)],
                max: [bounds.max[0].max(x), bounds.max[1].max(z)],
            },
        )
    }
}

pub struct SpatialGrid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl SpatialGrid {
    /// A grid of square cells `cell` wide. Near the size of the boxes it holds is best.
    pub fn new(cell: f64) -> Self {
        SpatialGrid {
            cell,
            cells: HashMap::new(),
        }
    }

    /// The cells a box covers, its edges included.
    fn span(&self, bounds: &Bounds) -> impl Iterator<Item = (i64, i64)> + use<> {
        let index = |value: f64| (value / self.cell).floor() as i64;
        let (columns, rows) = (
            index(bounds.min[0])..=index(bounds.max[0]),
            index(bounds.min[1])..=index(bounds.max[1]),
        );
        rows.flat_map(move |row| columns.clone().map(move |column| (column, row)))
    }

    pub fn insert(&mut self, bounds: &Bounds, id: usize) {
        for key in self.span(bounds) {
            self.cells.entry(key).or_default().push(id);
        }
    }

    /// Ids of the boxes sharing a cell with `bounds`. One that spans several cells may repeat.
    pub fn near(&self, bounds: &Bounds) -> impl Iterator<Item = usize> + '_ {
        self.span(bounds)
            .filter_map(|key| self.cells.get(&key))
            .flatten()
            .copied()
    }
}
