//! Encounters reference existing actors; starting combat does not recreate their state.
use crate::{Error, ErrorKind, error::Context, records};
use desire_core::contracts::adventure::{Encounter, EncounterParticipant};
use postgres::Client;

pub struct EncounterRepository;
impl EncounterRepository {
    /// Create the encounter and its participants once, O(participants), in one transaction.
    pub fn create(
        client: &mut Client,
        encounter: &Encounter,
        participants: &[EncounterParticipant],
    ) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin encounter")?;
        records::insert(&mut tx, "campaign.encounters", encounter)?;
        for participant in participants {
            if participant.campaign_id != encounter.campaign_id
                || participant.encounter_id != encounter.id
            {
                return Err(Error::new(
                    ErrorKind::Conflict,
                    "participant outside encounter scope",
                ));
            }
            records::insert(&mut tx, "campaign.encounter_participants", participant)?;
        }
        tx.commit().context("commit encounter")
    }
}
