//! One error shape for every handler, reusing the D04 `ApiError` transport DTO.
use crate::{extract::Caller, ids};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use desire_core::contracts::transport::ApiError as ApiErrorBody;
use desire_persistence::ErrorKind;

pub const INVALID: StatusCode = StatusCode::BAD_REQUEST;
pub const UNAUTHORIZED: StatusCode = StatusCode::UNAUTHORIZED;
pub const FORBIDDEN: StatusCode = StatusCode::FORBIDDEN;
pub const NOT_FOUND: StatusCode = StatusCode::NOT_FOUND;
pub const CONFLICT: StatusCode = StatusCode::CONFLICT;
pub const INTERNAL: StatusCode = StatusCode::INTERNAL_SERVER_ERROR;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub request_id: String,
}

impl ApiError {
    pub fn new(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        request_id: impl Into<String>,
    ) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            request_id: request_id.into(),
        }
    }

    pub fn invalid(caller: &Caller, message: impl Into<String>) -> Self {
        Self::new(INVALID, "invalid_request", message, &caller.request_id)
    }

    pub fn forbidden(caller: &Caller, message: impl Into<String>) -> Self {
        Self::new(FORBIDDEN, "forbidden", message, &caller.request_id)
    }

    pub fn not_found(caller: &Caller, message: impl Into<String>) -> Self {
        Self::new(NOT_FOUND, "not_found", message, &caller.request_id)
    }

    pub fn conflict(caller: &Caller, message: impl Into<String>) -> Self {
        Self::new(CONFLICT, "conflict", message, &caller.request_id)
    }

    pub fn in_use(caller: &Caller) -> Self {
        Self::new(
            CONFLICT,
            "resource_in_use",
            "the resource is still referenced and cannot be deleted",
            &caller.request_id,
        )
    }

    pub fn revision_conflict(caller: &Caller) -> Self {
        Self::new(
            CONFLICT,
            "revision_conflict",
            "the expected revision is stale",
            &caller.request_id,
        )
    }

    /// Infrastructure failures happen before a caller exists; the generated ID still
    /// lets a log line and the response body agree.
    pub fn internal(message: impl Into<String>) -> Self {
        let request_id = ids::request_id();
        Self::new(INTERNAL, "internal", message, request_id)
    }

    pub fn from_persistence(error: desire_persistence::Error, caller: &Caller) -> Self {
        if error.kind == ErrorKind::Conflict {
            return Self::revision_conflict(caller);
        }
        Self::from_sqlstate(error.sqlstate.as_deref(), caller)
    }

    /// Deletes treat a foreign-key reference as a conflict, not as invalid input.
    pub fn from_delete(error: &postgres::Error, caller: &Caller) -> Self {
        if error.code().map(|code| code.code()) == Some("23503") {
            return Self::in_use(caller);
        }
        Self::from_postgres(error, caller)
    }

    pub fn from_postgres(error: &postgres::Error, caller: &Caller) -> Self {
        let sqlstate = error.code().map(|code| code.code());
        Self::from_sqlstate(sqlstate, caller)
    }

    fn from_sqlstate(sqlstate: Option<&str>, caller: &Caller) -> Self {
        match sqlstate {
            Some("23503") => Self::invalid(caller, "the request references a missing resource"),
            Some("23505") => Self::conflict(caller, "the resource already exists"),
            Some("23514" | "22P02" | "22003" | "22007" | "22001") => {
                Self::invalid(caller, "a value violates a database constraint")
            }
            Some("40001" | "40P01") => Self::conflict(caller, "retry the request"),
            _ => Self::new(
                INTERNAL,
                "internal",
                "the database operation failed",
                &caller.request_id,
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ApiErrorBody {
            code: self.code.to_string(),
            message: self.message,
            request_id: self.request_id,
        };
        (self.status, Json(body)).into_response()
    }
}
