//! Character rows and their actor projections commit together.
use crate::{
    Error,
    error::Context,
    reads::{self, Audience, CampaignRead, FetchPage, ListRead, RecordTarget},
    realtime::RealtimeRepository,
    records,
};
use desire_core::contracts::campaign::Character;
use postgres::{Client, GenericClient};

const LIST_DM: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     WHERE c.campaign_id = $1::text::uuid ORDER BY c.id LIMIT $2 OFFSET $3";
const LIST_PLAYER: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     JOIN campaign.actors a ON a.campaign_id = c.campaign_id AND a.id = c.id \
     WHERE c.campaign_id = $1::text::uuid AND a.visibility = 'players' \
     ORDER BY c.id LIMIT $2 OFFSET $3";
const GET_DM: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     WHERE c.campaign_id = $1::text::uuid AND c.id = $2::text::uuid";
const GET_PLAYER: &str = "SELECT to_jsonb(c) FROM campaign.characters c \
     JOIN campaign.actors a ON a.campaign_id = c.campaign_id AND a.id = c.id \
     WHERE c.campaign_id = $1::text::uuid AND c.id = $2::text::uuid \
     AND a.visibility = 'players'";
const UPDATE: &str = "UPDATE campaign.characters c SET name = $3, \
     controller_id = $4::text::uuid, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid AND revision = $5::bigint \
     RETURNING to_jsonb(c)";
const UPDATE_ACTOR: &str = "UPDATE campaign.actors SET name = $3, \
     kind = CASE WHEN $4::text IS NULL THEN 'npc' ELSE 'character' END, \
     visibility = CASE WHEN $4::text IS NULL THEN 'dm'::campaign.visibility \
     ELSE 'players'::campaign.visibility END, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid";

pub struct CharacterRepository;

pub struct CharacterUpdate<'a> {
    pub target: RecordTarget<'a>,
    pub name: &'a str,
    pub controller_id: &'a Option<String>,
    pub expected_revision: u32,
}

impl CharacterRepository {
    pub fn list(
        client: &mut impl GenericClient,
        scope: CampaignRead<'_>,
        page: FetchPage,
    ) -> Result<Vec<Character>, Error> {
        reads::list(
            client,
            ListRead {
                sql: reads::selected(scope.audience, LIST_DM, LIST_PLAYER),
                campaign_id: scope.campaign_id,
                page,
            },
        )
    }

    pub fn get(
        client: &mut Client,
        target: RecordTarget<'_>,
        audience: Audience,
    ) -> Result<Option<Character>, Error> {
        reads::get(
            client,
            target,
            reads::selected(audience, GET_DM, GET_PLAYER),
        )
    }

    pub fn create(client: &mut Client, character: &Character) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin character creation")?;
        records::insert(&mut tx, "campaign.characters", character)?;
        RealtimeRepository::advance_stream(&mut tx, &character.campaign_id)?;
        tx.commit()
            .context(format!("commit character {}", character.id))
    }

    /// A stale character write cannot partially change its actor or either revision.
    pub fn update(
        client: &mut Client,
        update: &CharacterUpdate<'_>,
    ) -> Result<Option<Character>, Error> {
        let mut tx = client.transaction().context("begin character update")?;
        let target = update.target;
        let row = tx
            .query_opt(
                UPDATE,
                &[
                    &target.campaign_id,
                    &target.id,
                    &update.name,
                    &update.controller_id,
                    &i64::from(update.expected_revision),
                ],
            )
            .context("update character revision")?;
        let Some(row) = row else { return Ok(None) };
        update_actor(&mut tx, update)?;
        let character = records::decode(row)?;
        RealtimeRepository::advance_stream(&mut tx, target.campaign_id)?;
        tx.commit().context("commit character and actor update")?;
        Ok(Some(character))
    }

    /// Referenced sheets or encounters reject the whole deletion, including actor cleanup.
    pub fn delete(client: &mut Client, target: RecordTarget<'_>) -> Result<bool, Error> {
        let mut tx = client.transaction().context("begin character deletion")?;
        remove_actor_rows(&mut tx, target)?;
        let affected = tx
            .execute(
                "DELETE FROM campaign.characters \
                 WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid",
                &[&target.campaign_id, &target.id],
            )
            .context("delete character")?;
        if affected != 0 {
            RealtimeRepository::advance_stream(&mut tx, target.campaign_id)?;
        }
        tx.commit().context("commit character deletion")?;
        Ok(affected != 0)
    }
}

fn update_actor(tx: &mut impl GenericClient, update: &CharacterUpdate<'_>) -> Result<(), Error> {
    let target = update.target;
    tx.execute(
        UPDATE_ACTOR,
        &[
            &target.campaign_id,
            &target.id,
            &update.name,
            &update.controller_id,
        ],
    )
    .context("update character actor projection")?;
    Ok(())
}

fn remove_actor_rows(tx: &mut impl GenericClient, target: RecordTarget<'_>) -> Result<(), Error> {
    for table in ["actor_stats", "actor_state"] {
        let sql = format!(
            "DELETE FROM campaign.{table} s USING campaign.actors a \
             WHERE a.campaign_id = $1::text::uuid AND a.character_id = $2::text::uuid \
             AND s.campaign_id = a.campaign_id AND s.actor_id = a.id"
        );
        tx.execute(&sql, &[&target.campaign_id, &target.id])
            .context("delete character actor component")?;
    }
    tx.execute(
        "DELETE FROM campaign.actors \
         WHERE campaign_id = $1::text::uuid AND character_id = $2::text::uuid",
        &[&target.campaign_id, &target.id],
    )
    .context("delete character actor")?;
    Ok(())
}
