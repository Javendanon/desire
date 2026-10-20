//! DM-only adapter: callers must authenticate and authorize before invoking it.
use crate::{Error, error::Context, records};
use desire_core::contracts::campaign::DmSecret;
use postgres::Client;

pub enum SecretSubject {
    Place,
    Scene,
    Character,
    Session,
    JournalEntry,
    CampaignKnowledge,
    Travel,
    PlaceOverride,
    Condition,
}

impl SecretSubject {
    fn column(self) -> &'static str {
        match self {
            Self::Place => "place_id",
            Self::Scene => "scene_id",
            Self::Character => "character_id",
            Self::Session => "session_id",
            Self::JournalEntry => "journal_entry_id",
            Self::CampaignKnowledge => "campaign_knowledge_id",
            Self::Travel => "travel_id",
            Self::PlaceOverride => "place_override_id",
            Self::Condition => "condition_id",
        }
    }
}

pub struct SecretRepository;

impl SecretRepository {
    pub fn create(
        client: &mut Client,
        secret: &DmSecret,
        subject: SecretSubject,
    ) -> Result<(), Error> {
        let column = subject.column();
        let query = format!(
            "INSERT INTO private.dm_secrets \
            (id, campaign_id, {column}, body, revision) \
            VALUES ($1::text::uuid, $2::text::uuid, $3::text::uuid, $4, $5::bigint)"
        );
        client
            .execute(
                &query,
                &[
                    &secret.id,
                    &secret.campaign_id,
                    &secret.subject_id,
                    &secret.body,
                    &i64::from(secret.revision),
                ],
            )
            .context(format!(
                "create DM secret {} in campaign {}",
                secret.id, secret.campaign_id
            ))?;
        Ok(())
    }

    pub fn get(client: &mut Client, campaign: &str, id: &str) -> Result<Option<DmSecret>, Error> {
        client.query_opt(concat!(
            "SELECT jsonb_build_object('id', id, 'campaign_id', campaign_id, 'subject_id', ",
            "subject_id, 'body', body, 'revision', revision) FROM private.dm_secrets ",
            "WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid"), &[&campaign, &id])
            .context(format!("read DM secret {id} in campaign {campaign}"))?
            .map(records::decode).transpose()
    }
}
