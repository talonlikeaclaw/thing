//! Domain errors. The server maps these to HTTP status codes in one place.

use thiserror::Error;

/// Every failure the domain reports; the server maps each to one status code.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("{0} not found")]
    NotFound(String),
    #[error("{0} already exists")]
    AlreadyExists(String),
    #[error("invalid {field}: {message}")]
    ValidationFailed { field: String, message: String },
    #[error("conflict: {reason}")]
    Conflict { reason: String },
    #[error("unsupported format version {0}")]
    UnsupportedFormat(u32),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn displays_field_and_message() {
        let err = CoreError::ValidationFailed {
            field: "watering_interval_days".to_owned(),
            message: "expected a number".to_owned(),
        };
        assert_eq!(
            err.to_string(),
            "invalid watering_interval_days: expected a number"
        );
    }

    #[test]
    fn io_converts_with_question_mark() {
        fn read() -> Result<(), CoreError> {
            std::fs::read_to_string("/nonexistent/thing/probe")?;
            Ok(())
        }
        assert!(matches!(read(), Err(CoreError::Io(_))));
    }
}
