//! Concurrent verified callbacks converge on one stable identity across database connections.
use crate::support::TestDb;
use desire_api::auth::session;
use desire_persistence::{Account, IdentityRepository, NewSession};
use std::sync::{Arc, Barrier};

fn complete_callback(mut client: postgres::Client, barrier: Arc<Barrier>) -> String {
    let account = Account {
        id: desire_persistence::next_id(&mut client).unwrap(),
        issuer: "https://fixture.example.test".into(),
        subject: "shared-subject".into(),
        email: "shared@example.test".into(),
    };
    let hash = session::token_hash(&session::random_token().unwrap());
    barrier.wait();
    let stored = NewSession {
        token_hash: &hash,
        seconds: session::SESSION_SECONDS,
    };
    IdentityRepository::sign_in(&mut client, &account, &stored).unwrap();
    IdentityRepository::session_account(&mut client, &hash)
        .unwrap()
        .unwrap()
        .0
}

#[test]
fn simultaneous_callbacks_create_one_account_and_two_valid_sessions() {
    let db = TestDb::new();
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [db.connection(), db.connection()]
        .into_iter()
        .map(|client| {
            let barrier = barrier.clone();
            std::thread::spawn(move || complete_callback(client, barrier))
        })
        .collect();
    let users: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(users[0], users[1]);
    let row = db
        .connection()
        .query_one(
            concat!(
                "SELECT (SELECT count(*) FROM identity.accounts), ",
                "(SELECT count(*) FROM identity.sessions)"
            ),
            &[],
        )
        .unwrap();
    assert_eq!(row.get::<_, i64>(0), 1);
    assert_eq!(row.get::<_, i64>(1), 2);
}
