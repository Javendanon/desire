//! Servidor HTTP de Desire: expone la salud del servicio para el frontend.

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

fn mensaje_de_apagado(error: &std::io::Error) -> String {
    format!("No se pudo escuchar la señal de apagado: {error}")
}

async fn esperar_apagado() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("{}", mensaje_de_apagado(&error));
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
        .with_graceful_shutdown(esperar_apagado())
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_declara_servicio_y_protocolo() {
        let Json(respuesta) = health().await;
        assert_eq!(respuesta.service, "desire-api");
        assert_eq!(respuesta.status, "ok");
        assert_eq!(respuesta.scope, "liveness");
        assert_eq!(respuesta.protocol_version, desire_core::PROTOCOL_VERSION);
    }

    #[test]
    fn apagado_conserva_la_causa() {
        let error = std::io::Error::other("sin señal disponible");
        assert!(mensaje_de_apagado(&error).contains("sin señal disponible"));
    }
}
