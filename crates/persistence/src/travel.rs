//! Group journeys preserve departure participants independently from later party membership.
use crate::{Error, ErrorKind, error::Context, records};
use desire_core::contracts::adventure::{GroupTravel, Party, PartyMember};
use postgres::{Client, GenericClient};
use serde_json::{Value, json};
use std::collections::HashSet;

pub struct PartyRepository;
impl PartyRepository {
    pub fn create(client: &mut Client, party: &Party) -> Result<(), Error> {
        records::insert(client, "campaign.parties", party)
    }
    pub fn add_member(client: &mut Client, member: &PartyMember) -> Result<(), Error> {
        records::insert(client, "campaign.party_members", member)
    }
}

pub struct TravelRepository;
impl TravelRepository {
    pub fn create(client: &mut Client, travel: &GroupTravel) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin group travel")?;
        insert_travel(&mut tx, travel)?;
        tx.commit().context("commit group travel")
    }

    pub fn start_from_party(
        client: &mut Client,
        draft: &GroupTravel,
    ) -> Result<GroupTravel, Error> {
        let party = draft
            .party_id
            .as_deref()
            .ok_or_else(|| Error::new(ErrorKind::Conflict, "party journey requires a party"))?;
        let mut tx = client.transaction().context("begin party departure")?;
        let rows = tx.query(concat!(
            "SELECT actor_id::text FROM campaign.party_members ",
            "WHERE campaign_id = $1::text::uuid AND party_id = $2::text::uuid ORDER BY actor_id"
        ), &[&draft.campaign_id, &party]).context("snapshot party membership")?;
        let mut travel = draft.clone();
        travel.participants = rows.iter().map(|row| row.get(0)).collect();
        insert_travel(&mut tx, &travel)?;
        tx.commit().context("commit party departure")?;
        Ok(travel)
    }

    pub fn get_for_dm(
        client: &mut Client,
        campaign: &str,
        id: &str,
    ) -> Result<Option<GroupTravel>, Error> {
        client
            .query_opt(include_str!("queries/group_travel.sql"), &[&campaign, &id])
            .context("read group travel")?
            .map(records::decode)
            .transpose()
    }
}

/// Write a journey and every participant atomically; O(participants).
fn insert_travel(tx: &mut impl GenericClient, travel: &GroupTravel) -> Result<(), Error> {
    let unique: HashSet<_> = travel.participants.iter().collect();
    if travel.protocol_version != 2
        || travel.participants.is_empty()
        || unique.len() != travel.participants.len()
    {
        return Err(Error::new(
            ErrorKind::Conflict,
            "v2 travel requires distinct participants",
        ));
    }
    records::insert(tx, "campaign.travels", &travel_row(travel)?)?;
    for actor in &travel.participants {
        tx.execute(
            concat!(
                "INSERT INTO campaign.travel_participants ",
                "VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid)"
            ),
            &[&travel.campaign_id, &travel.id, actor],
        )
        .context("record travel participant")?;
    }
    Ok(())
}

fn travel_row(travel: &GroupTravel) -> Result<Value, Error> {
    let mut data = serde_json::to_value(travel).context("encode group travel")?;
    let fields = data
        .as_object_mut()
        .expect("GroupTravel serializes as an object");
    for field in [
        "protocol_version",
        "participants",
        "position",
        "destination",
    ] {
        fields.remove(field);
    }
    for (prefix, position) in [
        ("", &travel.position),
        ("destination_", &travel.destination),
    ] {
        fields.insert(format!("{prefix}x_m"), json!(position.x_m));
        fields.insert(format!("{prefix}y_m"), json!(position.y_m));
        fields.insert(format!("{prefix}z_m"), json!(position.z_m));
    }
    Ok(data)
}
