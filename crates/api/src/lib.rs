//! Desire HTTP API: versioned, resource-oriented handlers over the D08 adapters.
//!
//! Handlers parse and validate transport input, delegate authorization to `access`, and
//! delegate SQL to `store`. No handler contains SQL or domain calculations.

pub mod access;
pub mod db;
pub mod error;
pub mod extract;
pub mod ids;
pub mod payloads;
pub mod query;
pub mod routes;
pub mod store;
pub mod validation;

pub use error::ApiError;

/// Shared process state. A single blocking client serializes database work for now; a
/// pool replaces it when concurrent throughput matters.
#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
}

impl AppState {
    /// Used by tests and other owners of an already-connected client: no reconnect settings.
    pub fn from_client(client: postgres::Client) -> Self {
        Self {
            db: db::Db::from_client(client),
        }
    }

    /// State that can replace a connection the server closed, using the same settings.
    pub fn with_config(config: postgres::Config, client: postgres::Client) -> Self {
        Self {
            db: db::Db::with_config(config, client),
        }
    }
}

pub fn app(state: AppState) -> axum::Router {
    routes::router(state)
}
