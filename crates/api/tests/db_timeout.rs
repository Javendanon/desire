//! Deadline responses do not cancel a write or admit a second blocking operation.
use crate::support::TestDb;
use desire_api::{AppState, db};
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::Duration,
};
use tokio::sync::Notify;

#[derive(Default)]
struct Blocked {
    open: Mutex<bool>,
    wake: Condvar,
    entered: AtomicUsize,
    finished: AtomicUsize,
    threads: AtomicUsize,
    started: Notify,
}

impl Blocked {
    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.wake.notify_all();
    }

    fn work(&self) {
        self.entered.fetch_add(1, Ordering::SeqCst);
        self.started.notify_one();
        drop(
            self.wake
                .wait_while(self.open.lock().unwrap(), |open| !*open)
                .unwrap(),
        );
        self.finished.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn database_deadline_does_not_spawn_a_second_queued_operation() {
    let fixture = TestDb::new();
    let mut config: tokio_postgres::Config = fixture.url().parse().unwrap();
    config.connect_timeout(Duration::from_millis(500));
    let state = AppState::with_config(config, fixture.connection());
    let gate = Arc::new(Blocked::default());
    let cleanup_gate = gate.clone();
    let (cancel, wait) = mpsc::sync_channel(1);
    // Cleanup alone: a regression must fail instead of hanging Tokio's runtime drop.
    let cleanup = std::thread::spawn(move || {
        if wait.recv_timeout(Duration::from_secs(2)).is_err() {
            cleanup_gate.release();
        }
    });
    let counted = gate.clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .on_thread_start(move || {
            counted.threads.fetch_add(1, Ordering::SeqCst);
        })
        .build()
        .unwrap();
    runtime.block_on(check_deadlines(&state, gate));
    drop(runtime);
    cancel.send(()).unwrap();
    cleanup.join().unwrap();
}

async fn check_deadlines(state: &AppState, gate: Arc<Blocked>) {
    let first_gate = gate.clone();
    let first = db::blocking(&state.db, "test".into(), move |_| {
        first_gate.work();
        Ok(1)
    });
    let second = queued(state, gate.clone());
    let (first, (started, second)) = tokio::join!(first, second);
    let threads = gate.threads.load(Ordering::SeqCst);
    let ran = gate.entered.load(Ordering::SeqCst);
    let finished = gate.finished.load(Ordering::SeqCst);
    gate.release();
    assert!(started, "the first operation must enter before the second");
    assert!(first.unwrap_err().message.contains("timed out"));
    assert!(second.unwrap_err().message.contains("timed out"));
    assert_eq!(ran, 1, "queued work must not run");
    assert_eq!(threads, 1, "queued work must not occupy a blocking thread");
    assert_eq!(finished, 0, "the caller returns before its work finishes");
    assert_eq!(
        db::blocking(&state.db, "test".into(), |_| Ok(3))
            .await
            .unwrap(),
        3
    );
    assert_eq!(gate.finished.load(Ordering::SeqCst), 1, "work ends later");
    assert_timed_out_queue_never_runs(state, &gate).await;
}

/// Without admission, a queued caller's thread would still run its work once the mutex frees.
/// The pause only gives that regression time to appear, so it cannot fail a correct build.
async fn assert_timed_out_queue_never_runs(state: &AppState, gate: &Blocked) {
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        db::blocking(&state.db, "test".into(), |_| Ok(4))
            .await
            .unwrap(),
        4
    );
    assert_eq!(
        gate.entered.load(Ordering::SeqCst),
        1,
        "a queued request that timed out must never run its work"
    );
}

async fn queued(state: &AppState, gate: Arc<Blocked>) -> (bool, Result<i32, desire_api::ApiError>) {
    let started = tokio::time::timeout(Duration::from_secs(1), gate.started.notified())
        .await
        .is_ok();
    let result = db::blocking(&state.db, "test".into(), move |_| {
        gate.entered.fetch_add(1, Ordering::SeqCst);
        Ok(2)
    })
    .await;
    (started, result)
}
