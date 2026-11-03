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
        support::run(support::member(&app, &campaign, &owner, &player, "player"));
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
            Method::PATCH,
            &uri(&self.campaign, &format!("/characters/{}", self.character)),
            Some(&self.owner),
            Some(body),
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
