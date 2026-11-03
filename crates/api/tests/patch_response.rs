//! PATCH returns its committed row even when a queued writer changes it before a reread.
use crate::support::{self, TestDb, call, id, uri};
use axum::http::{Method, StatusCode};
use desire_api::{AppState, app};
use postgres::Client;
use serde_json::{Value, json};
use std::{
    thread,
    time::{Duration, Instant},
};

struct Fixture {
    db: TestDb,
    owner: String,
    path: String,
    record_id: String,
    table: &'static str,
    column: &'static str,
    body: Value,
}

type NoteFixture = (&'static str, &'static str, Value, String, String);
type Build = fn(&axum::Router, &str, &str) -> NoteFixture;

impl Fixture {
    fn new(build: Build) -> Self {
        let db = TestDb::new();
        let router = support::app_for(&db);
        let owner = id(90);
        let campaign_id = support::run(support::campaign(&router, &owner));
        let (table, column, body, record_id, suffix) = build(&router, &campaign_id, &owner);
        Self {
            db,
            owner,
            path: uri(&campaign_id, &suffix),
            record_id,
            table,
            column,
            body,
        }
    }
}

fn campaign(_router: &axum::Router, campaign: &str, _owner: &str) -> NoteFixture {
    (
        "campaign.campaigns",
        "name",
        json!({"name":"Our edit", "expected_revision":1}),
        campaign.to_owned(),
        String::new(),
    )
}

fn journal(router: &axum::Router, campaign: &str, owner: &str) -> NoteFixture {
    let session = support::run(support::create_session(router, campaign, owner));
    let row = support::run(support::create_journal(
        router,
        campaign,
        owner,
        session["id"].as_str().unwrap(),
        "players",
    ));
    let id = row["id"].as_str().unwrap().to_owned();
    (
        "campaign.journal_entries",
        "body",
        json!({"body":"Our edit", "visibility":"players", "expected_revision":1}),
        id.clone(),
        format!("/journal/{id}"),
    )
}

fn knowledge(router: &axum::Router, campaign: &str, owner: &str) -> NoteFixture {
    let row = support::run(support::create_knowledge(
        router, campaign, owner, "players",
    ));
    let id = row["id"].as_str().unwrap().to_owned();
    (
        "campaign.knowledge",
        "body",
        json!({"title":"Lore", "body":"Our edit", "visibility":"players",
            "provenance":support::provenance(), "expected_revision":1}),
        id.clone(),
        format!("/knowledge/{id}"),
    )
}

fn wait_for_lock(client: &mut Client, application: &str) -> bool {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let blocked: bool = client
            .query_one(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() \
             AND application_name = $1 AND wait_event_type = 'Lock')",
                &[&application],
            )
            .unwrap()
            .get(0);
        if blocked {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    false
}

fn patch(f: &Fixture) -> thread::JoinHandle<support::Response> {
    let mut client = f.db.connection();
    client
        .batch_execute("SET application_name = 'd09_patch_response'")
        .unwrap();
    let (path, owner, body) = (f.path.clone(), f.owner.clone(), f.body.clone());
    thread::spawn(move || {
        let router = app(AppState::from_client(client));
        support::run(call(
            &router,
            Method::PATCH,
            &path,
            Some(&owner),
            Some(body),
        ))
    })
}

fn queued_writer(f: &Fixture) -> thread::JoinHandle<()> {
    let mut client = f.db.connection();
    client
        .batch_execute("SET application_name = 'd09_later_write'")
        .unwrap();
    let (table, column, id) = (f.table, f.column, f.record_id.clone());
    thread::spawn(move || {
        let mut tx = client.transaction().unwrap();
        tx.batch_execute(&format!("LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE"))
            .unwrap();
        tx.execute(
            &format!(
                "UPDATE {table} SET {column} = 'Later edit', revision = revision + 1 \
            WHERE id = $1::text::uuid"
            ),
            &[&id],
        )
        .unwrap();
        tx.commit().unwrap();
    })
}

fn assert_later_write_kept(f: &Fixture, observer: &mut Client) {
    let row = observer
        .query_one(
            &format!(
                "SELECT revision, {} FROM {} WHERE id = $1::text::uuid",
                f.column, f.table
            ),
            &[&f.record_id],
        )
        .unwrap();
    assert_eq!(row.get::<_, i64>(0), 3);
    assert_eq!(row.get::<_, String>(1), "Later edit");
}

fn assert_own_edit(f: &Fixture, response: &support::Response) {
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    let reported = &response.body;
    assert_eq!(reported["revision"], 2, "{}: {reported}", f.table);
    assert_eq!(reported[f.column], "Our edit");
}

fn race(build: Build) {
    let f = Fixture::new(build);
    let mut observer = f.db.connection();
    let mut blocker = f.db.connection();
    let mut tx = blocker.transaction().unwrap();
    let lock = format!(
        "SELECT 1 FROM {} WHERE id = $1::text::uuid FOR UPDATE",
        f.table
    );
    tx.query_one(&lock, &[&f.record_id]).unwrap();
    let request = patch(&f);
    let patch_waited = wait_for_lock(&mut observer, "d09_patch_response");
    let writer = queued_writer(&f);
    let writer_queued = wait_for_lock(&mut observer, "d09_later_write");
    tx.commit().unwrap();
    writer.join().unwrap();
    let response = request.join().unwrap();
    assert!(
        patch_waited && writer_queued,
        "interleaving not established"
    );
    assert_own_edit(&f, &response);
    assert_later_write_kept(&f, &mut observer);
}

#[test]
fn campaign_patch_returns_its_own_committed_revision() {
    race(campaign);
}

#[test]
fn journal_patch_returns_its_own_committed_revision() {
    race(journal);
}

#[test]
fn knowledge_patch_returns_its_own_committed_revision() {
    race(knowledge);
}

#[test]
fn patch_responses_equal_a_later_get() {
    for build in [campaign as Build, journal, knowledge] {
        let f = Fixture::new(build);
        let router = support::app_for(&f.db);
        let body = Some(f.body.clone());
        let patched = support::run(call(&router, Method::PATCH, &f.path, Some(&f.owner), body));
        let read = support::run(call(&router, Method::GET, &f.path, Some(&f.owner), None));
        assert_eq!(patched.status, StatusCode::OK, "{}", patched.body);
        assert_eq!(patched.body, read.body);
    }
}
