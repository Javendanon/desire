//! Real outages: a peer that accepts and stays silent, a stuck operation and a panic.
use crate::{
    outage_proxy::Proxy,
    server,
    support::{self, TestDb, id},
};
use desire_api::{ApiError, AppState, db};
use std::{
    io::Read,
    net::TcpListener,
    os::unix::net::UnixStream,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub(crate) const DEADLINE: Duration = Duration::from_millis(200);
const RECOVERY_LIMIT: Duration = Duration::from_secs(10);
const WATCHDOG: Duration = Duration::from_secs(60);

fn state_through(proxy: &Proxy, db: &TestDb) -> AppState {
    let config = proxy.config(db);
    let client = postgres::Config::from(config.clone())
        .connect(postgres::NoTls)
        .unwrap();
    AppState::with_config(config, client)
}

async fn ping(state: &AppState) -> Result<(), ApiError> {
    db::blocking(&state.db, id(700), |client| {
        client
            .simple_query("SELECT 1")
            .map(|_| ())
            .map_err(|_| ApiError::internal("query failed"))
    })
    .await
}

async fn recovery(state: &AppState) -> Duration {
    let start = Instant::now();
    while ping(state).await.is_err() {
        assert!(start.elapsed() < RECOVERY_LIMIT, "the API did not recover");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    start.elapsed()
}

/// Dropping a runtime waits for blocking work, so a regression must fail here, not hang CI.
fn within_watchdog(test: impl FnOnce() + Send + 'static) {
    let (done, finished) = mpsc::channel();
    let body = thread::spawn(move || {
        test();
        let _sent = done.send(());
    });
    let outcome = finished.recv_timeout(WATCHDOG);
    assert_ne!(
        outcome,
        Err(mpsc::RecvTimeoutError::Timeout),
        "the test hung"
    );
    body.join().unwrap();
}

async fn backend_pid(state: &AppState) -> i32 {
    db::blocking(&state.db, id(704), |client| {
        let row = client.query_one("SELECT pg_backend_pid()", &[]);
        row.map(|row| row.get(0))
            .map_err(|_| ApiError::internal("query failed"))
    })
    .await
    .unwrap()
}

#[test]
fn a_silent_peer_fails_within_the_deadline_and_service_returns_with_the_database() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let proxy = Proxy::start();
        let state = state_through(&proxy, &test_db);
        support::run(async {
            recovery(&state).await;
            proxy.set_silent(true);
            for _ in 0..3 {
                let start = Instant::now();
                let error = ping(&state).await.unwrap_err();
                assert!(start.elapsed() < DEADLINE * 3, "{:?}", start.elapsed());
                assert_eq!(error.request_id, id(700), "the caller's ID must survive");
            }
            tokio::time::sleep(DEADLINE * 3).await;
            assert_eq!(
                proxy.silent_sockets_left_open(),
                0,
                "an attempt kept its socket"
            );
            proxy.set_silent(false);
            recovery(&state).await;
        });
    });
}

#[test]
fn an_operation_that_never_returns_is_abandoned_and_service_resumes() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let mut config: tokio_postgres::Config = test_db.url().parse().unwrap();
        config.connect_timeout(DEADLINE);
        let state = AppState::with_config(config, test_db.connection());
        let (release, stuck) = mpsc::channel::<()>();
        support::run(async {
            let held = db::blocking(&state.db, id(701), move |_| {
                let _released = stuck.recv();
                Ok(())
            });
            assert!(held.await.unwrap_err().message.contains("timed out"));
            tokio::time::sleep(DEADLINE * 3).await;
            recovery(&state).await;
            // Dropping the runtime waits for blocking work, so the stuck call ends here.
            drop(release);
        });
    });
}

#[test]
fn a_panic_discards_one_client_and_later_requests_keep_the_next() {
    let test_db = TestDb::new();
    let state = test_db.state();
    support::run(async {
        let panicked = db::blocking(&state.db, id(702), |_| -> Result<(), ApiError> {
            panic!("simulated repository defect")
        });
        assert_eq!(panicked.await.unwrap_err().request_id, id(702));
        let first = backend_pid(&state).await;
        assert_eq!(backend_pid(&state).await, first, "reconnected again");
    });
}

#[test]
fn a_write_does_not_start_after_its_caller_got_the_failure() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let proxy = Proxy::start();
        let state = state_through(&proxy, &test_db);
        let mut observer = test_db.connection();
        let create = "CREATE TABLE late_write(x int)";
        observer.batch_execute(create).unwrap();
        let outcome = support::run(late_write(&proxy, &state));
        let row = observer.query_one("SELECT count(*) FROM late_write", &[]);
        let rows: i64 = row.unwrap().get(0);
        assert_eq!(rows, i64::from(outcome.is_ok()), "{outcome:?}");
    });
}

/// The peer returns during the attempt, so reconnecting succeeds only after the deadline.
async fn late_write(proxy: &Proxy, state: &AppState) -> Result<(), ApiError> {
    recovery(state).await;
    proxy.set_silent(true);
    let healing = proxy.clone();
    thread::spawn(move || {
        thread::sleep(DEADLINE / 2);
        healing.set_silent(false);
    });
    let outcome = db::blocking(&state.db, id(705), |client| {
        let insert = client.batch_execute("INSERT INTO late_write VALUES (1)");
        insert.map_err(|_| ApiError::internal("query failed"))
    })
    .await;
    tokio::time::sleep(DEADLINE * 5).await;
    outcome
}

/// Forwards odd connections and parks even ones: every probe succeeds, then the real
/// handshake hangs.
fn stalling_every_second_connection(delay: Duration) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let path = format!(
        "{}/.s.PGSQL.5432",
        std::env::var("DESIRE_TEST_SOCKET").unwrap()
    );
    thread::spawn(move || {
        let mut parked = Vec::new();
        for (index, stream) in listener.incoming().enumerate() {
            let tcp = stream.unwrap();
            if index % 2 == 0 {
                thread::sleep(delay);
                forward(tcp, UnixStream::connect(&path).unwrap());
            } else {
                parked.push(tcp);
            }
        }
    });
    port
}

fn forward(tcp: std::net::TcpStream, unix: UnixStream) {
    let (mut tcp_in, mut unix_out) = (tcp.try_clone().unwrap(), unix.try_clone().unwrap());
    let (mut unix_in, mut tcp_out) = (unix, tcp);
    thread::spawn(move || std::io::copy(&mut tcp_in, &mut unix_out));
    thread::spawn(move || std::io::copy(&mut unix_in, &mut tcp_out));
}

fn stalling_config(test_db: &TestDb, delay: Duration) -> tokio_postgres::Config {
    let name = test_db.url().rsplit('/').next().unwrap().to_owned();
    let port = stalling_every_second_connection(delay);
    let url = format!("postgresql://desire_test@127.0.0.1:{port}/{name}?connect_timeout=1");
    url.parse().unwrap()
}

#[test]
fn late_handshakes_stop_adding_threads_at_their_cap() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let mut config = stalling_config(&test_db, Duration::ZERO);
        config.connect_timeout(DEADLINE / 2);
        let state = AppState::with_config(config, test_db.connection());
        test_db.drop_connections();
        support::run(async {
            for _ in 0..40 {
                let error = ping(&state).await.unwrap_err();
                if error.message.contains("could not be restored") {
                    return;
                }
                tokio::time::sleep(DEADLINE).await;
            }
            panic!("handshakes kept starting past their cap");
        });
    });
}

#[test]
fn startup_stays_bounded_when_the_peer_goes_silent_after_the_probe() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let config = stalling_config(&test_db, Duration::ZERO);
        let start = Instant::now();
        let outcome = db::connect_startup(&config);
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "{:?}",
            start.elapsed()
        );
        assert!(outcome.err().unwrap().contains("timed out"));
    });
}

/// Forwards every connection after a delay: slow, but healthy.
fn slow_port(delay: Duration) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let path = format!(
        "{}/.s.PGSQL.5432",
        std::env::var("DESIRE_TEST_SOCKET").unwrap()
    );
    thread::spawn(move || {
        for stream in listener.incoming() {
            thread::sleep(delay);
            forward(stream.unwrap(), UnixStream::connect(&path).unwrap());
        }
    });
    port
}

#[test]
fn a_slow_but_healthy_database_still_restores_the_client() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let name = test_db.url().rsplit('/').next().unwrap().to_owned();
        let port = slow_port(DEADLINE * 3 / 5);
        let url = format!("postgresql://desire_test@127.0.0.1:{port}/{name}");
        let mut config: tokio_postgres::Config = url.parse().unwrap();
        config.connect_timeout(DEADLINE);
        let state = AppState::with_config(config, test_db.connection());
        test_db.drop_connections();
        support::run(async {
            recovery(&state).await;
        });
    });
}

#[test]
fn startup_shares_one_deadline_across_a_slow_probe_and_a_silent_handshake() {
    within_watchdog(|| {
        let test_db = TestDb::new();
        let mut config = stalling_config(&test_db, Duration::from_millis(1400));
        config.connect_timeout(Duration::from_secs(2));
        let start = Instant::now();
        let outcome = db::connect_startup(&config);
        let elapsed = start.elapsed();
        assert!(outcome.err().unwrap().contains("timed out"));
        assert!(elapsed < Duration::from_secs(3), "{elapsed:?}");
    });
}

fn start_binary(url: String, port: u16) -> Child {
    let mut child = Command::new(env!("CARGO_BIN_EXE_desire-api"))
        .env("DATABASE_URL", url)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    server::wait_until_ready(port, &mut child);
    child
}

fn stop_binary(mut child: Child) -> String {
    let pid = child.id().to_string();
    Command::new("kill").arg("-INT").arg(pid).status().unwrap();
    assert!(server::wait_for_exit(&mut child).success());
    let mut diagnostic = String::new();
    let mut stderr = child.stderr.take().unwrap();
    stderr.read_to_string(&mut diagnostic).unwrap();
    diagnostic
}

#[test]
fn the_binary_logs_connection_failures_with_the_callers_request_id() {
    let test_db = TestDb::new();
    let proxy = Proxy::start();
    let port = server::free_port();
    let child = start_binary(proxy.url(&test_db, 1), port);
    proxy.set_silent(true);
    let head = format!(
        "GET /api/v1/campaigns HTTP/1.1\r\nHost:127.0.0.1\r\nx-desire-user:{}\r\n\
         x-request-id:{}\r\nConnection:close\r\n\r\n",
        id(90),
        id(703)
    );
    let response = server::request(port, &head);
    let diagnostic = stop_binary(child);
    assert!(response.starts_with("HTTP/1.1 500"), "{response}");
    assert!(response.contains(&id(703)), "{response}");
    let expected = format!("request_id={} database_failure", id(703));
    assert!(diagnostic.contains(&expected), "{diagnostic}");
}

#[test]
fn the_binary_logs_the_category_of_a_failed_reconnection() {
    let test_db = TestDb::new();
    let port = server::free_port();
    let child = start_binary(test_db.url(), port);
    test_db.rename_away();
    let head = format!(
        "GET /api/v1/campaigns HTTP/1.1\r\nHost:127.0.0.1\r\nx-desire-user:{}\r\n\
         x-request-id:{}\r\nConnection:close\r\n\r\n",
        id(90),
        id(706)
    );
    let response = server::request(port, &head);
    let diagnostic = stop_binary(child);
    assert!(response.starts_with("HTTP/1.1 500"), "{response}");
    assert!(!response.contains("3D000"), "{response}");
    assert!(diagnostic.contains("cause=3D000"), "{diagnostic}");
}
