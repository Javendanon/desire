//! Membership application policy, backed by typed membership storage.
use super::{Scope, Target, record_target, window};
use crate::{
    access,
    error::ApiError,
    payloads::NewMember,
    query::{Page, PageBody},
};
use desire_core::contracts::campaign::Membership;
use desire_persistence::MembershipRepository;
use postgres::Client;

pub fn list(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
) -> Result<PageBody<Membership>, ApiError> {
    access::require_member(client, scope.caller, scope.campaign_id)?;
    let rows = MembershipRepository::list(client, scope.campaign_id, window(page))
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(page.finish(rows))
}

pub fn add(client: &mut Client, scope: Scope<'_>, body: NewMember) -> Result<Membership, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let membership = Membership {
        campaign_id: scope.campaign_id.to_owned(),
        user_id: body.user_id,
        role: body.role,
    };
    MembershipRepository::add(client, &membership)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(membership)
}

pub fn remove(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let scope = target.scope;
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    if access::owner_id(client, scope.caller, scope.campaign_id)? == target.id {
        return Err(ApiError::conflict(
            scope.caller,
            "the owner membership cannot be removed",
        ));
    }
    let removed = MembershipRepository::remove(client, record_target(target))
        .map_err(|error| ApiError::from_persistence_delete(error, scope.caller))?;
    if !removed {
        return Err(ApiError::not_found(scope.caller, "membership not found"));
    }
    Ok(())
}
