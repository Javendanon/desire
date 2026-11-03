//! Membership and role policy. Every campaign-owned operation passes through here.
use crate::{error::ApiError, extract::Caller};
use desire_core::contracts::common::{Id, MemberRole};
use postgres::Client;

/// Non-members receive 404, so campaign existence is not leaked across accounts.
pub fn require_member(
    client: &mut Client,
    caller: &Caller,
    campaign_id: &str,
) -> Result<MemberRole, ApiError> {
    desire_persistence::MembershipRepository::role(
        client,
        desire_persistence::RecordTarget {
            campaign_id,
            id: &caller.user_id,
        },
    )
    .map_err(|error| ApiError::from_persistence(error, caller))?
    .ok_or_else(|| ApiError::not_found(caller, "campaign not found"))
}

pub fn require_dm(client: &mut Client, caller: &Caller, campaign_id: &str) -> Result<(), ApiError> {
    match require_member(client, caller, campaign_id)? {
        MemberRole::Dm => Ok(()),
        MemberRole::Player => Err(ApiError::forbidden(
            caller,
            "this operation requires the dm role",
        )),
    }
}

pub fn owner_id(client: &mut Client, caller: &Caller, campaign_id: &str) -> Result<Id, ApiError> {
    desire_persistence::MembershipRepository::owner_id(client, campaign_id)
        .map_err(|error| ApiError::from_persistence(error, caller))?
        .ok_or_else(|| ApiError::not_found(caller, "campaign not found"))
}
