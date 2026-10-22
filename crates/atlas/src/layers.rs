//! The pipeline's JSON layers, written byte for byte as the TypeScript pipeline writes them
//! (`JSON.stringify`, no spaces), so the two can be compared with `cmp`.

use crate::blocks::Block;
use crate::js;
use crate::vectors::{MercatorFrame, PixelPoint};

/// A pixel point in map metres, rounded to the centimetre: `[x_m, z_m]`.
fn metres(frame: &MercatorFrame, [x, y]: PixelPoint) -> String {
    let centimetres = |pixels: f64| js::round(pixels * frame.metres_per_pixel * 100.0) / 100.0;
    format!(
        "[{},{}]",
        js::number(centimetres(x)),
        js::number(centimetres(y))
    )
}

fn ring(frame: &MercatorFrame, points: &[PixelPoint]) -> String {
    let points: Vec<String> = points.iter().map(|&point| metres(frame, point)).collect();
    format!("[{}]", points.join(","))
}

fn block(frame: &MercatorFrame, id: usize, block: &Block) -> String {
    let square = frame.metres_per_pixel * frame.metres_per_pixel;
    let holes: Vec<String> = block.holes.iter().map(|hole| ring(frame, hole)).collect();
    format!(
        r#"{{"id":{id},"area_m2":{},"outer":{},"holes":[{}]}}"#,
        js::number(js::round(block.area_px as f64 * square)),
        ring(frame, &block.outer),
        holes.join(",")
    )
}

/// `blocks.json`: block outlines and holes in map metres, numbered in trace order.
pub fn blocks_json(blocks: &[Block], frame: &MercatorFrame) -> String {
    let blocks: Vec<String> = blocks
        .iter()
        .enumerate()
        .map(|(id, b)| block(frame, id, b))
        .collect();
    format!(
        "{{\"metres_per_pixel\":{},\"blocks\":[{}]}}\n",
        js::number(frame.metres_per_pixel),
        blocks.join(",")
    )
}
