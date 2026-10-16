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
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
