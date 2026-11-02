//! Campaign reads and writes. Creation also inserts the owner's DM membership.
use super::{Target, decode_all, next_id, query};
use crate::{
    access,
    error::ApiError,
    extract::Caller,
    payloads::{NewCampaign, PatchCampaign},
    query::{Page, PageBody},
};
use desire_core::contracts::campaign::Campaign;
use desire_persistence::{CampaignRename, CampaignRepository};
use postgres::Client;

pub fn list(
    client: &mut Client,
    caller: &Caller,
    page: Page,
) -> Result<PageBody<Campaign>, ApiError> {
    let (limit, offset) = page.fetch();
    let rows = query(
        client,
        "SELECT to_jsonb(c) - 'owner_role' FROM campaign.campaigns c \
         JOIN campaign.memberships m ON m.campaign_id = c.id \
         WHERE m.user_id = $1::text::uuid ORDER BY c.id LIMIT $2 OFFSET $3",
        &[&caller.user_id, &limit, &offset],
        caller,
    )?;
    Ok(page.finish(decode_all(rows, caller)?))
}

pub fn get(client: &mut Client, target: Target<'_>) -> Result<Campaign, ApiError> {
    let scope = target.scope;
    access::require_member(client, scope.caller, scope.campaign_id)?;
    CampaignRepository::get(client, scope.campaign_id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?
        .ok_or_else(|| ApiError::not_found(scope.caller, "campaign not found"))
}

pub fn create(
    client: &mut Client,
    caller: &Caller,
    body: NewCampaign,
) -> Result<Campaign, ApiError> {
    let campaign = Campaign {
        id: next_id(client, caller)?,
        owner_id: caller.user_id.clone(),
        city_id: body.city_id,
        name: body.name,
        rules_edition: body.rules_edition,
        revision: 1,
    };
    CampaignRepository::create(client, &campaign)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    Ok(campaign)
}

pub fn rename(
    client: &mut Client,
    target: Target<'_>,
    body: PatchCampaign,
) -> Result<Campaign, ApiError> {
    let scope = target.scope;
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    get(client, target)?;
    let rename = CampaignRename {
        campaign_id: scope.campaign_id,
        expected_revision: body.expected_revision,
        name: &body.name,
    };
    CampaignRepository::rename(client, &rename)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    get(client, target)
}
