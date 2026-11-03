//! Desire HTTP API: versioned, resource-oriented handlers over the D08 adapters.
//!
//! Handlers parse and validate transport input, delegate authorization to `access`, and
//! delegate policy to `store` and SQL to typed persistence repositories. No handler contains
//! SQL or domain calculations.

pub mod access;
pub mod auth;
pub mod db;
pub mod error;
pub mod extract;
pub mod ids;
pub mod nivel20;
pub mod payloads;
pub mod query;
pub mod routes;
pub mod store;
pub mod validation;

use desire_core::flags::FlagSource;

pub use error::ApiError;

/// Shared process state. A single blocking client serializes database work for now; a
/// pool replaces it when concurrent throughput matters. `flags` is read per request, so an
/// operator can switch a runtime feature off without a restart.
#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub nivel20: nivel20::Nivel20Client,
    pub flags: FlagSource,
    /// Tests and loopback development may keep the header seam; shared binds use bearer sessions.
    pub dev_identity: bool,
}

impl AppState {
    /// Used by tests and other owners of an already-connected client: no reconnect settings.
    pub fn from_client(client: postgres::Client) -> Self {
        Self {
            db: db::Db::from_client(client),
            nivel20: nivel20::Nivel20Client::default(),
            flags: FlagSource::from_env(),
            dev_identity: true,
        }
    }

    /// State that can replace a connection the server closed, using the same settings.
    pub fn with_config(config: tokio_postgres::Config, client: postgres::Client) -> Self {
        Self {
            db: db::Db::with_config(config, client),
            nivel20: nivel20::Nivel20Client::default(),
            flags: FlagSource::from_env(),
            dev_identity: false,
        }
    }

    /// Production keeps the source base URL out of request bodies.
    pub fn with_nivel20(
        config: tokio_postgres::Config,
        client: postgres::Client,
        nivel20: nivel20::Nivel20Client,
    ) -> Self {
        Self {
            db: db::Db::with_config(config, client),
            nivel20,
            flags: FlagSource::from_env(),
            dev_identity: false,
        }
    }

    pub fn with_dev_identity(mut self, allow: bool) -> Self {
        self.dev_identity = allow;
        self
    }
}

pub fn app(state: AppState) -> axum::Router {
    routes::router(state)
}
