//! A TCP proxy to the disposable cluster that can stop answering without closing anything.
use crate::{outage::DEADLINE, support::TestDb};
use std::{
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    os::unix::net::UnixStream,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

/// Forwards TCP to the disposable cluster's socket. While silent, it keeps every socket open
/// and forwards nothing, including on connections it accepts then.
#[derive(Clone)]
pub(crate) struct Proxy {
    port: u16,
    silent: Arc<AtomicBool>,
    parked: Arc<Mutex<Vec<TcpStream>>>,
    silent_accepts: Arc<Mutex<Vec<TcpStream>>>,
}

impl Proxy {
    pub(crate) fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = Self {
            port: listener.local_addr().unwrap().port(),
            silent: Arc::default(),
            parked: Arc::default(),
            silent_accepts: Arc::default(),
        };
        let accepting = proxy.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                accepting.adopt(stream.unwrap());
            }
        });
        proxy
    }

    fn adopt(&self, tcp: TcpStream) {
        if self.silent.load(Ordering::SeqCst) {
            self.silent_accepts.lock().unwrap().push(tcp);
            return;
        }
        let path = format!(
            "{}/.s.PGSQL.5432",
            std::env::var("DESIRE_TEST_SOCKET").unwrap()
        );
        let unix = UnixStream::connect(path).unwrap();
        self.parked.lock().unwrap().push(tcp.try_clone().unwrap());
        let (tcp_out, unix_out) = (tcp.try_clone().unwrap(), unix.try_clone().unwrap());
        let (up, down) = (self.clone(), self.clone());
        thread::spawn(move || up.pump(tcp, unix_out));
        thread::spawn(move || down.pump(unix, tcp_out));
    }

    fn pump(&self, mut from: impl Read, mut to: impl Write) {
        let mut buffer = [0; 8192];
        while let Ok(size) = from.read(&mut buffer) {
            if size == 0
                || self.silent.load(Ordering::SeqCst)
                || to.write_all(&buffer[..size]).is_err()
            {
                break;
            }
        }
    }

    /// Connections accepted while silent whose client side has not hung up. A pending read
    /// times out on an open socket and reaches end of file on a closed one.
    pub(crate) fn silent_sockets_left_open(&self) -> usize {
        let accepted = self.silent_accepts.lock().unwrap();
        accepted.iter().filter(|socket| is_open(socket)).count()
    }

    pub(crate) fn set_silent(&self, silent: bool) {
        self.silent.store(silent, Ordering::SeqCst);
    }

    pub(crate) fn config(&self, db: &TestDb) -> tokio_postgres::Config {
        let mut config: tokio_postgres::Config = self.url(db, 1).parse().unwrap();
        config.connect_timeout(DEADLINE);
        config
    }

    pub(crate) fn url(&self, db: &TestDb, seconds: u32) -> String {
        let name = db.url().rsplit('/').next().unwrap().to_owned();
        format!(
            "postgresql://desire_test@127.0.0.1:{}/{name}?connect_timeout={seconds}",
            self.port
        )
    }
}

fn is_open(mut socket: &TcpStream) -> bool {
    socket.set_read_timeout(Some(DEADLINE)).unwrap();
    let mut buffer = [0; 1024];
    loop {
        match socket.read(&mut buffer) {
            Ok(0) => return false,
            Ok(_) => {}
            Err(error) => {
                return matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut);
            }
        }
    }
}
