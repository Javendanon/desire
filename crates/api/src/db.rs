//! Blocking PostgreSQL access bridged to async handlers.
mod tls;

use crate::error::ApiError;
use postgres::{Client, NoTls};
use std::{
    error::Error as _,
    sync::{Arc, Mutex, MutexGuard, PoisonError, mpsc},
    thread,
    time::{Duration, Instant as Clock},
};
use tokio::{
    runtime,
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, timeout_at},
};
use tokio_postgres::Config;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// An operation this many deadlines old no longer owns the connection's single turn.
const STUCK_AFTER_DEADLINES: u32 = 3;
/// Abandoned operations keep their blocking thread until they end, so their lanes are capped.
const MAX_LANES: usize = 8;
/// Blocking handshakes that outlive their budget keep a thread until the socket dies.
const MAX_LATE_HANDSHAKES: usize = 8;
const TIMED_OUT: &str = "database request timed out; a write outcome may be unknown";
const NOT_RESTORED: &str = "the database connection could not be restored";
const CONNECT_TIMED_OUT: &str = "database connection timed out";
const NOT_STARTED: &str = "database request timed out before its work started";
const TLS_UNUSABLE: &str = "the database TLS settings are unusable";

/// A public message plus a category for the log: an SQLSTATE or I/O kind, never driver text.
struct Fault {
    message: &'static str,
    cause: String,
}

impl From<&'static str> for Fault {
    fn from(message: &'static str) -> Self {
        Self {
            message,
            cause: "none".into(),
        }
    }
}

fn not_restored(error: &postgres::Error) -> Fault {
    let io = error
        .source()
        .and_then(|source| source.downcast_ref::<std::io::Error>())
        .map(|io| format!("{:?}", io.kind()));
    let state = error.code().map(|code| code.code().to_owned());
    Fault {
        message: NOT_RESTORED,
        cause: state.or(io).unwrap_or_else(|| "unclassified".into()),
    }
}

/// One request's correlation ID, the instant its caller stops waiting, and how to connect.
struct Ticket {
    request_id: String,
    deadline: Instant,
    link: Arc<Link>,
}

/// Connection settings and limits shared by every lane.
struct Link {
    config: Option<Config>,
    timeout: Duration,
    lanes: Arc<Semaphore>,
    handshakes: Arc<Semaphore>,
}

/// One client and one turn at a time. A lane whose operation never returns is replaced, since
/// the driver cannot cancel a blocked call; a pool replaces this when throughput matters.
struct Lane {
    client: Mutex<Option<Client>>,
    admission: Arc<Semaphore>,
    started: Mutex<Option<Clock>>,
    _slot: Option<OwnedSemaphorePermit>,
}

#[derive(Clone)]
pub struct Db {
    lane: Arc<Mutex<Arc<Lane>>>,
    link: Arc<Link>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Closing waits for pending responses and starts a runtime, so it can neither run on an async
/// worker nor be allowed to block the caller when the peer has gone silent.
///
/// With no thread left, the failed spawn drops the client here. That is a known gap: it would
/// panic on an async worker and block elsewhere, and only a pre-spawned closer would remove it.
fn retire(client: Option<Client>) {
    let Some(client) = client else { return };
    if thread::Builder::new().spawn(move || drop(client)).is_err() {
        eprintln!("database_failure=\"no thread to close a client\"");
    }
}

/// The server-side failure line; responses keep only the generic message.
fn failure(request_id: &str, fault: impl Into<Fault>) -> ApiError {
    let Fault { message, cause } = fault.into();
    eprintln!("request_id={request_id} database_failure={message:?} cause={cause}");
    ApiError::internal_for(request_id, message)
}

/// TLS policy from the connection string. `require` gets a connector that verifies the server
/// and never falls back to plaintext; anything else keeps the plaintext driver, so local Docker
/// and the socket tests behave as before.
fn connector(config: &Config) -> Result<Option<tls::Connector>, Fault> {
    match tls::mode(config) {
        tls::Mode::Plain => Ok(None),
        tls::Mode::Verify => tls::connector().map(Some).map_err(|cause| Fault {
            message: TLS_UNUSABLE,
            cause,
        }),
    }
}

fn deadline_of(config: &Config) -> Duration {
    config
        .get_connect_timeout()
        .copied()
        .unwrap_or(REQUEST_TIMEOUT)
        .min(REQUEST_TIMEOUT)
}

/// Completes a full handshake under a deadline that really cancels: the async driver drops the
/// socket. The blocking client has no such bound, so it only connects after this succeeds.
fn probe(config: &Config, deadline: Instant) -> Result<(), Fault> {
    let connector = connector(config)?;
    let runtime = runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| Fault::from(NOT_RESTORED))?;
    runtime.block_on(async {
        let attempt = match connector {
            None => timeout_at(deadline, probe_with(config, tokio_postgres::NoTls)).await,
            Some(connector) => timeout_at(deadline, probe_with(config, connector)).await,
        };
        attempt
            .map_err(|_| Fault::from(CONNECT_TIMED_OUT))?
            .map_err(|error| not_restored(&error))
    })
}

async fn probe_with<T>(config: &Config, connector: T) -> Result<(), tokio_postgres::Error>
where
    T: tokio_postgres::tls::MakeTlsConnect<tokio_postgres::Socket>,
{
    let (client, connection) = config.connect(connector).await?;
    drop(client);
    let _closed = connection.await;
    Ok(())
}

/// A peer can still go silent after the probe, and the blocking handshake cannot be cancelled.
/// That attempt keeps its thread and permit until the socket dies; the caller still gets an
/// answer. Past the cap, attempts fail at once instead of adding threads.
fn handshake(config: &Config, wait: Duration, slots: &Arc<Semaphore>) -> Result<Client, Fault> {
    if wait.is_zero() {
        return Err(CONNECT_TIMED_OUT.into());
    }
    let permit = slots.clone().try_acquire_owned().map_err(|_| Fault {
        message: NOT_RESTORED,
        cause: "handshake cap reached".into(),
    })?;
    let blocking = postgres::Config::from(config.clone());
    let connector = connector(config)?;
    let (sent, received) = mpsc::sync_channel(1);
    thread::Builder::new()
        .spawn(move || {
            let _permit = permit;
            let client = match connector {
                None => blocking.connect(NoTls),
                Some(connector) => blocking.connect(connector),
            };
            let _late = sent.send(client);
        })
        .map_err(|_| Fault::from(NOT_RESTORED))?;
    match received.recv_timeout(wait) {
        Ok(result) => result.map_err(|error| not_restored(&error)),
        Err(_) => Err(CONNECT_TIMED_OUT.into()),
    }
}

/// Startup has no request to fail: `main` exits when the database does not answer in time, so
/// one deadline covers both handshakes.
pub fn connect_startup(config: &Config) -> Result<Client, String> {
    let deadline = Instant::now() + deadline_of(config);
    let slots = Arc::new(Semaphore::new(1));
    probe(config, deadline)
        .and_then(|()| {
            let wait = deadline.saturating_duration_since(Instant::now());
            handshake(config, wait, &slots)
        })
        .map_err(|Fault { message, cause }| format!("{message} (cause: {cause})"))
}

/// Its caller already has an answer by its own deadline. Each handshake gets the full limit, so
/// a slow but healthy database still restores the client for later requests.
fn reconnect(config: &Config, link: &Link) -> Result<Client, Fault> {
    probe(config, Instant::now() + link.timeout)?;
    handshake(config, link.timeout, &link.handshakes)
}

fn open<'a>(slot: &'a mut Option<Client>, link: &Link) -> Result<&'a mut Client, Fault> {
    let alive = slot
        .as_mut()
        .is_some_and(|client| !client.is_closed() && client.is_valid(link.timeout).is_ok());
    if !alive {
        retire(slot.take());
        let config = link.config.as_ref();
        let config = config.ok_or("the database connection is closed")?;
        *slot = Some(reconnect(config, link)?);
    }
    Ok(slot.as_mut().ok_or("the database connection is closed")?)
}

struct Busy<'a>(&'a Lane);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        *lock(&self.0.started) = None;
    }
}

impl Lane {
    fn new(client: Option<Client>, slot: Option<OwnedSemaphorePermit>) -> Self {
        Self {
            client: Mutex::new(client),
            admission: Arc::new(Semaphore::new(1)),
            started: Mutex::new(None),
            _slot: slot,
        }
    }

    fn stuck_for(&self, limit: Duration) -> bool {
        lock(&self.started).is_some_and(|started| started.elapsed() >= limit)
    }

    /// A panic can interrupt any protocol exchange, so that one client is not reused.
    fn client(&self) -> MutexGuard<'_, Option<Client>> {
        self.client.lock().unwrap_or_else(|poisoned| {
            let mut slot = poisoned.into_inner();
            retire(slot.take());
            self.client.clear_poison();
            slot
        })
    }

    /// Reconnecting can outlast the deadline. Work that has not started must not begin after
    /// its caller already received the failure, or a retried create would be duplicated.
    fn run<T, F>(&self, ticket: &Ticket, work: F) -> Result<T, ApiError>
    where
        F: FnOnce(&mut Client) -> Result<T, ApiError>,
    {
        *lock(&self.started) = Some(Clock::now());
        let _busy = Busy(self);
        let mut slot = self.client();
        let id = ticket.request_id.as_str();
        let client = open(&mut slot, &ticket.link).map_err(|fault| failure(id, fault))?;
        if Instant::now() >= ticket.deadline {
            return Err(failure(id, NOT_STARTED));
        }
        work(client)
    }
}

/// The last owner can be an async worker, where closing a blocking client would panic.
impl Drop for Lane {
    fn drop(&mut self) {
        retire(lock(&self.client).take());
    }
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
        let timeout = config.as_ref().map_or(REQUEST_TIMEOUT, deadline_of);
        let lanes = Arc::new(Semaphore::new(MAX_LANES));
        let slot = lanes.clone().try_acquire_owned().ok();
        let link = Link {
            config,
            timeout,
            lanes,
            handshakes: Arc::new(Semaphore::new(MAX_LATE_HANDSHAKES)),
        };
        Self {
            lane: Arc::new(Mutex::new(Arc::new(Lane::new(Some(client), slot)))),
            link: Arc::new(link),
        }
    }

    /// Replaces a lane whose operation outlived its limit. Past the cap, requests keep failing
    /// at their deadline until an abandoned operation ends.
    fn current_lane(&self, request_id: &str) -> Arc<Lane> {
        let mut current = lock(&self.lane);
        let limit = self.link.timeout * STUCK_AFTER_DEADLINES;
        if self.link.config.is_some() && current.stuck_for(limit) {
            match self.link.lanes.clone().try_acquire_owned() {
                Ok(slot) => {
                    eprintln!("request_id={request_id} database_failure=\"lane abandoned\"");
                    *current = Arc::new(Lane::new(None, Some(slot)));
                }
                Err(_) => {
                    eprintln!("request_id={request_id} database_failure=\"lane cap reached\"");
                }
            }
        }
        Arc::clone(&current)
    }
}

/// Run one repository call on the blocking pool. The guards never cross an await.
pub async fn blocking<T, F>(db: &Db, request_id: String, work: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Client) -> Result<T, ApiError> + Send + 'static,
{
    let deadline = Instant::now() + db.link.timeout;
    let lane = db.current_lane(&request_id);
    let permit = timeout_at(deadline, lane.admission.clone().acquire_owned())
        .await
        .map_err(|_| failure(&request_id, TIMED_OUT))?
        .map_err(|_| failure(&request_id, "database admission closed"))?;
    let ticket = Ticket {
        request_id: request_id.clone(),
        deadline,
        link: db.link.clone(),
    };
    let task = tokio::task::spawn_blocking(move || {
        // Keep admission until the actual blocking operation ends, including after the
        // caller times out. Queued requests must not spawn more blocked threads.
        let _permit = permit;
        lane.run(&ticket, work)
    });
    timeout_at(deadline, task)
        .await
        .map_err(|_| failure(&request_id, TIMED_OUT))?
        .map_err(|_| failure(&request_id, "database worker failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(url: &str) -> Config {
        url.parse().unwrap()
    }

    /// Regression: `NoTls` accepts a `require` URL and then fails (or would talk in plaintext)
    /// because it can never complete the handshake.
    #[test]
    fn a_require_url_is_not_opened_with_the_plaintext_driver() {
        let required = config("postgres://user:secret@db.internal:5432/desire?sslmode=require");
        assert!(matches!(connector(&required), Ok(Some(_))));

        for plaintext in [
            "postgres://user:secret@db.internal:5432/desire",
            "postgres://user:secret@db.internal:5432/desire?sslmode=prefer",
            "postgres://user:secret@db.internal:5432/desire?sslmode=disable",
        ] {
            assert!(
                matches!(connector(&config(plaintext)), Ok(None)),
                "{plaintext}"
            );
        }
    }
}
