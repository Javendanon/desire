//! Character edits advance the actor revision atomically, including rejected writes.
use crate::support::{self, TestDb, call, id, uri};
use axum::{
    Router,
    http::{Method, StatusCode},
};
use serde_json::{Value, json};

struct Fixture {
    db: TestDb,
    app: Router,
    owner: String,
    player: String,
    campaign: String,
    character: String,
}

impl Fixture {
    fn new() -> Self {
        let db = TestDb::new();
        let app = support::app_for(&db);
        let owner = id(90);
        let player = id(91);
        let campaign = support::run(support::campaign(&app, &owner));
        support::run(support::member(
            support::Actor::new(&app, &campaign, &owner),
            &player,
            "player",
        ));
        let created = support::run(support::create_character(&app, &campaign, &owner));
        let character = created["id"].as_str().unwrap().to_owned();
        Self {
            db,
            app,
            owner,
            player,
            campaign,
            character,
        }
    }

    fn patch(&self, body: Value) -> support::Response {
        support::run(call(
            &self.app,
            support::ApiCall::new(
                Method::PATCH,
                &uri(&self.campaign, &format!("/characters/{}", self.character)),
            )
            .by(&self.owner)
            .json(body),
        ))
    }

    fn rows(&self) -> (Value, Value) {
        let row = self
            .db
            .connection()
            .query_one(
                "SELECT to_jsonb(c), to_jsonb(a) FROM campaign.characters c \
             JOIN campaign.actors a ON a.campaign_id = c.campaign_id AND a.id = c.id \
             WHERE c.campaign_id = $1::text::uuid AND c.id = $2::text::uuid",
                &[&self.campaign, &self.character],
            )
            .unwrap();
        (row.get(0), row.get(1))
    }
}

#[test]
fn character_controller_edits_advance_the_actor_revision() {
    let f = Fixture::new();
    assert_eq!(f.rows().1["revision"], 1);
    let assigned = f.patch(json!({"name":"Assigned", "controller_id":f.player,
        "expected_revision":1}));
    assert_eq!(assigned.status, StatusCode::OK);
    let (character, actor) = f.rows();
    assert_eq!(character["revision"], 2);
    assert_eq!(actor["revision"], 2);
    assert_eq!(actor["name"], "Assigned");
    assert_eq!(actor["kind"], "character");
    assert_eq!(actor["visibility"], "players");
    let cleared = f.patch(json!({"name":"Cleared", "controller_id":null,
        "expected_revision":2}));
    assert_eq!(cleared.status, StatusCode::OK);
    let (character, actor) = f.rows();
    assert_eq!(character["revision"], 3);
    assert_eq!(actor["revision"], 3);
    assert_eq!(actor["name"], "Cleared");
    assert_eq!(actor["kind"], "npc");
    assert_eq!(actor["visibility"], "dm");
}

#[test]
fn failed_actor_write_rolls_back_both_records_and_their_revisions() {
    let f = Fixture::new();
    let before = f.rows();
    f.db.connection()
        .batch_execute(
            "ALTER TABLE campaign.actors ADD CONSTRAINT reject_test_name \
         CHECK (name <> 'Rejected')",
        )
        .unwrap();
    let rejected = f.patch(json!({"name":"Rejected", "controller_id":f.player,
        "expected_revision":1}));
    assert_eq!(
        rejected.status,
        StatusCode::BAD_REQUEST,
        "{}",
        rejected.body
    );
    assert_eq!(f.rows(), before);
    let stale = f.patch(json!({"name":"Stale", "controller_id":null,
        "expected_revision":9}));
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(f.rows(), before);
}

/// Each statement holds its locks until this request is already waiting on them.
const OTHER_DELETION: [&str; 4] = [
    "DELETE FROM campaign.actor_stats WHERE actor_id = $1::text::uuid",
    "DELETE FROM campaign.actor_state WHERE actor_id = $1::text::uuid",
    "DELETE FROM campaign.actors WHERE id = $1::text::uuid",
    "DELETE FROM campaign.characters WHERE id = $1::text::uuid",
];

fn late_delete(f: &Fixture) -> std::thread::JoinHandle<support::Response> {
    let mut client = f.db.connection();
    client
        .batch_execute("SET application_name = 'd09_late_delete'")
        .unwrap();
    let path = f.character_path();
    let owner = f.owner.clone();
    std::thread::spawn(move || {
        let router = desire_api::app(desire_api::AppState::from_client(client));
        let delete = support::ApiCall::new(Method::DELETE, &path).by(&owner);
        support::run(call(&router, delete))
    })
}

#[test]
fn losing_a_concurrent_deletion_returns_not_found() {
    let f = Fixture::new();
    let mut other = f.db.connection();
    let mut observer = f.db.connection();
    let mut tx = other.transaction().unwrap();
    for sql in OTHER_DELETION {
        tx.execute(sql, &[&f.character]).unwrap();
    }
    let request = late_delete(&f);
    let waited = crate::patch_response::wait_for_lock(&mut observer, "d09_late_delete");
    tx.commit().unwrap();
    let response = request.join().unwrap();
    assert!(waited, "the deletions must interleave");
    assert_eq!(response.status, StatusCode::NOT_FOUND, "{}", response.body);
}

impl Fixture {
    fn character_path(&self) -> String {
        uri(&self.campaign, &format!("/characters/{}", self.character))
    }

    fn presence(&self) -> (i64, i64) {
        let count = |table: &str| -> i64 {
            let sql = format!("SELECT count(*) FROM campaign.{table} WHERE id = $1::text::uuid");
            let mut client = self.db.connection();
            client.query_one(&sql, &[&self.character]).unwrap().get(0)
        };
        (count("characters"), count("actors"))
    }

    fn delete_at(&self, path: &str, caller: &str) -> support::Response {
        let delete = support::ApiCall::new(Method::DELETE, path).by(caller);
        support::run(call(&self.app, delete))
    }
}

#[test]
fn another_campaigns_dm_cannot_delete_a_character() {
    let f = Fixture::new();
    let stranger = id(92);
    let theirs = support::run(support::campaign(&f.app, &stranger));
    let path = uri(&theirs, &format!("/characters/{}", f.character));
    let response = f.delete_at(&path, &stranger);
    assert_eq!(response.status, StatusCode::NOT_FOUND, "{}", response.body);
    assert_eq!(
        f.presence(),
        (1, 1),
        "the character and its actor must remain"
    );
}

#[test]
fn a_referenced_character_rolls_back_its_actor_cleanup() {
    let f = Fixture::new();
    let mut client = f.db.connection();
    client
        .batch_execute(
            "CREATE TABLE character_reference (campaign_id uuid, id uuid, \
             FOREIGN KEY (campaign_id, id) REFERENCES campaign.characters (campaign_id, id))",
        )
        .unwrap();
    let reference = "INSERT INTO character_reference \
         VALUES ($1::text::uuid, $2::text::uuid)";
    client
        .execute(reference, &[&f.campaign, &f.character])
        .unwrap();
    let path = f.character_path();
    let blocked = f.delete_at(&path, &f.owner);
    assert_eq!(blocked.status, StatusCode::CONFLICT, "{}", blocked.body);
    assert_eq!(blocked.body["code"], "resource_in_use");
    assert_eq!(f.presence(), (1, 1), "the actor cleanup must roll back");
    client
        .batch_execute("DELETE FROM character_reference")
        .unwrap();
    let removed = f.delete_at(&path, &f.owner);
    assert_eq!(removed.status, StatusCode::NO_CONTENT, "{}", removed.body);
    assert_eq!(f.presence(), (0, 0));
}
