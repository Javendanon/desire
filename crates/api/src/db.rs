//! Blocking PostgreSQL access bridged to async handlers.
use crate::error::ApiError;
use postgres::{Client, Config};
use std::sync::{Arc, Mutex, MutexGuard};

/// One blocking client behind a mutex. It keeps the connection settings so a client the
/// server closed can be replaced; a pool replaces this when concurrent throughput matters.
#[derive(Clone)]
pub struct Db {
    connection: Arc<Mutex<Connection>>,
}

struct Connection {
    client: Client,
    config: Option<Config>,
}

impl Db {
    /// The caller owns the client; nothing can restore it after the server closes it.
    pub fn from_client(client: Client) -> Self {
        Self::new(client, None)
    }

    pub fn with_config(config: Config, client: Client) -> Self {
        Self::new(client, Some(config))
    }

    fn new(client: Client, config: Option<Config>) -> Self {
        Self {
            connection: Arc::new(Mutex::new(Connection { client, config })),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, ApiError> {
        self.connection
            .lock()
            .map_err(|_| ApiError::internal("database lock is poisoned"))
    }
}

impl Connection {
    /// A ping before every request makes the check deterministic: a socket the server killed
    /// is not always marked closed until a query fails, and that query would surface as a
    /// 500. The cost is one extra round trip on a serialized connection.
    fn ensure_open(&mut self) -> Result<(), ApiError> {
        if !self.client.is_closed() && self.client.simple_query("SELECT 1").is_ok() {
            return Ok(());
        }
        self.reconnect()
    }

    /// Replaces a dead client with one built from the startup settings.
    fn reconnect(&mut self) -> Result<(), ApiError> {
        let Some(config) = self.config.as_ref() else {
            return Err(ApiError::internal("the database connection is closed"));
        };
        self.client = config
            .connect(postgres::NoTls)
            .map_err(|_| ApiError::internal("the database connection could not be restored"))?;
        Ok(())
    }
}

/// Run one repository call on the blocking pool. The guard never crosses an await.
pub async fn blocking<T, F>(db: &Db, work: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Client) -> Result<T, ApiError> + Send + 'static,
{
    let db = db.clone();
    tokio::task::spawn_blocking(move || {
        let mut connection = db.lock()?;
        connection.ensure_open()?;
        work(&mut connection.client)
    })
    .await
    .map_err(|_| ApiError::internal("database worker failed"))?
}
