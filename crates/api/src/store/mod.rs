//! Application operations coordinate authorization and typed persistence repositories.
/// Collections authorize membership before a typed repository fetch.
macro_rules! collection_list {
    ($dto:ty, $repository:ident, $method:ident) => {
        pub fn list(
            client: &mut ::postgres::Client,
            scope: $crate::store::Scope<'_>,
            page: $crate::query::Page,
        ) -> Result<$crate::query::PageBody<$dto>, $crate::error::ApiError> {
            $crate::access::require_member(client, scope.caller, scope.campaign_id)?;
            let rows = $repository::$method(client, scope.campaign_id, $crate::store::window(page))
                .map_err(|error| $crate::error::ApiError::from_persistence(error, scope.caller))?;
            Ok(page.finish(rows))
        }
    };
}

/// Role-based projections stay explicit when application policy calls typed repositories.
macro_rules! visible_reads {
    ($dto:ty, $repository:ident, $list:ident, $get:ident, $missing:expr) => {
        pub fn list(
            client: &mut ::postgres::Client,
            scope: $crate::store::Scope<'_>,
            page: $crate::query::Page,
        ) -> Result<$crate::query::PageBody<$dto>, $crate::error::ApiError> {
            let role = $crate::access::require_member(client, scope.caller, scope.campaign_id)?;
            let read = ::desire_persistence::CampaignRead {
                campaign_id: scope.campaign_id,
                audience: $crate::store::audience(role),
            };
            let rows = $repository::$list(client, read, $crate::store::window(page))
                .map_err(|error| $crate::error::ApiError::from_persistence(error, scope.caller))?;
            Ok(page.finish(rows))
        }

        pub fn get(
            client: &mut ::postgres::Client,
            target: $crate::store::Target<'_>,
        ) -> Result<$dto, $crate::error::ApiError> {
            let scope = target.scope;
            let role = $crate::access::require_member(client, scope.caller, scope.campaign_id)?;
            $repository::$get(
                client,
                $crate::store::record_target(target),
                $crate::store::audience(role),
            )
            .map_err(|error| $crate::error::ApiError::from_persistence(error, scope.caller))?
            .ok_or_else(|| $crate::error::ApiError::not_found(scope.caller, $missing))
        }
    };
}

pub mod campaigns;
pub mod characters;
pub mod journal;
pub mod knowledge;
pub mod members;
pub mod nivel20;
pub mod scenes;
pub mod sessions;

use crate::{error::ApiError, extract::Caller, query::Page};
use desire_core::contracts::common::MemberRole;
use desire_persistence::{Audience, FetchPage, RecordTarget};
use postgres::Client;

#[derive(Clone, Copy)]
pub struct Scope<'a> {
    pub caller: &'a Caller,
    pub campaign_id: &'a str,
}

#[derive(Clone, Copy)]
pub struct Target<'a> {
    pub scope: Scope<'a>,
    pub id: &'a str,
}

pub(crate) fn next_id(client: &mut Client, caller: &Caller) -> Result<String, ApiError> {
    desire_persistence::next_id(client).map_err(|error| ApiError::from_persistence(error, caller))
}

pub(crate) fn window(page: Page) -> FetchPage {
    let (limit, offset) = page.fetch();
    FetchPage { limit, offset }
}

pub(crate) fn record_target(target: Target<'_>) -> RecordTarget<'_> {
    RecordTarget {
        campaign_id: target.scope.campaign_id,
        id: target.id,
    }
}

/// A revision the column could not hold is the caller's error, not a storage failure.
pub(crate) fn next_revision(expected: u32, caller: &Caller) -> Result<u32, ApiError> {
    expected
        .checked_add(1)
        .ok_or_else(|| ApiError::invalid(caller, "expected_revision is too large"))
}

/// A missing row from a revision-guarded update means the expected revision is stale.
pub(crate) fn updated<T>(
    outcome: Result<Option<T>, desire_persistence::Error>,
    caller: &Caller,
) -> Result<T, ApiError> {
    outcome
        .map_err(|error| ApiError::from_persistence(error, caller))?
        .ok_or_else(|| ApiError::revision_conflict(caller))
}

pub(crate) fn audience(role: MemberRole) -> Audience {
    match role {
        MemberRole::Dm => Audience::All,
        MemberRole::Player => Audience::Players,
    }
}
