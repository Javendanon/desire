//! SQL adapters. These are the only modules that issue queries.

/// List a campaign-owned collection.
macro_rules! collection_list {
    ($dto:ty, $list_sql:expr) => {
        pub fn list(
            client: &mut ::postgres::Client,
            scope: $crate::store::Scope<'_>,
            page: $crate::query::Page,
        ) -> Result<$crate::query::PageBody<$dto>, $crate::error::ApiError> {
            $crate::store::list_for_member(client, scope, page, $list_sql)
        }
    };
}

/// List and delete for a campaign-owned collection.
macro_rules! collection_crud {
    ($dto:ty, $list_sql:expr, $table:expr, $missing:expr) => {
        collection_list!($dto, $list_sql);

        pub fn delete(
            client: &mut ::postgres::Client,
            target: $crate::store::Target<'_>,
        ) -> Result<(), $crate::error::ApiError> {
            $crate::store::delete_row(client, target, $table, $missing)
        }
    };
}

/// One entry readable by any member of the campaign.
macro_rules! member_entry {
    ($dto:ty, $get_sql:expr, $missing:expr) => {
        pub fn get(
            client: &mut ::postgres::Client,
            target: $crate::store::Target<'_>,
        ) -> Result<$dto, $crate::error::ApiError> {
            $crate::store::member_row(client, target, $get_sql, $missing)
        }
    };
}

/// List, read and delete with DM-only rows hidden from players.
macro_rules! visible_crud {
    ($dto:ty, $dm_list:expr, $player_list:expr, $dm_get:expr, $player_get:expr,
     $table:expr, $missing:expr) => {
        pub fn list(
            client: &mut ::postgres::Client,
            scope: $crate::store::Scope<'_>,
            page: $crate::query::Page,
        ) -> Result<$crate::query::PageBody<$dto>, $crate::error::ApiError> {
            $crate::store::list_visible(
                client,
                scope,
                page,
                $crate::store::Visible {
                    dm: $dm_list,
                    player: $player_list,
                },
            )
        }

        pub fn get(
            client: &mut ::postgres::Client,
            target: $crate::store::Target<'_>,
        ) -> Result<$dto, $crate::error::ApiError> {
            $crate::store::visible_row(
                client,
                target,
                $crate::store::Visible {
                    dm: $dm_get,
                    player: $player_get,
                },
                $missing,
            )
        }

        pub fn delete(
            client: &mut ::postgres::Client,
            target: $crate::store::Target<'_>,
        ) -> Result<(), $crate::error::ApiError> {
            $crate::store::delete_row(client, target, $table, $missing)
        }
    };
}

/// Optimistic update shared by resources whose patch shape is flat.
macro_rules! revisioned_update {
    ($patch:ty, $dto:ty, $sql:expr,
     $target:ident, $caller:ident, $campaign:ident, $id:ident, $body:ident, $params:expr) => {
        pub fn update(
            client: &mut ::postgres::Client,
            $target: $crate::store::Target<'_>,
            $body: $patch,
        ) -> Result<$dto, $crate::error::ApiError> {
            let $caller = $target.scope.caller;
            let $campaign = $target.scope.campaign_id;
            let $id = $target.id;
            $crate::access::require_dm(client, $caller, $campaign)?;
            get(client, $target)?;
            let affected = $crate::store::execute(client, $sql, $params, $caller)?;
            $crate::store::check_revision(affected, $caller)?;
            get(client, $target)
        }
    };
}

pub mod campaigns;
pub mod characters;
pub mod journal;
pub mod knowledge;
pub mod members;
pub mod scenes;

use crate::{
    access,
    error::{ApiError, INTERNAL},
    extract::Caller,
    query::{Page, PageBody},
};
use desire_core::contracts::common::MemberRole;
use postgres::{Client, Row, types::ToSql};
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Caller plus the campaign that owns the row.
#[derive(Clone, Copy)]
pub struct Scope<'a> {
    pub caller: &'a Caller,
    pub campaign_id: &'a str,
}

/// One named row inside a campaign.
#[derive(Clone, Copy)]
pub struct Target<'a> {
    pub scope: Scope<'a>,
    pub id: &'a str,
}

/// DM and player SQL variants for a visibility-filtered resource.
#[derive(Clone, Copy)]
pub struct Visible<'a> {
    pub dm: &'a str,
    pub player: &'a str,
}

/// IDs come from PostgreSQL so the API needs no UUID generation dependency.
pub(crate) fn next_id(client: &mut Client, caller: &Caller) -> Result<String, ApiError> {
    client
        .query_one("SELECT gen_random_uuid()::text", &[])
        .map(|row| row.get(0))
        .map_err(|error| ApiError::from_postgres(&error, caller))
}

pub(crate) fn query(
    client: &mut Client,
    sql: &str,
    params: &[&(dyn ToSql + Sync)],
    caller: &Caller,
) -> Result<Vec<Row>, ApiError> {
    client
        .query(sql, params)
        .map_err(|error| ApiError::from_postgres(&error, caller))
}

pub(crate) fn query_opt(
    client: &mut Client,
    sql: &str,
    params: &[&(dyn ToSql + Sync)],
    caller: &Caller,
) -> Result<Option<Row>, ApiError> {
    client
        .query_opt(sql, params)
        .map_err(|error| ApiError::from_postgres(&error, caller))
}

pub(crate) fn execute(
    client: &mut Client,
    sql: &str,
    params: &[&(dyn ToSql + Sync)],
    caller: &Caller,
) -> Result<u64, ApiError> {
    client
        .execute(sql, params)
        .map_err(|error| ApiError::from_postgres(&error, caller))
}

/// Foreign-key failures on a delete mean the row is still referenced.
pub(crate) fn execute_delete(
    client: &mut Client,
    sql: &str,
    params: &[&(dyn ToSql + Sync)],
    caller: &Caller,
) -> Result<u64, ApiError> {
    client
        .execute(sql, params)
        .map_err(|error| ApiError::from_delete(&error, caller))
}

pub(crate) fn decode<T: DeserializeOwned>(row: Row, caller: &Caller) -> Result<T, ApiError> {
    let value: Value = row.get(0);
    serde_json::from_value(value).map_err(|_| {
        ApiError::new(
            INTERNAL,
            "internal",
            "stored record no longer matches the contract",
            &caller.request_id,
        )
    })
}

pub(crate) fn decode_all<T: DeserializeOwned>(
    rows: Vec<Row>,
    caller: &Caller,
) -> Result<Vec<T>, ApiError> {
    rows.into_iter().map(|row| decode(row, caller)).collect()
}

/// Fetch one row plus one extra to compute `has_more`.
pub(crate) fn page_query<T: DeserializeOwned>(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
    sql: &str,
) -> Result<PageBody<T>, ApiError> {
    let (limit, offset) = page.fetch();
    let params: &[&(dyn ToSql + Sync)] = &[&scope.campaign_id, &limit, &offset];
    let rows = query(client, sql, params, scope.caller)?;
    Ok(page.finish(decode_all(rows, scope.caller)?))
}

pub(crate) fn list_for_member<T: DeserializeOwned>(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
    sql: &str,
) -> Result<PageBody<T>, ApiError> {
    access::require_member(client, scope.caller, scope.campaign_id)?;
    page_query(client, scope, page, sql)
}

pub(crate) fn list_visible<T: DeserializeOwned>(
    client: &mut Client,
    scope: Scope<'_>,
    page: Page,
    visible: Visible<'_>,
) -> Result<PageBody<T>, ApiError> {
    let role = access::require_member(client, scope.caller, scope.campaign_id)?;
    let sql = if role == MemberRole::Dm {
        visible.dm
    } else {
        visible.player
    };
    page_query(client, scope, page, sql)
}

pub(crate) fn member_row<T: DeserializeOwned>(
    client: &mut Client,
    target: Target<'_>,
    sql: &str,
    missing: &str,
) -> Result<T, ApiError> {
    access::require_member(client, target.scope.caller, target.scope.campaign_id)?;
    row_by_id(client, target, sql, missing)
}

/// One entry visible to the caller; hidden DM rows look absent to players.
pub(crate) fn visible_row<T: DeserializeOwned>(
    client: &mut Client,
    target: Target<'_>,
    visible: Visible<'_>,
    missing: &str,
) -> Result<T, ApiError> {
    let scope = target.scope;
    let role = access::require_member(client, scope.caller, scope.campaign_id)?;
    let sql = if role == MemberRole::Dm {
        visible.dm
    } else {
        visible.player
    };
    row_by_id(client, target, sql, missing)
}

fn row_by_id<T: DeserializeOwned>(
    client: &mut Client,
    target: Target<'_>,
    sql: &str,
    missing: &str,
) -> Result<T, ApiError> {
    let params: &[&(dyn ToSql + Sync)] = &[&target.scope.campaign_id, &target.id];
    query_opt(client, sql, params, target.scope.caller)?
        .map(|row| decode(row, target.scope.caller))
        .unwrap_or_else(|| Err(ApiError::not_found(target.scope.caller, missing)))
}

/// Table names are module constants, never request input.
pub(crate) fn delete_row(
    client: &mut Client,
    target: Target<'_>,
    table: &str,
    missing: &str,
) -> Result<(), ApiError> {
    access::require_dm(client, target.scope.caller, target.scope.campaign_id)?;
    let sql = format!(
        "DELETE FROM {table} \
         WHERE campaign_id = $1::text::uuid AND id = $2::text::uuid"
    );
    let params: &[&(dyn ToSql + Sync)] = &[&target.scope.campaign_id, &target.id];
    let affected = execute_delete(client, &sql, params, target.scope.caller)?;
    if affected == 0 {
        return Err(ApiError::not_found(target.scope.caller, missing));
    }
    Ok(())
}

pub(crate) fn check_revision(affected: u64, caller: &Caller) -> Result<(), ApiError> {
    if affected == 0 {
        Err(ApiError::revision_conflict(caller))
    } else {
        Ok(())
    }
}

pub(crate) fn role_name(role: &MemberRole) -> &'static str {
    match role {
        MemberRole::Dm => "dm",
        MemberRole::Player => "player",
    }
}
