//! Cursor-based campaign synchronization: bounded snapshot, then ordered public events.
use super::{Scope, audience};
use crate::{access, error::ApiError};
use desire_core::{
    PROTOCOL_VERSION,
    contracts::{
        common::MemberRole,
        transport::{CampaignSnapshot, SyncBatch, TravelUpdated},
    },
};
use desire_persistence::{CampaignRead, FetchPage, RealtimeRepository, SnapshotRows};
use postgres::Client;

const SNAPSHOT_LIMIT: i64 = 500;
const FETCH_LIMIT: i64 = SNAPSHOT_LIMIT + 1;
const EVENT_LIMIT: i64 = 500;

pub fn batch(
    client: &mut Client,
    scope: Scope<'_>,
    after: Option<u32>,
) -> Result<SyncBatch, ApiError> {
    let role = access::require_member(client, scope.caller, scope.campaign_id)?;
    match after {
        Some(after) => event_or_snapshot(client, scope, role, after),
        None => snapshot_batch(client, scope, role),
    }
}

fn event_or_snapshot(
    client: &mut Client,
    scope: Scope<'_>,
    role: MemberRole,
    after: u32,
) -> Result<SyncBatch, ApiError> {
    let window = RealtimeRepository::event_window(client, scope.campaign_id, after, EVENT_LIMIT)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    // A cursor at the current revision has nothing left to fetch, even when the campaign has no
    // retained scene event to prove it: non-scene writes advance the stream without one.
    if after == window.revision {
        return Ok(empty_batch(scope, role, window.revision));
    }
    if !resumable(after, window.revision, window.oldest_scene) {
        return snapshot_batch(client, scope, role);
    }
    // Non-scene writes advance the cursor without an outbox row, so a short list is a gap.
    let expected = u64::from(window.revision) - u64::from(after);
    if window.events.len() as u64 != expected {
        return snapshot_batch(client, scope, role);
    }
    Ok(SyncBatch {
        protocol_version: PROTOCOL_VERSION,
        campaign_id: scope.campaign_id.to_string(),
        role,
        revision: window.revision,
        snapshot: None,
        scene_events: window.events,
        travel_events: Vec::new(),
    })
}

/// A cursor is resumable only while every event after it is still present and bounded.
fn resumable(after: u32, current: u32, oldest: Option<u32>) -> bool {
    if after > current {
        return false;
    }
    let contiguous = oldest.is_some_and(|oldest| after.saturating_add(1) >= oldest);
    let bounded = u64::from(current) - u64::from(after) <= EVENT_LIMIT as u64;
    contiguous && bounded
}

fn empty_batch(scope: Scope<'_>, role: MemberRole, revision: u32) -> SyncBatch {
    SyncBatch {
        protocol_version: PROTOCOL_VERSION,
        campaign_id: scope.campaign_id.to_string(),
        role,
        revision,
        snapshot: None,
        scene_events: Vec::new(),
        travel_events: Vec::<TravelUpdated>::new(),
    }
}

fn snapshot_batch(
    client: &mut Client,
    scope: Scope<'_>,
    role: MemberRole,
) -> Result<SyncBatch, ApiError> {
    let caller = scope.caller;
    let read = CampaignRead {
        campaign_id: scope.campaign_id,
        audience: audience(role.clone()),
    };
    let page = FetchPage {
        limit: FETCH_LIMIT,
        offset: 0,
    };
    let rows = RealtimeRepository::snapshot(client, read, page)
        .map_err(|error| ApiError::from_persistence(error, caller))?
        .ok_or_else(|| ApiError::not_found(caller, "campaign not found"))?;
    let revision = rows.revision;
    let snapshot = assemble(rows);
    Ok(SyncBatch {
        protocol_version: PROTOCOL_VERSION,
        campaign_id: scope.campaign_id.to_string(),
        role,
        revision,
        snapshot: Some(snapshot),
        scene_events: Vec::new(),
        travel_events: Vec::new(),
    })
}

fn assemble(rows: SnapshotRows) -> CampaignSnapshot {
    let (scenes, scenes_more) = bounded(rows.scenes);
    let (characters, characters_more) = bounded(rows.characters);
    let (journal, journal_more) = bounded(rows.journal);
    let (knowledge, knowledge_more) = bounded(rows.knowledge);
    CampaignSnapshot {
        protocol_version: PROTOCOL_VERSION,
        campaign: rows.campaign,
        scenes,
        characters,
        journal,
        knowledge,
        truncated: scenes_more || characters_more || journal_more || knowledge_more,
    }
}

fn bounded<T>(mut items: Vec<T>) -> (Vec<T>, bool) {
    let truncated = items.len() > SNAPSHOT_LIMIT as usize;
    items.truncate(SNAPSHOT_LIMIT as usize);
    (items, truncated)
}
