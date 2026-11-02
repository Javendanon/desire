//! Blocking PostgreSQL access bridged to async handlers.
use crate::error::ApiError;
use postgres::Client;
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Client>>;

/// Run one repository call on the blocking pool. The guard never crosses an await.
pub async fn blocking<T, F>(db: &Db, work: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Client) -> Result<T, ApiError> + Send + 'static,
{
    let db = db.clone();
    tokio::task::spawn_blocking(move || {
        let mut client = db
            .lock()
            .map_err(|_| ApiError::internal("database lock is poisoned"))?;
        work(&mut client)
    })
    .await
    .map_err(|_| ApiError::internal("database worker failed"))?
}
