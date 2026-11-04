//! Player projections filter visibility in SQL and never join the private schema.
use crate::{
    Error,
    error::Context,
    reads::{self, Audience, CampaignRead, FetchPage, ListRead, RecordTarget},
    realtime::RealtimeRepository,
    records,
};
use desire_core::contracts::common::{Provenance, Visibility};
use desire_core::contracts::{
    campaign::{CampaignKnowledge, JournalEntry, Session},
    transport::{PlayerJournalEntry, PlayerKnowledge},
};
use postgres::Client;

mod crud;
pub use crud::{JournalUpdate, KnowledgeUpdate};

pub struct NotesRepository;

impl NotesRepository {
    pub fn create_session(client: &mut Client, session: &Session) -> Result<(), Error> {
        records::insert(client, "campaign.sessions", session)
    }

    pub fn create_journal(client: &mut Client, entry: &JournalEntry) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin journal creation")?;
        records::insert(&mut tx, "campaign.journal_entries", entry)?;
        RealtimeRepository::advance_stream(&mut tx, &entry.campaign_id)?;
        tx.commit()
            .context(format!("commit journal entry {}", entry.id))
    }

    pub fn create_knowledge(client: &mut Client, entry: &CampaignKnowledge) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin knowledge creation")?;
        records::insert(&mut tx, "campaign.knowledge", entry)?;
        RealtimeRepository::advance_stream(&mut tx, &entry.campaign_id)?;
        tx.commit()
            .context(format!("commit knowledge entry {}", entry.id))
    }

    pub fn player_journal(
        client: &mut Client,
        campaign: &str,
    ) -> Result<Vec<PlayerJournalEntry>, Error> {
        let rows = client
            .query(
                concat!(
                    "SELECT to_jsonb(j) - 'visibility' FROM campaign.journal_entries j ",
                    "WHERE campaign_id = $1::text::uuid AND visibility = 'players' ORDER BY id"
                ),
                &[&campaign],
            )
            .context(format!("read player journal for campaign {campaign}"))?;
        records::decode_all(rows)
    }

    pub fn player_knowledge(
        client: &mut Client,
        campaign: &str,
    ) -> Result<Vec<PlayerKnowledge>, Error> {
        let rows = client
            .query(
                concat!(
                    "SELECT to_jsonb(k) - 'visibility' FROM campaign.knowledge k ",
                    "WHERE campaign_id = $1::text::uuid AND visibility = 'players' ORDER BY id"
                ),
                &[&campaign],
            )
            .context(format!("read player knowledge for campaign {campaign}"))?;
        records::decode_all(rows)
    }
}
