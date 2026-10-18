//! Desire HTTP server: exposes service health for the frontend.

use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};

#[derive(Serialize)]
struct Health {
    service: &'static str,
    status: &'static str,
    scope: &'static str,
    protocol_version: u32,
}

async fn health() -> Json<Health> {
    Json(Health {
        service: "desire-api",
        status: "ok",
        scope: "liveness",
        protocol_version: desire_core::PROTOCOL_VERSION,
    })
}

fn shutdown_error_message(error: &std::io::Error) -> String {
    format!("Could not listen for the shutdown signal: {error}")
}

async fn wait_for_shutdown() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("{}", shutdown_error_message(&error));
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host: IpAddr = std::env::var("HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()?;
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()?;
    let address = SocketAddr::new(host, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    let app = Router::new().route("/api/health", get(health));
    println!("Desire API: http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown())
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_declares_service_and_protocol() {
        let Json(response) = health().await;
        assert_eq!(response.service, "desire-api");
        assert_eq!(response.status, "ok");
        assert_eq!(response.scope, "liveness");
        assert_eq!(response.protocol_version, desire_core::PROTOCOL_VERSION);
    }

    #[test]
    fn shutdown_preserves_cause() {
        let error = std::io::Error::other("no signal available");
        assert!(shutdown_error_message(&error).contains("no signal available"));
    }
}
