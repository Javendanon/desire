//! Campaign reads and writes. Creation also inserts the owner's DM membership.
use super::{Target, next_id, window};
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
    let rows = CampaignRepository::list_for_user(client, &caller.user_id, window(page))
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    Ok(page.finish(rows))
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
