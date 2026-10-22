//! Concurrent membership changes cannot empty a journey; place entry cannot respawn a population.
mod support;
#[path = "tabletop/support.rs"]
mod tabletop;
use desire_persistence::{PopulationActivation, PresenceRepository};
use postgres::IsolationLevel;
use std::sync::{Arc, Barrier};
use std::thread;

fn delete_participant(
    name: String,
    actor: u64,
    isolation: IsolationLevel,
    barrier: Arc<Barrier>,
) -> bool {
    let mut db = support::connect(&name);
    let mut tx = db
        .build_transaction()
        .isolation_level(isolation)
        .start()
        .unwrap();
    tx.query_one("SELECT count(*) FROM campaign.travel_participants", &[])
        .unwrap();
    tx.execute(
        "DELETE FROM campaign.travel_participants WHERE actor_id = $1::text::uuid",
        &[&support::id(actor)],
    )
    .unwrap();
    barrier.wait();
    tx.commit().is_ok()
}

#[test]
fn read_committed_cannot_delete_the_last_two_members_concurrently() {
    check_deletions(IsolationLevel::ReadCommitted);
}

#[test]
fn repeatable_read_cannot_delete_the_last_two_members_concurrently() {
    check_deletions(IsolationLevel::RepeatableRead);
}

fn check_deletions(isolation: IsolationLevel) {
    let mut db = tabletop::database();
    db.batch_execute(include_str!("tabletop/journeys.sql"))
        .unwrap();
    let name: String = db
        .query_one("SELECT current_database()", &[])
        .unwrap()
        .get(0);
    let barrier = Arc::new(Barrier::new(2));
    let mut workers = Vec::new();
    for actor in [201, 202] {
        let name = name.clone();
        let barrier = barrier.clone();
        workers.push(thread::spawn(move || {
            delete_participant(name, actor, isolation, barrier)
        }));
    }
    let successes = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .filter(|ok| *ok)
        .count();
    assert_eq!(
        successes, 1,
        "one deletion must fail instead of committing an empty journey"
    );
    assert_eq!(
        db.query_one("SELECT count(*) FROM campaign.travel_participants", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
}

#[test]
fn simultaneous_place_entries_return_the_same_population() {
    let mut db = tabletop::population_database();
    let name: String = db
        .query_one("SELECT current_database()", &[])
        .unwrap()
        .get(0);
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = [900, 910]
        .into_iter()
        .map(|first| {
            let name = name.clone();
            let barrier = barrier.clone();
            thread::spawn(move || activate_population(&name, first, &barrier))
        })
        .collect();
    let results: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(results[0], results[1]);
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM campaign.population_spawned_actors",
            &[]
        )
        .unwrap()
        .get::<_, i64>(0),
        2
    );
}

fn activate_population(name: &str, first: u64, barrier: &Barrier) -> Vec<String> {
    let mut db = support::connect(name);
    db.batch_execute("SET default_transaction_isolation = 'repeatable read'")
        .unwrap();
    let ids = [support::id(first), support::id(first + 1)];
    barrier.wait();
    PresenceRepository::activate_for_dm(
        &mut db,
        &PopulationActivation {
            campaign_id: &support::id(10),
            rule_id: &support::id(450),
            actor_ids: &ids,
        },
    )
    .unwrap()
    .into_iter()
    .map(|actor| actor.id)
    .collect()
}
