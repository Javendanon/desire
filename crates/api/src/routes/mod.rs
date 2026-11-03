//! Route assembly. Endpoints are versioned under `/api/v1`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

/// List handler for a campaign-owned collection.
macro_rules! list_handler {
    ($resource:ident, $dto:ty) => {
        pub async fn list(
            axum::extract::State(state): axum::extract::State<$crate::AppState>,
            caller: $crate::extract::Caller,
            axum::extract::Path(campaign_id): axum::extract::Path<String>,
            $crate::extract::ApiQuery(query): $crate::extract::ApiQuery<$crate::query::PageQuery>,
        ) -> Result<axum::Json<$crate::query::PageBody<$dto>>, $crate::error::ApiError> {
            let campaign_id = $crate::routes::id_path(&caller, campaign_id, "campaign_id")?;
            let page = $crate::query::Page::from_query(&query, &caller)?;
            $crate::routes::respond(&state, caller.request_id.clone(), move |client| {
                let scope = $crate::routes::scope(&caller, &campaign_id);
                $crate::store::$resource::list(client, scope, page)
            })
            .await
        }
    };
}

/// Read handler for one campaign-owned row.
macro_rules! get_handler {
    ($resource:ident, $dto:ty, $id_field:literal) => {
        pub async fn get(
            axum::extract::State(state): axum::extract::State<$crate::AppState>,
            caller: $crate::extract::Caller,
            axum::extract::Path((campaign_id, resource_id)): axum::extract::Path<(String, String)>,
        ) -> Result<axum::Json<$dto>, $crate::error::ApiError> {
            let (campaign_id, resource_id) =
                $crate::routes::pair_path(&caller, campaign_id, resource_id, $id_field)?;
            $crate::routes::respond(&state, caller.request_id.clone(), move |client| {
                let target = $crate::routes::target(&caller, &campaign_id, &resource_id);
                $crate::store::$resource::get(client, target)
            })
            .await
        }
    };
}

/// Create handler for resources with a flat create payload.
macro_rules! create_handler {
    ($resource:ident, $dto:ty, $new:ty) => {
        pub async fn create(
            axum::extract::State(state): axum::extract::State<$crate::AppState>,
            caller: $crate::extract::Caller,
            axum::extract::Path(campaign_id): axum::extract::Path<String>,
            $crate::extract::ApiJson(body): $crate::extract::ApiJson<$new>,
        ) -> Result<(axum::http::StatusCode, axum::Json<$dto>), $crate::error::ApiError> {
            let campaign_id = $crate::routes::id_path(&caller, campaign_id, "campaign_id")?;
            let body = body.clean(&caller)?;
            let dto = $crate::db::blocking(&state.db, caller.request_id.clone(), move |client| {
                let scope = $crate::routes::scope(&caller, &campaign_id);
                $crate::store::$resource::create(client, scope, body)
            })
            .await?;
            Ok((axum::http::StatusCode::CREATED, axum::Json(dto)))
        }
    };
}

/// Update handler with optimistic revisions.
macro_rules! update_handler {
    ($resource:ident, $dto:ty, $patch:ty, $id_field:literal) => {
        pub async fn update(
            axum::extract::State(state): axum::extract::State<$crate::AppState>,
            caller: $crate::extract::Caller,
            axum::extract::Path((campaign_id, resource_id)): axum::extract::Path<(String, String)>,
            $crate::extract::ApiJson(body): $crate::extract::ApiJson<$patch>,
        ) -> Result<axum::Json<$dto>, $crate::error::ApiError> {
            let (campaign_id, resource_id) =
                $crate::routes::pair_path(&caller, campaign_id, resource_id, $id_field)?;
            let body = body.clean(&caller)?;
            $crate::routes::respond(&state, caller.request_id.clone(), move |client| {
                let target = $crate::routes::target(&caller, &campaign_id, &resource_id);
                $crate::store::$resource::update(client, target, body)
            })
            .await
        }
    };
}

/// Delete handler with role and reference checks in the store.
macro_rules! delete_handler {
    ($resource:ident, $id_field:literal) => {
        pub async fn delete(
            axum::extract::State(state): axum::extract::State<$crate::AppState>,
            caller: $crate::extract::Caller,
            axum::extract::Path((campaign_id, resource_id)): axum::extract::Path<(String, String)>,
        ) -> Result<axum::http::StatusCode, $crate::error::ApiError> {
            let (campaign_id, resource_id) =
                $crate::routes::pair_path(&caller, campaign_id, resource_id, $id_field)?;
            $crate::db::blocking(&state.db, caller.request_id.clone(), move |client| {
                let target = $crate::routes::target(&caller, &campaign_id, &resource_id);
                $crate::store::$resource::delete(client, target)
            })
            .await?;
            Ok(axum::http::StatusCode::NO_CONTENT)
        }
    };
}

pub mod campaigns;
pub mod characters;
pub mod health;
pub mod journal;
pub mod knowledge;
pub mod members;
pub mod nivel20;
pub mod scenes;
pub mod sessions;
pub mod sync;

use crate::{
    AppState, db,
    error::ApiError,
    extract::Caller,
    validation::{self, or_invalid},
};
use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, post},
};

fn campaign_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns",
            get(campaigns::list).post(campaigns::create),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}",
            get(campaigns::get).patch(campaigns::rename),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/members",
            get(members::list).post(members::add),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/members/{user_id}",
            delete(members::remove),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/sessions",
            get(sessions::list).post(sessions::create),
        )
        .route("/api/v1/campaigns/{campaign_id}/sync", get(sync::batch))
}

fn scene_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/scenes",
            get(scenes::list).post(scenes::create),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/scenes/{scene_id}",
            get(scenes::get).patch(scenes::update),
        )
}

fn character_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/characters",
            get(characters::list).post(characters::create),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/characters/{character_id}",
            get(characters::get)
                .patch(characters::update)
                .delete(characters::delete),
        )
}

fn note_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/journal",
            get(journal::list).post(journal::create),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/journal/{entry_id}",
            get(journal::get)
                .patch(journal::update)
                .delete(journal::delete),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/knowledge",
            get(knowledge::list).post(knowledge::create),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/knowledge/{entry_id}",
            get(knowledge::get)
                .patch(knowledge::update)
                .delete(knowledge::delete),
        )
}

fn nivel20_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/nivel20",
            get(nivel20::stored),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/nivel20/preview",
            post(nivel20::preview),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/nivel20/import",
            post(nivel20::import),
        )
}

fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/accounts", post(crate::auth::routes::register))
        .route("/api/v1/auth/sessions", post(crate::auth::routes::login))
        .route(
            "/api/v1/auth/sessions/current",
            delete(crate::auth::routes::logout),
        )
        .route("/api/v1/auth/identity", get(crate::auth::routes::identity))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .merge(auth_routes())
        .merge(campaign_routes())
        .merge(scene_routes())
        .merge(character_routes())
        .merge(note_routes())
        .merge(nivel20_routes())
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state)
}

pub(crate) fn scope<'a>(caller: &'a Caller, campaign_id: &'a str) -> crate::store::Scope<'a> {
    crate::store::Scope {
        caller,
        campaign_id,
    }
}

pub(crate) fn target<'a>(
    caller: &'a Caller,
    campaign_id: &'a str,
    id: &'a str,
) -> crate::store::Target<'a> {
    crate::store::Target {
        scope: scope(caller, campaign_id),
        id,
    }
}

pub(crate) fn id_path(caller: &Caller, value: String, field: &str) -> Result<String, ApiError> {
    or_invalid(validation::id(&value, field), caller)
}

pub(crate) fn pair_path(
    caller: &Caller,
    campaign_id: String,
    id: String,
    field: &str,
) -> Result<(String, String), ApiError> {
    Ok((
        id_path(caller, campaign_id, "campaign_id")?,
        id_path(caller, id, field)?,
    ))
}

/// Run one store call and wrap its DTO in the response body.
pub(crate) async fn respond<T, F>(
    state: &AppState,
    request_id: String,
    work: F,
) -> Result<axum::Json<T>, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut postgres::Client) -> Result<T, ApiError> + Send + 'static,
{
    Ok(axum::Json(db::blocking(&state.db, request_id, work).await?))
}
