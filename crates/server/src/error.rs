//! One place where a domain error becomes an HTTP response.
//!
//! Every handler returns `Result<_, ApiError>`; the status code and the
//! `{"error":{...}}` body are decided here and nowhere else.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use thing_core::error::CoreError;

/// A failed API call: the status and body it renders as.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Value,
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
