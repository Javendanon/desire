//! The real binary: startup against the disposable cluster, authenticated requests and a
//! clean signal shutdown. The router tests never exercise `main`, so this covers it.
use crate::support;

use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use support::{TestDb, id};

const START_TIMEOUT: Duration = Duration::from_secs(20);
const EXIT_TIMEOUT: Duration = Duration::from_secs(20);
const PASSWORD: &str = "correct horse battery staple";

pub(super) fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub(super) fn request(port: u16, head: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(head.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

fn response_body(response: &str) -> &str {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("")
}

fn json_body(response: &str) -> Value {
    serde_json::from_str(response_body(response)).unwrap_or(Value::Null)
}

fn call(
    port: u16,
    method: &str,
    path: &str,
    token: Option<&str>,
    caller: Option<&str>,
    body: Option<&str>,
) -> String {
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
    if let Some(token) = token {
        head.push_str(&format!("authorization: Bearer {token}\r\n"));
    }
    if let Some(caller) = caller {
        head.push_str(&format!("x-desire-user: {caller}\r\n"));
    }
    match body {
        Some(body) => {
            head.push_str("content-type: application/json\r\n");
            head.push_str(&format!("content-length: {}\r\n\r\n{body}", body.len()));
        }
        None => head.push_str("\r\n"),
    }
    request(port, &head)
}

fn get(port: u16, path: &str) -> String {
    call(port, "GET", path, None, None, None)
}

fn account(port: u16, username: &str) -> Value {
    let body = format!(r#"{{"username":"{username}","password":"{PASSWORD}"}}"#);
    let response = call(
        port,
        "POST",
        "/api/v1/auth/accounts",
        None,
        None,
        Some(&body),
    );
    assert!(response.starts_with("HTTP/1.1 201"), "{response}");
    json_body(&response)
}

pub(super) fn wait_until_ready(port: u16, child: &mut Child) {
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

pub(super) fn wait_for_exit(child: &mut Child) -> std::process::ExitStatus {
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

    let health = get(port, "/api/health");
    assert!(health.starts_with("HTTP/1.1 200"), "{health}");
    assert!(health.contains("\"status\":\"ok\""), "{health}");

    // The default bind no longer trusts the development header, even on loopback.
    let header_only = call(port, "GET", "/api/v1/campaigns", None, Some(&id(90)), None);
    assert!(header_only.starts_with("HTTP/1.1 401"), "{header_only}");
    assert!(
        header_only.contains("\"code\":\"unauthenticated\""),
        "{header_only}"
    );

    let owner = account(port, "dungeon-master");
    let player = account(port, "player");
    let owner_token = owner["token"].as_str().unwrap();
    let player_token = player["token"].as_str().unwrap();
    let owner_id = owner["user_id"].as_str().unwrap();
    let player_id = player["user_id"].as_str().unwrap();
    let created = json_body(&call(
        port,
        "POST",
        "/api/v1/campaigns",
        Some(owner_token),
        None,
        Some(r#"{"name":"Synthetic","rules_edition":"dnd_2014","city_id":null}"#),
    ));
    let campaign = created["id"].as_str().unwrap();
    let member_body = format!(r#"{{"user_id":"{player_id}","role":"player"}}"#);
    let member = call(
        port,
        "POST",
        &format!("/api/v1/campaigns/{campaign}/members"),
        Some(owner_token),
        None,
        Some(&member_body),
    );
    assert!(member.starts_with("HTTP/1.1 201"), "{member}");

    // A player token keeps the player role even with the owner's header attached.
    let rename = call(
        port,
        "PATCH",
        &format!("/api/v1/campaigns/{campaign}"),
        Some(player_token),
        Some(owner_id),
        Some(r#"{"name":"Denied","expected_revision":1}"#),
    );
    assert!(rename.starts_with("HTTP/1.1 403"), "{rename}");
    assert!(rename.contains("\"code\":\"forbidden\""), "{rename}");
    let sync = call(
        port,
        "GET",
        &format!("/api/v1/campaigns/{campaign}/sync"),
        Some(player_token),
        Some(owner_id),
        None,
    );
    assert!(sync.starts_with("HTTP/1.1 200"), "{sync}");
    assert_eq!(json_body(&sync)["role"], "player");

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
