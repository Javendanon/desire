//! The binary retains redacted persistence diagnostics correlated to HTTP request IDs.
use crate::{
    server,
    support::{self, TestDb, id},
};
use serde_json::json;
use std::{
    io::Read,
    process::{Child, Command, Stdio},
};

struct Fixture {
    db: TestDb,
    port: u16,
    child: Child,
}

impl Fixture {
    fn new() -> Self {
        let db = TestDb::new();
        db.connection()
            .batch_execute(
                "ALTER TABLE campaign.campaigns ADD CONSTRAINT secret_name \
            CHECK (name <> 'private-source-value')",
            )
            .unwrap();
        let port = server::free_port();
        let mut child = Command::new(env!("CARGO_BIN_EXE_desire-api"))
            .env("DATABASE_URL", db.url())
            .env("DESIRE_DEV_IDENTITY", "1")
            .env("HOST", "127.0.0.1")
            .env("PORT", port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        server::wait_until_ready(port, &mut child);
        Self { db, port, child }
    }

    fn missing_table(&self) -> String {
        self.db
            .connection()
            .batch_execute("ALTER TABLE campaign.campaigns RENAME TO unavailable_campaigns")
            .unwrap();
        server::request(
            self.port,
            &format!(
                "GET /api/v1/campaigns HTTP/1.1\r\n\
            Host:127.0.0.1\r\nx-desire-user:{}\r\nx-request-id:{}\r\nConnection:close\r\n\r\n",
                id(90),
                id(501)
            ),
        )
    }

    fn finish(mut self) -> String {
        Command::new("kill")
            .arg("-INT")
            .arg(self.child.id().to_string())
            .status()
            .unwrap();
        let status = server::wait_for_exit(&mut self.child);
        let mut diagnostic = String::new();
        self.child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut diagnostic)
            .unwrap();
        assert!(status.success());
        diagnostic
    }
}

#[test]
fn persistence_diagnostics_keep_operation_and_sqlstate_without_source_values() {
    let fixture = Fixture::new();
    let invalid = create_campaign(fixture.port);
    let failed = fixture.missing_table();
    let diagnostic = fixture.finish();
    assert!(invalid.starts_with("HTTP/1.1 400"), "{invalid}");
    assert!(failed.starts_with("HTTP/1.1 500"), "{failed}");
    assert!(
        diagnostic.contains("list campaigns for member"),
        "{diagnostic}"
    );
    for code in ["23514", "42P01"] {
        assert!(diagnostic.contains(code), "{diagnostic}");
    }
    for request_id in [id(500), id(501)] {
        assert!(diagnostic.contains(&request_id));
    }
    assert!(!diagnostic.contains("private-source-value"));
    assert!(!failed.contains("42P01"));
    assert!(!failed.contains("unavailable_campaigns"));
}

fn create_campaign(port: u16) -> String {
    let body = json!({"name":"private-source-value", "rules_edition":"dnd_2014",
        "city_id":support::id(3)})
    .to_string();
    server::request(
        port,
        &format!(
            "POST /api/v1/campaigns HTTP/1.1\r\nHost:127.0.0.1\r\n\
        x-desire-user:{}\r\nx-request-id:{}\r\ncontent-type:application/json\r\n\
        content-length:{}\r\nConnection:close\r\n\r\n{body}",
            id(90),
            id(500),
            body.len()
        ),
    )
}
