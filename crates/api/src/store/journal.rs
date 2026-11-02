//! Journal CRUD. Players only see `players` entries; D17 refines projections later.
use super::{Scope, next_id};
use crate::{
    access,
    error::ApiError,
    payloads::{NewJournal, PatchJournal},
};
use desire_core::contracts::{campaign::JournalEntry, common::Visibility};
use desire_persistence::NotesRepository;
use postgres::Client;

const LIST_DM: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid ORDER BY j.id LIMIT $2 OFFSET $3";
const LIST_PLAYER: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.visibility = 'players' \
     ORDER BY j.id LIMIT $2 OFFSET $3";
const GET_DM: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.id = $2::text::uuid";
const GET_PLAYER: &str = "SELECT to_jsonb(j) FROM campaign.journal_entries j \
     WHERE j.campaign_id = $1::text::uuid AND j.id = $2::text::uuid \
     AND j.visibility = 'players'";
const UPDATE: &str = "UPDATE campaign.journal_entries SET body = $3, \
     visibility = $4::text::campaign.visibility, revision = revision + 1 \
     WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid \
     AND revision = $5::bigint";

visible_crud!(
    JournalEntry,
    LIST_DM,
    LIST_PLAYER,
    GET_DM,
    GET_PLAYER,
    "campaign.journal_entries",
    "journal entry not found"
);
revisioned_update!(
    PatchJournal,
    JournalEntry,
    UPDATE,
    target,
    caller,
    campaign_id,
    id,
    body,
    &[
        &campaign_id as &(dyn ::postgres::types::ToSql + Sync),
        &id,
        &body.body,
        &visibility_name(&body.visibility),
        &i64::from(body.expected_revision)
    ]
);

pub fn create(
    client: &mut Client,
    scope: Scope<'_>,
    body: NewJournal,
) -> Result<JournalEntry, ApiError> {
    access::require_member(client, scope.caller, scope.campaign_id)?;
    if body.visibility == Visibility::Dm {
        access::require_dm(client, scope.caller, scope.campaign_id)?;
    }
    let entry = JournalEntry {
        id: next_id(client, scope.caller)?,
        campaign_id: scope.campaign_id.to_string(),
        session_id: body.session_id,
        body: body.body,
        visibility: body.visibility,
        revision: 1,
    };
    NotesRepository::create_journal(client, &entry)
        .map_err(|error| ApiError::from_persistence(error, scope.caller))?;
    Ok(entry)
}

fn visibility_name(visibility: &Visibility) -> &'static str {
    match visibility {
        Visibility::Players => "players",
        Visibility::Dm => "dm",
    }
}
