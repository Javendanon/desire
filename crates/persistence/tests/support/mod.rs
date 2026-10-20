//! Every test uses its own database in the socket-only disposable cluster.
use postgres::{Client, Config, NoTls};
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_DATABASE: AtomicUsize = AtomicUsize::new(0);

pub fn database() -> Client {
    let socket = std::env::var("DESIRE_TEST_SOCKET")
        .expect("run bash crates/persistence/test-postgres.sh; no external database is allowed");
    let mut config = Config::new();
    config.host_path(socket).user("desire_test").dbname("postgres");
    let mut admin = config.connect(NoTls).unwrap();
    let name = format!("d08_{}_{}", std::process::id(), NEXT_DATABASE.fetch_add(1, Ordering::Relaxed));
    admin.batch_execute(&format!("CREATE DATABASE {name}")).unwrap();
    config.dbname(&name).connect(NoTls).unwrap()
}

pub fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012x}")
}
