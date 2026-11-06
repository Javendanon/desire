//! Browser-shaped development and shared-bind startup policy checks use the real binary.
use crate::{
    server::{command, free_port, request, wait_for_exit, wait_until_ready},
    support::{TestDb, id},
};
use std::process::{Command, Stdio};

fn development_command(db: &TestDb, port: u16) -> Command {
    let mut command = command();
    command
        .env("DATABASE_URL", db.url())
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DESIRE_DEV_IDENTITY", "1")
        .env("DESIRE_PUBLIC_URL", "http://localhost:5173")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn assert_development_origins(port: u16) {
    for (origin, cookie, status) in [
        ("http://localhost:5173", "preference=dark", "201"),
        ("http://localhost:5173", "__Host-desire-session", "401"),
        (
            "http://localhost:5173",
            "__Host-desire-session=x; __Host-desire-session=y",
            "401",
        ),
        ("http://localhost:9999", "preference=dark", "403"),
        ("https://foreign.example.test", "preference=dark", "403"),
    ] {
        let body = r#"{"name":"Synthetic","rules_edition":"dnd_2014","city_id":null}"#;
        let response = request(
            port,
            &format!(
                "POST /api/v1/campaigns HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\
            Origin: {origin}\r\nCookie: {cookie}\r\n\
            x-desire-user: {}\r\nContent-Type: application/json\r\n\
            Content-Length: {}\r\n\r\n{body}",
                id(90),
                body.len(),
            ),
        );
        assert!(
            response.starts_with(&format!("HTTP/1.1 {status}")),
            "{response}"
        );
    }
}

#[test]
#[cfg(unix)]
fn browser_development_mutations_use_an_explicit_loopback_origin_without_oidc() {
    let db = TestDb::new();
    let port = free_port();
    let mut child = development_command(&db, port).spawn().unwrap();
    wait_until_ready(port, &mut child);
    assert_development_origins(port);
    assert!(
        Command::new("kill")
            .arg("-INT")
            .arg(child.id().to_string())
            .status()
            .unwrap()
            .success()
    );
    assert!(wait_for_exit(&mut child).success());
}

#[test]
fn oidc_and_development_identity_cannot_be_enabled_together() {
    let provider = crate::oidc_provider::Provider::start();
    let settings = provider.settings();
    for host in ["127.0.0.1", "::1", "0.0.0.0"] {
        let output = command()
            .env("HOST", host)
            .env("DESIRE_DEV_IDENTITY", "1")
            .env("DESIRE_OIDC_ISSUER", settings.issuer.as_str())
            .env("DESIRE_OIDC_CLIENT_ID", &settings.client_id)
            .env("DESIRE_OIDC_CLIENT_SECRET", settings.client_secret.secret())
            .env("DESIRE_PUBLIC_URL", settings.public_url.as_str())
            .env("DATABASE_URL", "postgres://desire_test@127.0.0.1:1/unused")
            .output()
            .unwrap();
        assert!(!output.status.success());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(
            error.contains("DESIRE_DEV_IDENTITY cannot be enabled with OpenID Connect"),
            "{host}: {error}"
        );
    }
}

#[test]
fn a_shared_bind_refuses_to_start_without_oidc_even_with_the_dev_opt_in() {
    let mut command = command();
    let output = command
        .env("HOST", "0.0.0.0")
        .env("DESIRE_DEV_IDENTITY", "1")
        .env("DATABASE_URL", "postgres://desire_test@127.0.0.1/unused")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("OpenID Connect is required for a non-loopback bind")
    );
}
