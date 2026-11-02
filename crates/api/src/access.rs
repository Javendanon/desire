//! Membership and role policy. Every campaign-owned operation passes through here.
use crate::{
    error::{ApiError, INTERNAL},
    extract::Caller,
};
use desire_core::contracts::common::{Id, MemberRole};
use postgres::Client;

/// Non-members receive 404, so campaign existence is not leaked across accounts.
pub fn require_member(
    client: &mut Client,
    caller: &Caller,
    campaign_id: &str,
) -> Result<MemberRole, ApiError> {
    let row = client
        .query_opt(
            "SELECT role FROM campaign.memberships \
             WHERE campaign_id = $1::text::uuid AND user_id = $2::text::uuid",
            &[&campaign_id, &caller.user_id],
        )
        .map_err(|error| ApiError::from_postgres(&error, caller))?;
    let Some(row) = row else {
        return Err(ApiError::not_found(caller, "campaign not found"));
    };
    match row.get::<_, String>(0).as_str() {
        "dm" => Ok(MemberRole::Dm),
        "player" => Ok(MemberRole::Player),
        other => Err(ApiError::new(
            INTERNAL,
            "internal",
            format!("unknown membership role {other}"),
            &caller.request_id,
        )),
    }
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
    client
        .query_opt(
            "SELECT owner_id::text FROM campaign.campaigns WHERE id = $1::text::uuid",
            &[&campaign_id],
        )
        .map_err(|error| ApiError::from_postgres(&error, caller))?
        .map(|row| row.get(0))
        .ok_or_else(|| ApiError::not_found(caller, "campaign not found"))
}
