//! The real binary: startup against the disposable cluster, an authenticated request and a
//! clean signal shutdown. The router tests never exercise `main`, so this covers it.
mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use support::{TestDb, id};

const START_TIMEOUT: Duration = Duration::from_secs(20);
const EXIT_TIMEOUT: Duration = Duration::from_secs(20);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn request(port: u16, head: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(head.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

fn get(port: u16, path: &str, identity: Option<&str>) -> String {
    let identity = identity
        .map(|id| format!("x-desire-user: {id}\r\n"))
        .unwrap_or_default();
    request(
        port,
        &format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n{identity}\r\n"),
    )
}

fn wait_until_ready(port: u16, child: &mut Child) {
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("the server exited before serving: {status}");
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("the server did not listen on port {port} within {START_TIMEOUT:?}");
}

fn wait_for_exit(child: &mut Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + EXIT_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    panic!("the server did not stop within {EXIT_TIMEOUT:?}");
}

#[test]
#[cfg(unix)]
fn the_binary_serves_an_authenticated_route_and_stops_on_a_signal() {
    let db = TestDb::new();
    let port = free_port();
    let mut child = Command::new(env!("CARGO_BIN_EXE_desire-api"))
        .env("DATABASE_URL", db.url())
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    wait_until_ready(port, &mut child);

    let health = get(port, "/api/health", None);
    assert!(health.starts_with("HTTP/1.1 200"), "{health}");
    assert!(health.contains("\"status\":\"ok\""), "{health}");

    let campaigns = get(port, "/api/v1/campaigns", Some(&id(90)));
    assert!(campaigns.starts_with("HTTP/1.1 200"), "{campaigns}");
    assert!(campaigns.contains("\"items\":[]"), "{campaigns}");

    // Ctrl+C is the documented stop path: the client must close off the server runtime.
    let signalled = Command::new("kill")
        .arg("-INT")
        .arg(child.id().to_string())
        .status()
        .unwrap();
    assert!(signalled.success(), "the signal could not be sent");
    let status = wait_for_exit(&mut child);
    assert!(status.success(), "the server exited with {status}");
}
