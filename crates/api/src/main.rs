//! Desire HTTP server entry point.

use desire_api::{AppState, app};
use std::net::{IpAddr, SocketAddr};

fn shutdown_error_message(error: &std::io::Error) -> String {
    format!("Could not listen for the shutdown signal: {error}")
}

/// Waits for the shutdown signal. A signal that cannot be listened for is reported, never
/// ignored: the server then shuts down instead of running without a way to stop it cleanly.
async fn wait_for_shutdown<S, R>(signal: S, report: R)
where
    S: std::future::Future<Output = std::io::Result<()>>,
    R: FnOnce(String),
{
    if let Err(error) = signal.await {
        report(shutdown_error_message(&error));
    }
}

/// The header identity is a D10 placeholder, so it never leaves the local machine
/// unless an operator explicitly opts in.
fn identity_binding_guard(host: IpAddr) -> Result<(), String> {
    if host.is_loopback() || std::env::var("DESIRE_DEV_IDENTITY").as_deref() == Ok("1") {
        return Ok(());
    }
    Err(concat!(
        "refusing a non-loopback bind with the development identity header; ",
        "D10 authentication is not implemented. ",
        "Set DESIRE_DEV_IDENTITY=1 only on a trusted network."
    )
    .into())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host: IpAddr = std::env::var("HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()?;
    identity_binding_guard(host)?;
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()?;
    let database_url = std::env::var("DATABASE_URL").map_err(
        |_| "DATABASE_URL is required: connect the API to the D08 migrations before serving",
    )?;
    let client = postgres::Client::connect(&database_url, postgres::NoTls)?;
    let address = SocketAddr::new(host, port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    let app = app(AppState::from_client(client));
    println!("Desire API: http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(tokio::signal::ctrl_c(), |message| {
            eprintln!("{message}")
        }))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn shutdown_reports_a_signal_error_with_its_cause() {
        let mut reported = Vec::new();
        let failing = async { Err(std::io::Error::other("no signal available")) };
        wait_for_shutdown(failing, |message| reported.push(message)).await;
        assert_eq!(reported.len(), 1);
        assert!(reported[0].contains("no signal available"));
    }

    #[tokio::test]
    async fn shutdown_reports_nothing_on_a_clean_signal() {
        let mut reported = Vec::new();
        wait_for_shutdown(async { Ok(()) }, |message| reported.push(message)).await;
        assert!(reported.is_empty());
    }

    #[test]
    fn loopback_hosts_need_no_identity_opt_in() {
        assert!(identity_binding_guard("127.0.0.1".parse().unwrap()).is_ok());
        assert!(identity_binding_guard("::1".parse().unwrap()).is_ok());
    }

    #[test]
    fn non_loopback_hosts_are_refused_without_the_opt_in() {
        let result = identity_binding_guard("0.0.0.0".parse().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("D10"));
    }
}
