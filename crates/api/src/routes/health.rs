//! Liveness endpoint; deliberately unauthenticated.
use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct Health {
    service: &'static str,
    status: &'static str,
    scope: &'static str,
    protocol_version: u32,
}

pub async fn health() -> Json<Health> {
    Json(Health {
        service: "desire-api",
        status: "ok",
        scope: "liveness",
        protocol_version: desire_core::PROTOCOL_VERSION,
    })
}
