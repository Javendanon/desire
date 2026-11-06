//! Session expiry comes from the caller's duration; SQL holds no second copy of it.
#[allow(dead_code)] // shared fixtures; this target only needs the database helper
mod support;

use desire_persistence::{Account, IdentityRepository, NewSession, migrations};

const SHORT_SESSION_SECONDS: u64 = 90;
const TOLERANCE_SECONDS: f64 = 5.0;
const TOKEN_HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[test]
fn stored_expiry_honours_the_requested_session_duration() {
    let mut db = support::database();
    migrations::apply(&mut db).unwrap();
    let account = Account {
        id: desire_persistence::next_id(&mut db).unwrap(),
        issuer: "https://fixture.example.test".into(),
        subject: "short-lived-subject".into(),
        email: "short-lived@example.test".into(),
    };
    let session = NewSession {
        token_hash: TOKEN_HASH,
        seconds: SHORT_SESSION_SECONDS,
    };
    IdentityRepository::sign_in(&mut db, &account, &session).unwrap();
    let remaining: f64 = db
        .query_one(
            concat!(
                "SELECT extract(epoch FROM expires_at - now())::double precision ",
                "FROM identity.sessions WHERE token_hash = $1"
            ),
            &[&TOKEN_HASH],
        )
        .unwrap()
        .get(0);
    assert!(
        (remaining - SHORT_SESSION_SECONDS as f64).abs() < TOLERANCE_SECONDS,
        "expected about {SHORT_SESSION_SECONDS}s of session, stored {remaining}s"
    );
}
