//! The real binary verifies startup policy, session authorization and signal shutdown.
use crate::support;
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use support::{TestDb, id};

const START_TIMEOUT: Duration = Duration::from_secs(20);
const EXIT_TIMEOUT: Duration = Duration::from_secs(20);

/// Child servers must never inherit real provider settings from the operator's shell.
pub(super) fn command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_desire-api"));
    for name in [
        "DESIRE_OIDC_ISSUER",
        "DESIRE_OIDC_CLIENT_ID",
        "DESIRE_OIDC_CLIENT_SECRET",
        "DESIRE_PUBLIC_URL",
        "DESIRE_ALLOWED_EMAILS",
        "DESIRE_DEV_IDENTITY",
    ] {
        command.env_remove(name);
    }
    command
}

#[test]
fn child_servers_remove_inherited_oidc_configuration() {
    let command = command();
    for name in [
        "DESIRE_OIDC_ISSUER",
        "DESIRE_OIDC_CLIENT_ID",
        "DESIRE_OIDC_CLIENT_SECRET",
        "DESIRE_PUBLIC_URL",
        "DESIRE_ALLOWED_EMAILS",
        "DESIRE_DEV_IDENTITY",
    ] {
        assert!(
            command
                .get_envs()
                .any(|(key, value)| key == name && value.is_none())
        );
    }
}

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

fn json_body(response: &str) -> Value {
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("");
    serde_json::from_str(body).unwrap_or(Value::Null)
}

#[derive(Default)]
struct HttpRequest<'a> {
    method: &'a str,
    path: &'a str,
    token: Option<&'a str>,
    caller: Option<&'a str>,
    body: Option<&'a str>,
}

fn call(port: u16, input: HttpRequest<'_>) -> String {
    let mut head = format!(
        "{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n",
        input.method, input.path
    );
    if let Some(token) = input.token {
        head.push_str(&format!("cookie: __Host-desire-session={token}\r\n"));
        head.push_str("origin: https://table.example.test\r\n");
    }
    if let Some(caller) = input.caller {
        head.push_str(&format!("x-desire-user: {caller}\r\n"));
    }
    match input.body {
        Some(body) => {
            head.push_str("content-type: application/json\r\n");
            head.push_str(&format!("content-length: {}\r\n\r\n{body}", body.len()));
        }
        None => head.push_str("\r\n"),
    }
    request(port, &head)
}

/// OIDC has its own full-flow tests; this regression seeds sessions for binary authorization.
fn account(db: &TestDb, subject: &str) -> Value {
    let mut client = db.connection();
    let account = desire_persistence::Account {
        id: desire_persistence::next_id(&mut client).unwrap(),
        issuer: "https://fixture.example.test".into(),
        subject: subject.into(),
        email: format!("{subject}@example.test"),
    };
    let token = desire_api::auth::session::random_token().unwrap();
    let hash = desire_api::auth::session::token_hash(&token);
    let stored = desire_persistence::NewSession {
        token_hash: &hash,
        seconds: desire_api::auth::session::SESSION_SECONDS,
    };
    desire_persistence::IdentityRepository::sign_in(&mut client, &account, &stored).unwrap();
    serde_json::json!({"token": token, "user_id": account.id})
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

fn assert_default_identity_policy(port: u16) {
    let health = call(
        port,
        HttpRequest {
            method: "GET",
            path: "/api/health",
            ..Default::default()
        },
    );
    assert!(health.starts_with("HTTP/1.1 200"), "{health}");
    assert!(health.contains("\"status\":\"ok\""), "{health}");
    let header_only = call(
        port,
        HttpRequest {
            method: "GET",
            path: "/api/v1/campaigns",
            caller: Some(&id(90)),
            ..Default::default()
        },
    );
    assert!(header_only.starts_with("HTTP/1.1 401"), "{header_only}");
    assert!(
        header_only.contains("\"code\":\"unauthenticated\""),
        "{header_only}"
    );
}

fn campaign_with_player(port: u16, owner: &Value, player: &Value) -> String {
    let token = owner["token"].as_str();
    let response = call(
        port,
        HttpRequest {
            method: "POST",
            path: "/api/v1/campaigns",
            token,
            body: Some(r#"{"name":"Synthetic","rules_edition":"dnd_2014","city_id":null}"#),
            ..Default::default()
        },
    );
    assert!(response.starts_with("HTTP/1.1 201"), "{response}");
    let created = json_body(&response);
    let campaign = created["id"].as_str().unwrap();
    let body = format!(
        r#"{{"user_id":"{}","role":"player"}}"#,
        player["user_id"].as_str().unwrap()
    );
    let member = call(
        port,
        HttpRequest {
            method: "POST",
            path: &format!("/api/v1/campaigns/{campaign}/members"),
            token,
            body: Some(&body),
            ..Default::default()
        },
    );
    assert!(member.starts_with("HTTP/1.1 201"), "{member}");
    campaign.into()
}

fn assert_player_cannot_impersonate(port: u16, db: &TestDb) {
    let owner = account(db, "dungeon-master");
    let player = account(db, "player");
    let campaign = campaign_with_player(port, &owner, &player);
    let path = format!("/api/v1/campaigns/{campaign}");
    let rename = call(
        port,
        HttpRequest {
            method: "PATCH",
            path: &path,
            token: player["token"].as_str(),
            caller: owner["user_id"].as_str(),
            body: Some(r#"{"name":"Denied","expected_revision":1}"#),
        },
    );
    assert!(rename.starts_with("HTTP/1.1 403"), "{rename}");
    assert!(rename.contains("\"code\":\"forbidden\""), "{rename}");
    let sync = call(
        port,
        HttpRequest {
            method: "GET",
            path: &format!("{path}/sync"),
            token: player["token"].as_str(),
            caller: owner["user_id"].as_str(),
            body: None,
        },
    );
    assert!(sync.starts_with("HTTP/1.1 200"), "{sync}");
    assert_eq!(json_body(&sync)["role"], "player");
}

#[test]
#[cfg(unix)]
fn the_binary_serves_an_authenticated_route_and_stops_on_a_signal() {
    let db = TestDb::new();
    let port = free_port();
    let provider = crate::oidc_provider::Provider::start();
    let settings = provider.settings();
    let mut child = configured_command(&db, port, &settings).spawn().unwrap();
    wait_until_ready(port, &mut child);
    assert_default_identity_policy(port);
    assert_player_cannot_impersonate(port, &db);
    let signalled = Command::new("kill")
        .arg("-INT")
        .arg(child.id().to_string())
        .status()
        .unwrap();
    assert!(signalled.success(), "the signal could not be sent");
    let status = wait_for_exit(&mut child);
    assert!(status.success(), "the server exited with {status}");
}

fn configured_command(
    db: &TestDb,
    port: u16,
    settings: &desire_api::auth::settings::Settings,
) -> Command {
    let mut command = command();
    command
        .env("DATABASE_URL", db.url())
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DESIRE_OIDC_ISSUER", settings.issuer.as_str())
        .env("DESIRE_OIDC_CLIENT_ID", &settings.client_id)
        .env("DESIRE_OIDC_CLIENT_SECRET", settings.client_secret.secret())
        .env("DESIRE_PUBLIC_URL", settings.public_url.as_str())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}
