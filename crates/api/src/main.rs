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

fn environment<T>(name: &str, fallback: &str) -> Result<T, Box<dyn std::error::Error>>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + 'static,
{
    Ok(std::env::var(name)
        .unwrap_or_else(|_| fallback.into())
        .parse()?)
}

fn database_url() -> Result<String, Box<dyn std::error::Error>> {
    std::env::var("DATABASE_URL").map_err(|_| {
        "DATABASE_URL is required: apply the D08 migrations and point the API at that database"
            .into()
    })
}

/// Connection settings are kept so `Db` can replace a client the server closed.
fn database_config(url: &str) -> Result<postgres::Config, Box<dyn std::error::Error>> {
    Ok(url.parse()?)
}

fn migrated() -> bool {
    std::env::args().any(|argument| argument == "--migrate")
}

async fn serve(address: SocketAddr, state: AppState) -> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind(address).await?;
    let app = app(state);
    println!("Desire API: http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(tokio::signal::ctrl_c(), |message| {
            eprintln!("{message}")
        }))
        .await?;
    Ok(())
}

/// The blocking client needs its own runtime, so it is created and dropped outside the
/// server runtime. `state` stays owned here for the same reason: the last drop closes the
/// connection on this thread.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host: IpAddr = environment("HOST", "127.0.0.1")?;
    identity_binding_guard(host)?;
    let port: u16 = environment("PORT", "3001")?;
    let config = database_config(&database_url()?)?;
    let mut client = config.connect(postgres::NoTls)?;
    if migrated() {
        desire_persistence::migrations::apply(&mut client)?;
        println!("D08 migrations applied");
        return Ok(());
    }
    let address = SocketAddr::new(host, port);
    let state = AppState::with_config(config, client);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let served = runtime.block_on(serve(address, state.clone()));
    runtime.shutdown_background();
    drop(state);
    served
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

    #[test]
    fn socket_urls_are_accepted_as_database_settings() {
        let config = database_config("postgresql://desire_test@%2Ftmp%2Fsocket/synthetic").unwrap();
        assert_eq!(config.get_user(), Some("desire_test"));
        assert_eq!(config.get_dbname(), Some("synthetic"));
    }
}
