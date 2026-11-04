//! Campaign stream cursor and public scene events; no private note bodies enter the outbox.
use crate::{
    CampaignRead, CampaignRepository, CharacterRepository, Error, FetchPage, NotesRepository,
    SceneRepository, error::Context,
};
use desire_core::{
    PROTOCOL_VERSION,
    contracts::{
        campaign::{Campaign, CampaignKnowledge, Character, JournalEntry, Scene},
        transport::SceneChanged,
    },
};
use postgres::{Client, GenericClient, IsolationLevel};

pub struct RealtimeRepository;

/// One consistent snapshot: its rows and the cursor a client must resume from.
pub struct SnapshotRows {
    pub revision: u32,
    pub campaign: Campaign,
    pub scenes: Vec<Scene>,
    pub characters: Vec<Character>,
    pub journal: Vec<JournalEntry>,
    pub knowledge: Vec<CampaignKnowledge>,
}

/// A consistent cursor window: the current revision, retained event floor and replay rows.
pub struct EventWindow {
    pub revision: u32,
    pub oldest_scene: Option<u32>,
    pub events: Vec<SceneChanged>,
}

impl RealtimeRepository {
    /// A campaign with no write yet has revision zero.
    pub fn stream_revision(client: &mut impl GenericClient, campaign: &str) -> Result<u32, Error> {
        client
            .query_opt(
                "SELECT revision FROM campaign.streams WHERE campaign_id = $1::text::uuid",
                &[&campaign],
            )
            .context("read campaign stream revision")
            .map(|row| row.map_or(0, |row| row.get::<_, i64>(0) as u32))
    }

    /// Advances the shared cursor in the caller's transaction. Non-scene writes change the
    /// snapshot without an outbox row, so clients fall back to a fresh snapshot instead of
    /// silently skipping those revisions.
    pub fn advance_stream(tx: &mut impl GenericClient, campaign: &str) -> Result<u32, Error> {
        tx.execute(
            concat!(
                "INSERT INTO campaign.streams (campaign_id) VALUES ($1::text::uuid) ",
                "ON CONFLICT DO NOTHING"
            ),
            &[&campaign],
        )
        .context("initialize campaign stream")?;
        tx.query_one(
            concat!(
                "UPDATE campaign.streams SET revision = revision + 1 ",
                "WHERE campaign_id = $1::text::uuid RETURNING revision"
            ),
            &[&campaign],
        )
        .context("advance campaign stream")
        .map(|row| row.get::<_, i64>(0) as u32)
    }

    /// Reads the snapshot rows and its revision from one repeatable-read transaction.
    pub fn snapshot(
        client: &mut Client,
        read: CampaignRead<'_>,
        page: FetchPage,
    ) -> Result<Option<SnapshotRows>, Error> {
        let mut tx = client
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .context("begin campaign snapshot")?;
        let revision = Self::stream_revision(&mut tx, read.campaign_id)?;
        let Some(campaign) = CampaignRepository::get(&mut tx, read.campaign_id)? else {
            return Ok(None);
        };
        let scenes = SceneRepository::list(&mut tx, read.campaign_id, page)?;
        let characters = CharacterRepository::list(&mut tx, read, page)?;
        let journal = NotesRepository::list_journal(&mut tx, read, page)?;
        let knowledge = NotesRepository::list_knowledge(&mut tx, read, page)?;
        tx.commit().context("commit campaign snapshot")?;
        Ok(Some(SnapshotRows {
            revision,
            campaign,
            scenes,
            characters,
            journal,
            knowledge,
        }))
    }

    /// Reads the cursor, retained history floor and replay events from one transaction.
    pub fn event_window(
        client: &mut Client,
        campaign: &str,
        after: u32,
        limit: i64,
    ) -> Result<EventWindow, Error> {
        let mut tx = client
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .context("begin campaign event window")?;
        let revision = Self::stream_revision(&mut tx, campaign)?;
        let oldest_scene = Self::oldest_scene_revision(&mut tx, campaign)?;
        let events = Self::scene_events(&mut tx, campaign, after, limit)?;
        tx.commit().context("commit campaign event window")?;
        Ok(EventWindow {
            revision,
            oldest_scene,
            events,
        })
    }

    pub fn oldest_scene_revision(
        client: &mut impl GenericClient,
        campaign: &str,
    ) -> Result<Option<u32>, Error> {
        client
            .query_opt(
                concat!(
                    "SELECT min(stream_revision)::bigint FROM campaign.outbox ",
                    "WHERE campaign_id = $1::text::uuid AND kind = 'scene_changed'"
                ),
                &[&campaign],
            )
            .context("read oldest campaign event")
            .map(|row| {
                row.and_then(|row| row.get::<_, Option<i64>>(0))
                    .map(|value| value as u32)
            })
    }

    pub fn scene_events(
        client: &mut impl GenericClient,
        campaign: &str,
        after: u32,
        limit: i64,
    ) -> Result<Vec<SceneChanged>, Error> {
        let rows = client
            .query(
                concat!(
                    "SELECT event_id::text, stream_revision, scene_id::text ",
                    "FROM campaign.outbox WHERE campaign_id = $1::text::uuid ",
                    "AND kind = 'scene_changed' AND stream_revision > $2::bigint ",
                    "ORDER BY stream_revision LIMIT $3"
                ),
                &[&campaign, &i64::from(after), &limit],
            )
            .context("read campaign scene events")?;
        Ok(rows
            .into_iter()
            .map(|row| SceneChanged {
                protocol_version: PROTOCOL_VERSION,
                event_id: row.get(0),
                campaign_id: campaign.to_string(),
                revision: row.get::<_, i64>(1) as u32,
                scene_id: row.get(2),
                kind: "scene_changed".into(),
            })
            .collect())
    }
}
