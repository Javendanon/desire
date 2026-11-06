//! Typed note CRUD extends the existing persistence boundary without HTTP types.
use super::*;
use postgres::GenericClient;

const JOURNAL_LIST_DM: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid ORDER BY j.id LIMIT $2 OFFSET $3";
const JOURNAL_LIST_PLAYER: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.visibility = 'players' \
     ORDER BY j.id LIMIT $2 OFFSET $3";
const JOURNAL_GET_DM: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.id = $2::text::uuid";
const JOURNAL_GET_PLAYER: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.id = $2::text::uuid \
     AND j.visibility = 'players'";
const JOURNAL_UPDATE: &str = "UPDATE campaign.journal_entries j SET body = $3, \
     visibility = $4::text::campaign.visibility, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid \
     AND revision = $5::bigint RETURNING to_jsonb(j)";

const KNOWLEDGE_LIST_DM: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid ORDER BY k.id LIMIT $2 OFFSET $3";
const KNOWLEDGE_LIST_PLAYER: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.visibility = 'players' \
     ORDER BY k.id LIMIT $2 OFFSET $3";
const KNOWLEDGE_GET_DM: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.id = $2::text::uuid";
const KNOWLEDGE_GET_PLAYER: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.id = $2::text::uuid \
     AND k.visibility = 'players'";
const KNOWLEDGE_UPDATE: &str = "UPDATE campaign.knowledge k SET title = $3, body = $4, \
     visibility = $5::text::campaign.visibility, \
     provenance = $6::jsonb::catalog.provenance, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid \
     AND revision = $7::bigint RETURNING to_jsonb(k)";

pub struct JournalUpdate<'a> {
    pub target: RecordTarget<'a>,
    pub body: &'a str,
    pub visibility: Visibility,
    pub expected_revision: u32,
}

pub struct KnowledgeUpdate<'a> {
    pub target: RecordTarget<'a>,
    pub title: &'a str,
    pub body: &'a str,
    pub visibility: Visibility,
    pub provenance: &'a Provenance,
    pub expected_revision: u32,
}

impl NotesRepository {
    pub fn list_sessions(
        client: &mut Client,
        campaign: &str,
        page: FetchPage,
    ) -> Result<Vec<Session>, Error> {
        reads::list(
            client,
            ListRead {
                sql: "SELECT to_jsonb(s) FROM campaign.sessions s \
                  WHERE s.campaign_id = $1::text::uuid ORDER BY s.id LIMIT $2 OFFSET $3",
                campaign_id: campaign,
                page,
            },
        )
    }

    pub fn list_journal(
        client: &mut impl GenericClient,
        scope: CampaignRead<'_>,
        page: FetchPage,
    ) -> Result<Vec<JournalEntry>, Error> {
        reads::list(
            client,
            ListRead {
                sql: reads::selected(scope.audience, JOURNAL_LIST_DM, JOURNAL_LIST_PLAYER),
                campaign_id: scope.campaign_id,
                page,
            },
        )
    }

    pub fn get_journal(
        client: &mut Client,
        target: RecordTarget<'_>,
        audience: Audience,
    ) -> Result<Option<JournalEntry>, Error> {
        reads::get(
            client,
            target,
            reads::selected(audience, JOURNAL_GET_DM, JOURNAL_GET_PLAYER),
        )
    }

    pub fn list_knowledge(
        client: &mut impl GenericClient,
        scope: CampaignRead<'_>,
        page: FetchPage,
    ) -> Result<Vec<CampaignKnowledge>, Error> {
        reads::list(
            client,
            ListRead {
                sql: reads::selected(scope.audience, KNOWLEDGE_LIST_DM, KNOWLEDGE_LIST_PLAYER),
                campaign_id: scope.campaign_id,
                page,
            },
        )
    }

    pub fn get_knowledge(
        client: &mut Client,
        target: RecordTarget<'_>,
        audience: Audience,
    ) -> Result<Option<CampaignKnowledge>, Error> {
        reads::get(
            client,
            target,
            reads::selected(audience, KNOWLEDGE_GET_DM, KNOWLEDGE_GET_PLAYER),
        )
    }

    pub fn update_journal(
        client: &mut Client,
        update: &JournalUpdate<'_>,
    ) -> Result<Option<JournalEntry>, Error> {
        let mut tx = client.transaction().context("begin journal update")?;
        let row = tx
            .query_opt(
                JOURNAL_UPDATE,
                &[
                    &update.target.campaign_id,
                    &update.target.id,
                    &update.body,
                    &visibility_name(&update.visibility),
                    &i64::from(update.expected_revision),
                ],
            )
            .context("update journal revision")?;
        let Some(row) = row else { return Ok(None) };
        let entry = records::decode(row)?;
        RealtimeRepository::advance_stream(&mut tx, update.target.campaign_id)?;
        tx.commit().context("commit journal update")?;
        Ok(Some(entry))
    }

    pub fn update_knowledge(
        client: &mut Client,
        update: &KnowledgeUpdate<'_>,
    ) -> Result<Option<CampaignKnowledge>, Error> {
        let mut tx = client.transaction().context("begin knowledge update")?;
        let provenance =
            serde_json::to_value(update.provenance).context("encode knowledge provenance")?;
        let row = tx
            .query_opt(
                KNOWLEDGE_UPDATE,
                &[
                    &update.target.campaign_id,
                    &update.target.id,
                    &update.title,
                    &update.body,
                    &visibility_name(&update.visibility),
                    &provenance,
                    &i64::from(update.expected_revision),
                ],
            )
            .context("update knowledge revision")?;
        let Some(row) = row else { return Ok(None) };
        let entry = records::decode(row)?;
        RealtimeRepository::advance_stream(&mut tx, update.target.campaign_id)?;
        tx.commit().context("commit knowledge update")?;
        Ok(Some(entry))
    }

    pub fn delete_journal(client: &mut Client, target: RecordTarget<'_>) -> Result<bool, Error> {
        delete(client, target, "campaign.journal_entries")
    }

    pub fn delete_knowledge(client: &mut Client, target: RecordTarget<'_>) -> Result<bool, Error> {
        delete(client, target, "campaign.knowledge")
    }
}

/// Table names are private adapter constants, never supplied by API callers.
fn delete(client: &mut Client, target: RecordTarget<'_>, table: &str) -> Result<bool, Error> {
    let mut tx = client
        .transaction()
        .context("begin campaign note deletion")?;
    let sql =
        format!("DELETE FROM {table} WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid");
    let affected = tx
        .execute(&sql, &[&target.campaign_id, &target.id])
        .context("delete campaign note")?;
    if affected != 0 {
        RealtimeRepository::advance_stream(&mut tx, target.campaign_id)?;
    }
    tx.commit().context("commit campaign note deletion")?;
    Ok(affected != 0)
}

fn visibility_name(visibility: &Visibility) -> &'static str {
    match visibility {
        Visibility::Players => "players",
        Visibility::Dm => "dm",
    }
}
