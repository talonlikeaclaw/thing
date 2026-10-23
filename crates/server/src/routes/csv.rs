//! CSV export and import for one type.
//!
//! Export is a projection: the header comes from the type definition and the
//! cells from the values the objects hold. Import is create-only and
//! all-or-nothing at validation; the store has no multi-file transaction, so an
//! I/O failure reports what landed instead of rolling back a file it was given.

use std::collections::BTreeMap;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use thing_core::csv::{self as codec, CsvParse, CsvProblem};
use thing_core::index::SpaceIndex;
use thing_core::model::{ObjectDoc, Revision, RevisionAction, Role};
use thing_core::store::SpaceStore;
use thing_core::value;
use time::OffsetDateTime;
use uuid::Uuid;

use super::objects::snapshot_of;
use super::{ApiQuery, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::state::SharedState;

/// Most bytes an import accepts; a file at 5 MiB exactly is still read.
const MAX_IMPORT_BYTES: usize = 5 * 1024 * 1024;
/// What axum refuses before invoking the handler, leaving room for the 5 MiB
/// check to answer in the JSON envelope.
const IMPORT_BODY_LIMIT: usize = 6 * 1024 * 1024;
/// Most data rows one import may hold.
const MAX_IMPORT_ROWS: usize = 10_000;
/// Rows a dry run previews.
const PREVIEW_ROWS: usize = 20;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/types/{type}/export", get(export))
        .route(
            "/api/spaces/{space}/types/{type}/import",
            post(import).layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT)),
        )
}

/// `GET /api/spaces/{space}/types/{type}/export[?template=true]` [viewer]
///
/// Every live record of the type, ordered by title then id, so two exports of an
/// unchanged space are byte-identical. A template is the same header with no
/// data rows.
async fn export(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, type_key)): Path<(String, String)>,
    mut query: ApiQuery,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let template = query.parse::<bool>("template")?.unwrap_or(false);
    query.finish()?;

    let text = handle.with_index(|index| -> Result<String, ApiError> {
        let def = index
            .type_def(&type_key)
            .ok_or_else(|| ApiError::not_found(format!("type {type_key}")))?;
        if template {
            return Ok(codec::export(def, &[]));
        }
        let mut records: Vec<&ObjectDoc> = index
            .objects()
            .filter(|doc| doc.type_key == type_key)
            .collect();
        records.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(codec::export(def, &records))
    })?;

    let disposition = format!("attachment; filename=\"thing-{type_key}-{}.csv\"", today());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .map_err(|_| ApiError::internal("the type key cannot name a file"))?,
    );
    tracing::info!(
        space = %space,
        user = %caller.user.id,
        type_key = %type_key,
        template,
        "type exported"
    );
    Ok((headers, text).into_response())
}

/// The UTC date in the export filename.
fn today() -> String {
    let date = OffsetDateTime::now_utc().date();
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

/// `POST /api/spaces/{space}/types/{type}/import?dry_run=true|false` [editor]
///
/// Parse and validate first. A dry run answers with the problems and a preview;
/// a commit refuses every problem with `422` and writes nothing. The parse is
/// repeated under the write lock, so a schema change between the two passes
/// cannot commit rows checked against an older type.
async fn import(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, type_key)): Path<(String, String)>,
    headers: HeaderMap,
    mut query: ApiQuery,
    body: Bytes,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let dry_run = query.parse::<bool>("dry_run")?.unwrap_or(false);
    query.finish()?;

    if !is_csv(&headers) {
        return Err(ApiError::validation("content-type", "expected text/csv"));
    }
    if body.len() > MAX_IMPORT_BYTES {
        return Err(problems_error(vec![file_problem(format!(
            "the file is {} bytes; the limit is 5 MiB",
            body.len()
        ))]));
    }
    let text = std::str::from_utf8(&body)
        .map_err(|_| problems_error(vec![file_problem("the file is not valid UTF-8")]))?;

    let parsed = handle.with_index(|index| parse_against(index, &type_key, text))?;
    let parsed = within_row_limit(parsed)?;
    if dry_run {
        return Ok(Json(dry_run_json(&parsed)).into_response());
    }
    if !parsed.problems.is_empty() {
        return Err(problems_error(parsed.problems));
    }

    let _guard = handle.write.lock().await;
    // The type may have changed while this request waited for the lock, so the
    // rows are checked against the definition that will actually receive them.
    let parsed = handle.with_index(|index| parse_against(index, &type_key, text))?;
    let parsed = within_row_limit(parsed)?;
    if !parsed.problems.is_empty() {
        return Err(problems_error(parsed.problems));
    }

    let now = OffsetDateTime::now_utc();
    let mut created: Vec<Value> = Vec::with_capacity(parsed.records.len());
    for record in parsed.records {
        let doc = ObjectDoc {
            id: Uuid::now_v7(),
            type_key: type_key.clone(),
            title: record.title,
            rev: 1,
            created_at: now,
            updated_at: now,
            created_by: caller.user.id,
            updated_by: caller.user.id,
            trashed_at: None,
            trashed_from: None,
            properties: record.properties,
            body: record.body,
        };
        let path = handle
            .store
            .new_object_path(&type_key, &doc.title)
            .map_err(|error| partial_failure(error, &created))?;
        handle
            .store
            .save_object(&path, &doc, None)
            .map_err(|error| partial_failure(error, &created))?;
        created.push(json!({ "id": doc.id, "title": doc.title }));
        handle
            .store
            .append_revision(
                doc.id,
                &Revision {
                    rev: doc.rev,
                    at: now,
                    by: caller.user.id,
                    action: RevisionAction::Create,
                    snapshot: snapshot_of(&doc),
                    body: Some(doc.body.clone()),
                },
            )
            .map_err(|error| partial_failure(error, &created))?;
        handle
            .with_index_mut(|index| index.reload_file(&handle.store, &path))
            .map_err(|error| partial_failure(error, &created))?;
    }

    let count = created.len();
    handle.broadcast(
        "objects.imported",
        json!({ "type": type_key, "count": count }),
    );
    tracing::info!(
        space = %space,
        user = %caller.user.id,
        type_key = %type_key,
        count,
        "type imported"
    );
    Ok((
        StatusCode::CREATED,
        Json(json!({ "count": count, "created": created })),
    )
        .into_response())
}

/// Parses against the current index, refusing a type that does not exist.
fn parse_against(index: &SpaceIndex, type_key: &str, text: &str) -> Result<CsvParse, ApiError> {
    let def = index
        .type_def(type_key)
        .ok_or_else(|| ApiError::not_found(format!("type {type_key}")))?;
    Ok(codec::parse(&index.schema(), def, text))
}

/// Refuses a file over the row cap before anything is written.
fn within_row_limit(parsed: CsvParse) -> Result<CsvParse, ApiError> {
    if parsed.rows > MAX_IMPORT_ROWS {
        return Err(problems_error(vec![file_problem(format!(
            "the file has {} data rows; the limit is {MAX_IMPORT_ROWS}",
            parsed.rows
        ))]));
    }
    Ok(parsed)
}

/// Whether the request's `Content-Type` names CSV, ignoring parameters.
fn is_csv(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/csv"))
        })
}

fn file_problem(message: impl Into<String>) -> CsvProblem {
    CsvProblem {
        row: 0,
        field: "csv".to_owned(),
        message: message.into(),
    }
}

fn problems_error(problems: Vec<CsvProblem>) -> ApiError {
    ApiError::validation_details(errors_json(&problems))
}

fn errors_json(problems: &[CsvProblem]) -> Vec<Value> {
    problems
        .iter()
        .map(|problem| {
            json!({
                "row": problem.row,
                "field": problem.field,
                "message": problem.message,
            })
        })
        .collect()
}

/// What a dry run returns: every problem and at most twenty valid rows.
fn dry_run_json(parsed: &CsvParse) -> Value {
    let preview: Vec<Value> = parsed
        .records
        .iter()
        .take(PREVIEW_ROWS)
        .map(|record| {
            let values: BTreeMap<&str, Value> = record
                .properties
                .iter()
                .map(|(key, value)| (key.as_str(), value::to_json(value)))
                .collect();
            json!({
                "row": record.row,
                "title": record.title,
                "values": values,
            })
        })
        .collect();
    json!({
        "rows": parsed.rows,
        "valid": parsed.problems.is_empty(),
        "errors": errors_json(&parsed.problems),
        "preview": preview,
    })
}

/// A write failed after some files had already landed: the response names them.
fn partial_failure(error: impl std::fmt::Display, created: &[Value]) -> ApiError {
    ApiError::internal_details(
        format!(
            "the import stopped after writing {} record(s): {error}",
            created.len()
        ),
        json!({ "created": created }),
    )
}
