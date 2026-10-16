use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    desire_core::PROTOCOL_VERSION
}
