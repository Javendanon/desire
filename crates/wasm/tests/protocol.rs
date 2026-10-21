//! Contract between the crates: the WebAssembly module reports the protocol version the core
//! defines. If the wasm build pinned its own number, the browser and the server would disagree
//! silently about the protocol they speak.

#[test]
fn wasm_reports_the_core_protocol_version() {
    assert_eq!(
        desire_wasm::protocol_version(),
        desire_core::PROTOCOL_VERSION
    );
}

#[test]
fn protocol_version_starts_at_one() {
    assert!(
        desire_wasm::protocol_version() >= 1,
        "0 is reserved for 'unknown'"
    );
}
