//! Membership management. The owner's DM row cannot be removed.
use super::{Scope, Target, decode_all, execute, execute_delete, query, role_name};
use crate::{
    access,
    error::ApiError,
    payloads::NewMember,
    query::{Page, PageBody},
};
use desire_core::contracts::campaign::Membership;
use postgres::Client;

pub fn list(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
) -> Result<PageBody<Membership>, ApiError> {
    access::require_member(client, scope.caller, scope.campaign_id)?;
    let (limit, offset) = page.fetch();
    let rows = query(
        client,
        "SELECT to_jsonb(m) FROM campaign.memberships m \
         WHERE m.campaign_id = $1::text::uuid ORDER BY m.user_id LIMIT $2 OFFSET $3",
        &[&scope.campaign_id, &limit, &offset],
        scope.caller,
    )?;
    Ok(page.finish(decode_all(rows, scope.caller)?))
}

pub fn add(client: &mut Client, scope: Scope<'_>, body: NewMember) -> Result<Membership, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    execute(
        client,
        "INSERT INTO campaign.memberships (campaign_id, user_id, role) \
         VALUES ($1::text::uuid, $2::text::uuid, $3)",
        &[&scope.campaign_id, &body.user_id, &role_name(&body.role)],
        scope.caller,
    )?;
    Ok(Membership {
        campaign_id: scope.campaign_id.to_string(),
        user_id: body.user_id,
        role: body.role,
    })
}

pub fn remove(client: &mut Client, target: Target<'_>) -> Result<(), ApiError> {
    let scope = target.scope;
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let owner = access::owner_id(client, scope.caller, scope.campaign_id)?;
    if owner == target.id {
        return Err(ApiError::conflict(
            scope.caller,
            "the owner membership cannot be removed",
        ));
    }
    let affected = execute_delete(
        client,
        "DELETE FROM campaign.memberships \
         WHERE campaign_id = $1::text::uuid AND user_id = $2::text::uuid",
        &[&scope.campaign_id, &target.id],
        scope.caller,
    )?;
    if affected == 0 {
        return Err(ApiError::not_found(scope.caller, "membership not found"));
    }
    Ok(())
}
