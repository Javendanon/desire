//! The real listener uses peer IP unless a deployment explicitly trusts an IP header.
use crate::{
    oidc_provider::Provider,
    server::{configured_command, free_port, request, wait_for_exit, wait_until_ready},
    support::TestDb,
};
use std::process::{Child, Command};

fn login(port: u16, headers: &str) -> String {
    request(
        port,
        &format!(
            "GET /api/v1/auth/login HTTP/1.1\r\nHost: localhost\r\n\
             Connection: close\r\n{headers}\r\n"
        ),
    )
}

fn assert_status(response: &str, status: u16) {
    assert!(response.starts_with(&format!("HTTP/1.1 {status}")), "{response}");
    assert!(response.contains("cache-control: no-store"), "{response}");
}

struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        self.0.wait().unwrap();
    }
}

fn stop(child: &mut Child) {
    assert!(
        Command::new("kill")
            .arg("-INT")
            .arg(child.id().to_string())
            .status()
            .unwrap()
            .success()
    );
    assert!(wait_for_exit(child).success());
}

#[test]
#[cfg(unix)]
fn proxy_client_ip_headers_require_explicit_trust() {
    let db = TestDb::new();
    let provider = Provider::start();
    for trusted in [false, true] {
        let port = free_port();
        let mut command = configured_command(&db, port, &provider.settings());
        if trusted {
            command.env("DESIRE_TRUSTED_CLIENT_IP_HEADER", "Fly-Client-IP");
        }
        let mut child = Server(command.spawn().unwrap());
        wait_until_ready(port, &mut child.0);
        assert_proxy_admission(port, trusted);
        stop(&mut child.0);
    }
}

fn assert_proxy_admission(port: u16, trusted: bool) {
    for suffix in 1..=8 {
        let headers = format!("Fly-Client-IP: 192.0.2.1\r\nX-Forwarded-For: 198.51.100.{suffix}\r\n");
        assert_status(&login(port, &headers), 303);
    }
    assert_status(&login(port, "Fly-Client-IP: 192.0.2.1\r\n"), 429);
    let other = login(port, "Fly-Client-IP: 192.0.2.2\r\n");
    assert_status(&other, if trusted { 303 } else { 429 });
    if trusted {
        assert_invalid_proxy_headers(port);
    }
}

fn assert_invalid_proxy_headers(port: u16) {
    for headers in [
        "",
        "Fly-Client-IP: invalid\r\n",
        "Fly-Client-IP: 192.0.2.3, 192.0.2.4\r\n",
        "Fly-Client-IP: 192.0.2.3\r\nFly-Client-IP: 192.0.2.4\r\n",
    ] {
        assert_status(&login(port, headers), 400);
    }
    for _ in 0..7 {
        assert_status(&login(port, "Fly-Client-IP: ::ffff:192.0.2.2\r\n"), 303);
    }
    assert_status(&login(port, "Fly-Client-IP: 192.0.2.2\r\n"), 429);
    assert_status(&login(port, "Fly-Client-IP: 2001:db8::1\r\n"), 303);
}
