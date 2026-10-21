//! One place where a domain error becomes an HTTP response.
//!
//! Every handler returns `Result<_, ApiError>`; the status code and the
//! `{"error":{...}}` body are decided here and nowhere else.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use thing_core::error::CoreError;

use crate::accounts::AccountError;

/// A failed API call: the status and body it renders as.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Value,
}

impl ApiError {
    /// `401` — no session, or one that has ended.
    pub fn unauthenticated(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthenticated", message)
    }

    /// `403` — signed in, but not allowed to do this.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }

    /// `404` — nothing here, or not for this caller.
    pub fn not_found(what: impl std::fmt::Display) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("{what} not found"),
        )
    }

    /// `422` — the request is well-formed but not acceptable.
    pub fn validation(field: &str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "validation_failed",
            message: message.into(),
            details: json!({ "field": field }),
        }
    }

    /// `422` — a document failed more than one rule. The first error is the
    /// response's own; `details.errors` carries every message, so a form can
    /// show each one at once instead of one per round trip.
    pub fn validation_all(errors: Vec<CoreError>) -> Self {
        let details: Vec<Value> = errors
            .iter()
            .map(|error| match error {
                CoreError::ValidationFailed { field, message } => {
                    json!({ "field": field, "message": message })
                }
                other => json!({ "field": "body", "message": other.to_string() }),
            })
            .collect();
        let mut refused = errors.into_iter().next().map_or_else(
            || Self::validation("body", "the request was refused"),
            Self::from,
        );
        refused.status = StatusCode::UNPROCESSABLE_ENTITY;
        refused.code = "validation_failed";
        if let Some(field) = details.first().and_then(|error| error["field"].as_str()) {
            refused.details = json!({ "field": field, "errors": details });
        }
        refused
    }

    /// The message the response carries, for tests.
    #[cfg(test)]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The details the response carries, for tests.
    #[cfg(test)]
    pub fn details(&self) -> &Value {
        &self.details
    }

    /// `409` — the request cannot be applied to the current state; `details`
    /// says which state and what about it.
    pub fn conflict(message: impl Into<String>, details: Value) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "conflict",
            message: message.into(),
            details,
        }
    }

    /// `500` — the server broke, not the request.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
    }

    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: json!({}),
        }
    }
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::NotFound(what) => Self {
                status: StatusCode::NOT_FOUND,
                code: "not_found",
                message: format!("{what} not found"),
                details: json!({}),
            },
            CoreError::AlreadyExists(what) => Self {
                status: StatusCode::CONFLICT,
                code: "conflict",
                message: format!("{what} already exists"),
                details: json!({}),
            },
            CoreError::ValidationFailed { field, message } => Self {
                status: StatusCode::UNPROCESSABLE_ENTITY,
                code: "validation_failed",
                message,
                details: json!({ "field": field }),
            },
            CoreError::Conflict { reason } => Self {
                status: StatusCode::CONFLICT,
                code: "conflict",
                message: reason.clone(),
                details: json!({ "reason": reason }),
            },
            CoreError::UnsupportedFormat(version) => Self {
                status: StatusCode::UNPROCESSABLE_ENTITY,
                code: "validation_failed",
                message: format!("unsupported format version {version}"),
                details: json!({ "schema": version }),
            },
            CoreError::Io(err) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                code: "internal",
                message: err.to_string(),
                details: json!({}),
            },
        }
    }
}

/// `AccountError` has no domain status of its own: a taken email is a conflict,
/// everything else is the database failing.
impl From<AccountError> for ApiError {
    fn from(err: AccountError) -> Self {
        match err {
            AccountError::EmailTaken(email) => Self::new(
                StatusCode::CONFLICT,
                "conflict",
                format!("{email} is already registered"),
            ),
            other => Self::internal(other.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        });
        (self.status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn every_domain_error_gets_one_status_and_code() {
        let cases = [
            (
                CoreError::NotFound("plant".to_owned()),
                StatusCode::NOT_FOUND,
                "not_found",
            ),
            (
                CoreError::AlreadyExists("plant".to_owned()),
                StatusCode::CONFLICT,
                "conflict",
            ),
            (
                CoreError::ValidationFailed {
                    field: "room".to_owned(),
                    message: "expected a text".to_owned(),
                },
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_failed",
            ),
            (
                CoreError::Conflict {
                    reason: "file changed on disk".to_owned(),
                },
                StatusCode::CONFLICT,
                "conflict",
            ),
            (
                CoreError::UnsupportedFormat(2),
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_failed",
            ),
            (
                CoreError::Io(io::Error::other("disk on fire")),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
            ),
        ];

        for (err, status, code) in cases {
            let error = ApiError::from(err);
            assert_eq!(error.status, status, "status for {code}");
            assert_eq!(error.code, code);
        }
    }

    #[test]
    fn the_documented_codes_map_to_the_documented_statuses() {
        let cases = [
            (
                ApiError::unauthenticated("x"),
                StatusCode::UNAUTHORIZED,
                "unauthenticated",
            ),
            (ApiError::forbidden("x"), StatusCode::FORBIDDEN, "forbidden"),
            (ApiError::not_found("x"), StatusCode::NOT_FOUND, "not_found"),
            (
                ApiError::from(CoreError::AlreadyExists("x".to_owned())),
                StatusCode::CONFLICT,
                "conflict",
            ),
            (
                ApiError::validation("name", "x"),
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_failed",
            ),
            (
                ApiError::internal("x"),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
            ),
        ];

        for (error, status, code) in cases {
            assert_eq!(error.status, status, "status for {code}");
            assert_eq!(error.code, code);
        }
    }

    #[test]
    fn a_taken_email_is_a_conflict_and_a_broken_database_is_not() {
        let taken = ApiError::from(AccountError::EmailTaken("a@b.c".to_owned()));
        assert_eq!(taken.status, StatusCode::CONFLICT);
        assert_eq!(taken.message, "a@b.c is already registered");

        let broken = ApiError::from(AccountError::Database(rusqlite::Error::QueryReturnedNoRows));
        assert_eq!(broken.status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn validation_failure_names_the_field_and_conflict_carries_the_reason() {
        let invalid = ApiError::from(CoreError::ValidationFailed {
            field: "room".to_owned(),
            message: "expected a text".to_owned(),
        });
        assert_eq!(invalid.details, json!({ "field": "room" }));
        assert_eq!(invalid.message, "expected a text");

        let stale = ApiError::from(CoreError::Conflict {
            reason: "file changed on disk".to_owned(),
        });
        assert_eq!(stale.details, json!({ "reason": "file changed on disk" }));
    }
}
