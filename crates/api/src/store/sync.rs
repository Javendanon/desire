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
use desire_persistence::{
    CampaignRead, CampaignRepository, CharacterRepository, FetchPage, NotesRepository,
    RealtimeRepository, SceneRepository,
};
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
    let current = RealtimeRepository::stream_revision(client, scope.campaign_id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    let after = match after {
        Some(after) if resumable(client, scope, after, current)? => after,
        _ => return snapshot_batch(client, scope, role, current),
    };
    if after == current {
        return Ok(empty_batch(scope, role, current));
    }
    let events = RealtimeRepository::scene_events(client, scope.campaign_id, after, EVENT_LIMIT)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    if events.last().map(|event| event.revision) != Some(current) {
        return snapshot_batch(client, scope, role, current);
    }
    Ok(SyncBatch {
        protocol_version: PROTOCOL_VERSION,
        campaign_id: scope.campaign_id.to_string(),
        role,
        revision: current,
        snapshot: None,
        scene_events: events,
        travel_events: Vec::new(),
    })
}

/// A cursor is resumable only while every event after it is still present and bounded.
fn resumable(
    client: &mut Client,
    scope: Scope<'_>,
    after: u32,
    current: u32,
) -> Result<bool, ApiError> {
    if after > current {
        return Ok(false);
    }
    let oldest = RealtimeRepository::oldest_scene_revision(client, scope.campaign_id)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    let contiguous = oldest.is_some_and(|oldest| after.saturating_add(1) >= oldest);
    let bounded = u64::from(current) - u64::from(after) <= EVENT_LIMIT as u64;
    Ok(contiguous && bounded)
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
    revision: u32,
) -> Result<SyncBatch, ApiError> {
    let snapshot = snapshot(client, scope, role.clone())?;
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

fn snapshot(
    client: &mut Client,
    scope: Scope<'_>,
    role: MemberRole,
) -> Result<CampaignSnapshot, ApiError> {
    let caller = scope.caller;
    let read = CampaignRead {
        campaign_id: scope.campaign_id,
        audience: audience(role),
    };
    let page = FetchPage {
        limit: FETCH_LIMIT,
        offset: 0,
    };
    let campaign = CampaignRepository::get(client, scope.campaign_id)
        .map_err(|error| ApiError::from_persistence(error, caller))?
        .ok_or_else(|| ApiError::not_found(caller, "campaign not found"))?;
    let scenes = SceneRepository::list(client, scope.campaign_id, page)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    let characters = CharacterRepository::list(client, read, page)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    let journal = NotesRepository::list_journal(client, read, page)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    let knowledge = NotesRepository::list_knowledge(client, read, page)
        .map_err(|error| ApiError::from_persistence(error, caller))?;
    Ok(assemble(campaign, scenes, characters, journal, knowledge))
}

fn assemble(
    campaign: desire_core::contracts::campaign::Campaign,
    scenes: Vec<desire_core::contracts::campaign::Scene>,
    characters: Vec<desire_core::contracts::campaign::Character>,
    journal: Vec<desire_core::contracts::campaign::JournalEntry>,
    knowledge: Vec<desire_core::contracts::campaign::CampaignKnowledge>,
) -> CampaignSnapshot {
    let (scenes, scenes_more) = bounded(scenes);
    let (characters, characters_more) = bounded(characters);
    let (journal, journal_more) = bounded(journal);
    let (knowledge, knowledge_more) = bounded(knowledge);
    CampaignSnapshot {
        protocol_version: PROTOCOL_VERSION,
        campaign,
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
