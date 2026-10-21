//! Shared core for the native server and the WebAssembly module.

pub mod flags;
pub mod routing;

pub const PROTOCOL_VERSION: u32 = 1;

pub mod contracts;
