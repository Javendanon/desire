//! Nivel20 import operations: authorization, snapshot decoding and the persistence boundary.
use super::Scope;
use crate::{
    access,
    error::ApiError,
    nivel20::{CampaignMetadata, StoredImport},
};
use desire_persistence::{Nivel20Mapping, Nivel20Repository, Nivel20Save};
use postgres::Client;

pub fn previous(client: &mut Client, scope: Scope<'_>) -> Result<Option<StoredImport>, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let stored = Nivel20Repository::get(client, scope.campaign_id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    stored.map(|mapping| decode(mapping, scope)).transpose()
}

pub fn external_owner(
    client: &mut Client,
    scope: Scope<'_>,
    external_id: i64,
) -> Result<Option<String>, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    Nivel20Repository::external_owner(client, external_id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))
}

pub fn save(
    client: &mut Client,
    scope: Scope<'_>,
    source_path: &str,
    campaign: CampaignMetadata,
) -> Result<StoredImport, ApiError> {
    access::require_dm(client, scope.caller, scope.campaign_id)?;
    let snapshot = serde_json::to_value(&campaign).map_err(|_| internal(scope, "encode"))?;
    let save = Nivel20Save {
        campaign_id: scope.campaign_id,
        external_id: campaign.id,
        source_path,
        external_updated_at: campaign.updated_at.as_deref(),
        snapshot: &snapshot,
    };
    let mapping = Nivel20Repository::save(client, &save)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    decode(mapping, scope)
}

/// The stored JSON is the adapter's own output; an unreadable row is an internal fault.
fn decode(mapping: Nivel20Mapping, scope: Scope<'_>) -> Result<StoredImport, ApiError> {
    let campaign = serde_json::from_value::<CampaignMetadata>(mapping.snapshot)
        .map_err(|_| internal(scope, "decode"))?;
    Ok(StoredImport {
        campaign_id: mapping.campaign_id,
        external_id: mapping.external_id,
        source_path: mapping.source_path,
        imported_at: mapping.imported_at,
        campaign,
    })
}

fn internal(scope: Scope<'_>, action: &str) -> ApiError {
    eprintln!(
        "request_id={} nivel20_snapshot_failure={action}",
        scope.caller.request_id
    );
    ApiError::internal_for(
        &scope.caller.request_id,
        "the stored Nivel20 snapshot is unreadable",
    )
}
