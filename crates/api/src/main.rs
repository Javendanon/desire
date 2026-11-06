//! Desire HTTP server entry point.

use desire_api::{
    AppState, app,
    auth::{
        oidc::Oidc,
        settings::{Settings, development_origin, require_oidc},
    },
    db,
    nivel20::Nivel20Client,
};
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

/// The header seam needs an explicit opt-in and a loopback bind: on a shared network a player
/// could otherwise attach the owner's header and act as DM.
fn dev_identity_allowed(host: IpAddr, opted_in: bool) -> bool {
    opted_in && host.is_loopback()
}

fn dev_identity_opt_in() -> bool {
    std::env::var("DESIRE_DEV_IDENTITY").as_deref() == Ok("1")
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
fn database_config(url: &str) -> Result<tokio_postgres::Config, Box<dyn std::error::Error>> {
    let mut config: tokio_postgres::Config = url.parse()?;
    let requested = config.get_connect_timeout().copied();
    config.connect_timeout(requested.map_or(db::REQUEST_TIMEOUT, |t| t.min(db::REQUEST_TIMEOUT)));
    Ok(config)
}

/// Server-side bounds for abandoned work: three default request deadlines, after which `Db`
/// also stops waiting for it. Migrations do not use them. Options from `DATABASE_URL` win.
const SERVER_LIMITS: &str = "-c statement_timeout=15000 -c lock_timeout=15000 \
     -c idle_in_transaction_session_timeout=15000";

fn with_server_limits(mut config: tokio_postgres::Config) -> tokio_postgres::Config {
    let options = config
        .get_options()
        .map_or(SERVER_LIMITS.to_owned(), |requested| {
            format!("{SERVER_LIMITS} {requested}")
        });
    config.options(&options);
    config
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
/// server runtime. `run_server` retains the last state owner outside that runtime so the
/// connection also closes on this thread.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host: IpAddr = environment("HOST", "127.0.0.1")?;
    let dev_identity = dev_identity_allowed(host, dev_identity_opt_in());
    let port: u16 = environment("PORT", "3001")?;
    let config = database_config(&database_url()?)?;
    if migrated() {
        let mut client = db::connect_startup(&config)?;
        desire_persistence::migrations::apply(&mut client)?;
        println!("D08 migrations applied");
        return Ok(());
    }
    let settings = Settings::from_env()?;
    require_oidc(host, settings.is_some())?;
    let dev_origin = if settings.is_none() {
        development_origin(dev_identity)?
    } else {
        None
    };
    let config = with_server_limits(config);
    let client = db::connect_startup(&config)?;
    let nivel20 = Nivel20Client::from_env()?;
    let address = SocketAddr::new(host, port);
    let mut state = AppState::with_nivel20(config, client, nivel20).with_dev_identity(dev_identity);
    state.dev_origin = dev_origin;
    run_server(address, state, settings)
}

/// Keep the last blocking client owner outside the server runtime during shutdown.
fn run_server(
    address: SocketAddr,
    state: AppState,
    settings: Option<Settings>,
) -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let served = runtime.block_on(start(address, state.clone(), settings));
    runtime.shutdown_background();
    drop(state);
    served
}

async fn start(
    address: SocketAddr,
    state: AppState,
    settings: Option<Settings>,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = match settings {
        Some(settings) => state.with_oidc(Oidc::discover(settings).await?),
        None => state,
    };
    serve(address, state).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_limits_apply_and_url_options_can_override_them() {
        let plain = with_server_limits("host=db".parse().unwrap());
        assert_eq!(plain.get_options(), Some(SERVER_LIMITS));
        let requested = "host=db options='-c statement_timeout=1'";
        let custom = with_server_limits(requested.parse().unwrap());
        let options = custom.get_options().unwrap();
        assert!(options.starts_with(SERVER_LIMITS));
        assert!(options.ends_with("-c statement_timeout=1"));
    }

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
    fn the_header_seam_needs_an_opt_in_and_a_loopback_bind() {
        let loopback: IpAddr = "127.0.0.1".parse().unwrap();
        let any: IpAddr = "0.0.0.0".parse().unwrap();
        let shared: IpAddr = "192.0.2.10".parse().unwrap();
        assert!(!dev_identity_allowed(loopback, false));
        assert!(dev_identity_allowed(loopback, true));
        assert!(!dev_identity_allowed(any, true));
        assert!(!dev_identity_allowed(shared, true));
    }

    #[test]
    fn socket_urls_are_accepted_as_database_settings() {
        let config = database_config("postgresql://desire_test@%2Ftmp%2Fsocket/synthetic").unwrap();
        assert_eq!(config.get_user(), Some("desire_test"));
        assert_eq!(config.get_dbname(), Some("synthetic"));
    }
}
