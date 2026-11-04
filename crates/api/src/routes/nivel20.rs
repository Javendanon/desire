//! Read-only Nivel20 import boundary: preview, explicit import and local snapshot reads.
use super::{Json, Path, State};

use crate::{
    AppState, db,
    error::ApiError,
    extract::{ApiJson, Caller},
    nivel20::{
        CampaignMetadata, CampaignPath, ChangeStatus, ImportReport, Nivel20Error, StoredImport,
        compare,
    },
    payloads::Nivel20Source,
    routes::id_path,
    store::{self, Scope},
};

use desire_core::flags::{Flag, NIVEL20_IMPORT};

/// A resolved import target: authorized campaign, caller and the user-supplied source path.
struct Target<'a> {
    state: &'a AppState,
    caller: &'a Caller,
    campaign_id: &'a str,
    source: &'a CampaignPath,
}

pub async fn stored(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
) -> Result<Json<StoredImport>, ApiError> {
    enabled(&state, &caller)?;
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    previous(&state, &caller, &campaign_id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(&caller, "Nivel20 import not found"))
}

pub async fn preview(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiJson(body): ApiJson<Nivel20Source>,
) -> Result<Json<ImportReport>, ApiError> {
    enabled(&state, &caller)?;
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let source = body.clean(&caller)?;
    let target = Target {
        state: &state,
        caller: &caller,
        campaign_id: &campaign_id,
        source: &source,
    };
    let previous = previous(&state, &caller, &campaign_id).await?;
    let current = read_source(&target).await?;
    ensure_unmapped(&target).await?;
    Ok(Json(report(&target, current, previous)))
}

pub async fn import(
    State(state): State<AppState>,
    caller: Caller,
    Path(campaign_id): Path<String>,
    ApiJson(body): ApiJson<Nivel20Source>,
) -> Result<Json<ImportReport>, ApiError> {
    enabled(&state, &caller)?;
    let campaign_id = id_path(&caller, campaign_id, "campaign_id")?;
    let source = body.clean(&caller)?;
    let target = Target {
        state: &state,
        caller: &caller,
        campaign_id: &campaign_id,
        source: &source,
    };
    let previous = previous(&state, &caller, &campaign_id).await?;
    let current = read_source(&target).await?;
    ensure_unmapped(&target).await?;
    let mut report = report(&target, current, previous);
    if report.status == ChangeStatus::Unchanged {
        report.stored = report.previous.clone();
        return Ok(Json(report));
    }
    report.stored = Some(save(&target, &report.campaign).await?);
    report.imported = true;
    Ok(Json(report))
}

async fn previous(
    state: &AppState,
    caller: &Caller,
    campaign_id: &str,
) -> Result<Option<StoredImport>, ApiError> {
    let request_id = caller.request_id.clone();
    let campaign_id = campaign_id.to_string();
    let caller = caller.clone();
    db::blocking(&state.db, request_id, move |client| {
        store::nivel20::previous(
            client,
            Scope {
                caller: &caller,
                campaign_id: &campaign_id,
            },
        )
    })
    .await
}

/// One external campaign belongs to one local campaign: report the conflict before any write.
async fn ensure_unmapped(target: &Target<'_>) -> Result<(), ApiError> {
    let request_id = target.caller.request_id.clone();
    let campaign_id = target.campaign_id.to_string();
    let external_id = target.source.external_id;
    let caller = target.caller.clone();
    let owner = db::blocking(&target.state.db, request_id, move |client| {
        store::nivel20::external_owner(
            client,
            Scope {
                caller: &caller,
                campaign_id: &campaign_id,
            },
            external_id,
        )
    })
    .await?;
    match owner {
        Some(owner) if owner != target.campaign_id => Err(ApiError::conflict(
            target.caller,
            "that Nivel20 campaign is already imported into another local campaign",
        )),
        _ => Ok(()),
    }
}

/// The feature is opt-in. Off (no flags file, missing file or a malformed one) makes the three
/// routes answer as if they did not exist, and no source request is made.
fn enabled(state: &AppState, caller: &Caller) -> Result<(), ApiError> {
    let on = state.flags.is_on(&NIVEL20_IMPORT).unwrap_or_else(|error| {
        eprintln!(
            "request_id={} flags: {error}; using the default (off)",
            caller.request_id
        );
        Flag::DEFAULT
    });
    if on {
        return Ok(());
    }
    Err(ApiError::not_found(caller, "Nivel20 import is disabled"))
}

async fn save(target: &Target<'_>, current: &CampaignMetadata) -> Result<StoredImport, ApiError> {
    let request_id = target.caller.request_id.clone();
    let campaign_id = target.campaign_id.to_string();
    let source_path = target.source.path.clone();
    let current = current.clone();
    let caller = target.caller.clone();
    db::blocking(&target.state.db, request_id, move |client| {
        store::nivel20::save(
            client,
            Scope {
                caller: &caller,
                campaign_id: &campaign_id,
            },
            &source_path,
            current,
        )
    })
    .await
}

/// One explicit blocking read on the blocking pool. No retry, no polling.
async fn read_source(target: &Target<'_>) -> Result<CampaignMetadata, ApiError> {
    let request_id = target.caller.request_id.clone();
    let client = target.state.nivel20.clone();
    let source = target.source.clone();
    let result = tokio::task::spawn_blocking(move || client.fetch_campaign(&source))
        .await
        .map_err(|_| ApiError::internal_for(&request_id, "the Nivel20 adapter worker failed"))?;
    result.map_err(|error| source_error(error, target.caller))
}

fn source_error(error: Nivel20Error, caller: &Caller) -> ApiError {
    match error {
        Nivel20Error::SessionExpired | Nivel20Error::AccessDenied | Nivel20Error::Redirected => {
            ApiError::source_requires_session(caller)
        }
        Nivel20Error::NotFound => ApiError::source_not_found(caller),
        Nivel20Error::RateLimited => ApiError::source_rate_limited(caller),
        Nivel20Error::Timeout | Nivel20Error::Unavailable => ApiError::source_unavailable(caller),
        Nivel20Error::UnexpectedStatus | Nivel20Error::InvalidPayload => {
            ApiError::source_rejected(caller)
        }
    }
}

fn report(
    target: &Target<'_>,
    current: CampaignMetadata,
    previous: Option<StoredImport>,
) -> ImportReport {
    let (status, changed_fields) = compare(previous.as_ref(), target.source.external_id, &current);
    ImportReport {
        source: "nivel20",
        campaign_id: target.campaign_id.to_string(),
        external_id: target.source.external_id,
        source_path: target.source.path.clone(),
        status,
        campaign: current,
        previous,
        stored: None,
        imported: false,
        changed_fields,
    }
}
