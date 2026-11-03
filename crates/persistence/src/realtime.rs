//! Campaign stream cursor and public scene events; no private note bodies enter the outbox.
use crate::{Error, error::Context};
use desire_core::{PROTOCOL_VERSION, contracts::transport::SceneChanged};
use postgres::Client;

pub struct RealtimeRepository;

impl RealtimeRepository {
    /// A campaign with no write yet has revision zero.
    pub fn stream_revision(client: &mut Client, campaign: &str) -> Result<u32, Error> {
        client
            .query_opt(
                "SELECT revision FROM campaign.streams WHERE campaign_id = $1::text::uuid",
                &[&campaign],
            )
            .context("read campaign stream revision")
            .map(|row| row.map_or(0, |row| row.get::<_, i64>(0) as u32))
    }

    pub fn oldest_scene_revision(
        client: &mut Client,
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
        client: &mut Client,
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
