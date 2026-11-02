//! Campaign knowledge CRUD. Only a DM writes lore; players read `players` entries.
use super::{Scope, next_id};
use crate::{
    access,
    error::ApiError,
    payloads::{NewKnowledge, PatchKnowledge},
};
use desire_core::contracts::{campaign::CampaignKnowledge, common::Visibility};
use desire_persistence::NotesRepository;
use postgres::Client;

const LIST_DM: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid ORDER BY k.id LIMIT $2 OFFSET $3";
const LIST_PLAYER: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.visibility = 'players' \
     ORDER BY k.id LIMIT $2 OFFSET $3";
const GET_DM: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.id = $2::text::uuid";
const GET_PLAYER: &str = "SELECT to_jsonb(k) FROM campaign.knowledge k \
     WHERE k.campaign_id = $1::text::uuid AND k.id = $2::text::uuid \
     AND k.visibility = 'players'";
const UPDATE: &str = "UPDATE campaign.knowledge SET title = $3, body = $4, \
     visibility = $5::text::campaign.visibility, \
     provenance = $6::jsonb::catalog.provenance, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid \
     AND revision = $7::bigint";

visible_crud!(
    CampaignKnowledge,
    LIST_DM,
    LIST_PLAYER,
    GET_DM,
    GET_PLAYER,
    "campaign.knowledge",
    "knowledge entry not found"
);
revisioned_update!(
    PatchKnowledge,
    CampaignKnowledge,
    UPDATE,
    target,
    caller,
    campaign_id,
    id,
    body,
    &[
        &campaign_id as &(dyn ::postgres::types::ToSql + Sync),
        &id,
        &body.title,
        &body.body,
        &visibility_name(&body.visibility),
        &serde_json::to_value(&body.provenance)
            .map_err(|_| ApiError::internal("provenance cannot be encoded"))?,
        &i64::from(body.expected_revision)
    ]
);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewKnowledge,
) -> Result<CampaignKnowledge, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let entry = CampaignKnowledge {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        title: body.title,
        body: body.body,
        visibility: body.visibility,
        revision: 1,
        provenance: body.provenance,
    };
    NotesRepository::create_knowledge(client, &entry)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(entry)
}

fn visibility_name(visibility: &Visibility) -> &'static str {
    match visibility {
        Visibility::Players => "players",
        Visibility::Dm => "dm",
    }
}
