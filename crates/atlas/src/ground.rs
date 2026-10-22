//! The ground under the city: a stylised albedo painted from the surface classes (palette, value
//! noise, shallows and foam along the shore) and a coarse height field. Ported from
//! `tools/assets/src/slice.ts` with the same results. It never copies the source artwork's
//! pixels. Rows and cells are independent, so both are computed in parallel.

use rayon::prelude::*;

use crate::js;
use crate::raster_ops::Size;
use crate::surface::Surface;

/// What the ground is painted from, and how coarse its height field is.
pub struct GroundSpec<'a> {
    pub classes: &'a [u8],
    pub size: Size,
    /// Source pixels per height-field cell.
    pub cell_px: usize,
    pub seed: u32,
}

/// Heights in metres above the water plane.
pub const HEIGHT_LAND_M: f32 = 1.0;
pub const HEIGHT_PIER_M: f32 = 0.8;
pub const HEIGHT_SEABED_M: f32 = -2.5;

type Rgb = [f64; 3];

/// Ground palette by surface class (ids 0–7): muted stone and earth. The golden-hour sun warms
/// everything already, so the albedo stays close to neutral.
const ALBEDO: [Rgb; 8] = [
    [100.0, 92.0, 80.0],   // Ground
    [22.0, 50.0, 58.0],    // Water (deep)
    [88.0, 80.0, 70.0],    // Roof
    [118.0, 114.0, 106.0], // Street
    [88.0, 80.0, 70.0],    // Outline
    [88.0, 80.0, 70.0],    // RedRoof
    [92.0, 82.0, 70.0],    // Pier
    [86.0, 104.0, 66.0],   // Garden
];
const SHALLOW: Rgb = [62.0, 120.0, 118.0];
const FOAM: Rgb = [186.0, 204.0, 206.0];
/// Shallows fade over this many source pixels (about 19 m at z18).
const SHALLOW_PX: f64 = 40.0;
const FOAM_PX: u16 = 2;
const UNREACHED: u16 = 0xffff;
/// ± variation of the value noise on every channel.
const NOISE_AMPLITUDE: f64 = 14.0;
const NOISE_CELL_PX: f64 = 6.0;

/// The TypeScript lattice hash: `Math.imul` and `>>>` on the low 32 bits.
fn hash(x: i64, y: i64, seed: u32) -> f64 {
    let (x, y) = (x as i32 as u32, y as i32 as u32);
    let mut value = x.wrapping_mul(374_761_393) ^ y.wrapping_mul(668_265_263);
    value ^= seed.wrapping_mul(2_246_822_519);
    value = (value ^ (value >> 13)).wrapping_mul(1_274_126_177);
    f64::from(value ^ (value >> 16)) / 4_294_967_296.0
}

/// Smooth value noise in [0, 1) on a lattice of `NOISE_CELL_PX` pixels.
fn value_noise(x: f64, y: f64, seed: u32) -> f64 {
    let (gx, gy) = ((x / NOISE_CELL_PX).floor(), (y / NOISE_CELL_PX).floor());
    let (fx, fy) = (x / NOISE_CELL_PX - gx, y / NOISE_CELL_PX - gy);
    let smooth = |t: f64| t * t * (3.0 - 2.0 * t);
    let corner = |dx: i64, dy: i64| hash(gx as i64 + dx, gy as i64 + dy, seed);
    let top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * smooth(fx);
    let bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * smooth(fx);
    top + (bottom - top) * smooth(fy)
}

/// Lowers a pixel's distance to one more than its smaller already-swept neighbour.
fn relax(distance: &mut [u16], index: usize, behind: [Option<usize>; 2]) {
    let reach =
        |cell: Option<usize>| cell.map_or(u32::from(UNREACHED), |c| u32::from(distance[c])) + 1;
    let nearest = reach(behind[0]).min(reach(behind[1]));
    distance[index] = u32::from(distance[index]).min(nearest) as u16;
}

/// First pass: top-left to bottom-right, from the left and upper neighbours.
fn sweep_forward(distance: &mut [u16], width: usize) {
    for index in 0..distance.len() {
        let left = (index % width > 0).then(|| index - 1);
        let up = (index >= width).then(|| index - width);
        relax(distance, index, [left, up]);
    }
}

/// Second pass: bottom-right to top-left, from the right and lower neighbours.
fn sweep_backward(distance: &mut [u16], width: usize) {
    let length = distance.len();
    for index in (0..length).rev() {
        let right = (index % width + 1 < width).then(|| index + 1);
        let down = (index + width < length).then(|| index + width);
        relax(distance, index, [right, down]);
    }
}

/// City-block pixels from each water pixel to the nearest non-water pixel, 0 on land. O(pixels).
pub fn shore_distance(classes: &[u8], size: Size) -> Vec<u16> {
    let water = Surface::Water as u8;
    let mut distance: Vec<u16> = classes
        .iter()
        .map(|&class| if class == water { UNREACHED } else { 0 })
        .collect();
    sweep_forward(&mut distance, size.width);
    sweep_backward(&mut distance, size.width);
    distance
}

/// Deep water, shallows toward the shore, foam at the waterline.
fn water_colour(distance: u16) -> Rgb {
    if distance <= FOAM_PX {
        return FOAM;
    }
    let shallow = (1.0 - f64::from(distance) / SHALLOW_PX).max(0.0);
    let t = shallow * shallow;
    let deep = ALBEDO[Surface::Water as usize];
    [0, 1, 2].map(|c| deep[c] + (SHALLOW[c] - deep[c]) * t)
}

/// Stylised RGB albedo at the source resolution. O(pixels), rows in parallel.
pub fn paint_albedo(spec: &GroundSpec) -> Vec<u8> {
    let shore = shore_distance(spec.classes, spec.size);
    let width = spec.size.width;
    let mut rgb = vec![0u8; spec.classes.len() * 3];
    rgb.par_chunks_mut(width * 3)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..width {
                let index = y * width + x;
                let class = spec.classes[index];
                let noise = value_noise(x as f64, y as f64, spec.seed);
                let shade = (noise - 0.5) * 2.0 * NOISE_AMPLITUDE;
                let water = class == Surface::Water as u8;
                let base = if water {
                    water_colour(shore[index])
                } else {
                    ALBEDO[usize::from(class)]
                };
                for c in 0..3 {
                    row[x * 3 + c] = js::round(base[c] + shade).clamp(0.0, 255.0) as u8;
                }
            }
        });
    rgb
}

/// The surface that wins a height cell: seabed when most of it is water, pier when most of it is
/// pier, land otherwise.
fn cell_height(spec: &GroundSpec, column: usize, row: usize) -> f32 {
    let (cell, size) = (spec.cell_px, spec.size);
    let (mut water, mut pier, mut total) = (0usize, 0usize, 0usize);
    for y in row * cell..((row + 1) * cell).min(size.height) {
        for &class in &spec.classes
            [y * size.width + column * cell..y * size.width + ((column + 1) * cell).min(size.width)]
        {
            water += usize::from(class == Surface::Water as u8);
            pier += usize::from(class == Surface::Pier as u8);
            total += 1;
        }
    }
    if water * 2 > total {
        HEIGHT_SEABED_M
    } else if pier * 2 > total {
        HEIGHT_PIER_M
    } else {
        HEIGHT_LAND_M
    }
}

/// A height field with one value per cell, row-major.
pub struct HeightField {
    pub columns: usize,
    pub rows: usize,
    pub heights: Vec<f32>,
}

/// Height field over the raster, partial cells at the right and bottom edges. O(pixels).
pub fn height_field(spec: &GroundSpec) -> HeightField {
    let columns = spec.size.width.div_ceil(spec.cell_px);
    let rows = spec.size.height.div_ceil(spec.cell_px);
    let heights = (0..columns * rows)
        .into_par_iter()
        .map(|cell| cell_height(spec, cell % columns, cell / columns))
        .collect();
    HeightField {
        columns,
        rows,
        heights,
    }
}
