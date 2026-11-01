//! One ranked read over a space's titles and bodies.
//!
//! The index itself lives in `thing-core`; this module validates the query,
//! resolves the display names a result row shows, and never writes anything.

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Value, json};
use thing_core::model::Role;
use thing_core::search::snippet;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{ApiQuery, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::state::SharedState;

/// The default page; the palette asks for no limit and gets this.
const DEFAULT_LIMIT: usize = 20;
/// The largest page a caller may request.
const MAX_LIMIT: usize = 50;
/// The longest query the route accepts, in characters.
const MAX_QUERY_CHARS: usize = 200;
/// The snippet window, in characters.
const SNIPPET_WIDTH: usize = 180;

pub fn routes() -> Router<SharedState> {
    Router::new().route("/api/spaces/{space}/search", get(search))
}

/// `GET /api/spaces/{space}/search?q=water&limit=20[&type=plant]` [viewer]
///
/// `q` matches every one of its tokens, in a title or a body, and is required
/// and non-empty. `limit` is `1..=50` and defaults to 20. `type` narrows to one
/// type of this space. `total` counts every match; `results` is the capped
/// page, ordered by the core's score.
async fn search(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    mut query: ApiQuery,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;

    let q = query
        .raw("q")
        .ok_or_else(|| ApiError::validation("q", "a query is required"))?;
    let q = q.trim().to_owned();
    if q.is_empty() {
        return Err(ApiError::validation("q", "a query is required"));
    }
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(ApiError::validation(
            "q",
            format!("keep q under {MAX_QUERY_CHARS} characters"),
        ));
    }
    let limit = query.parse::<usize>("limit")?.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::validation(
            "limit",
            format!("must be between 1 and {MAX_LIMIT}"),
        ));
    }
    let type_key = query.raw("type");
    query.finish()?;

    let body = handle.with_index(|index| -> Result<Value, ApiError> {
        if let Some(key) = &type_key
            && index.type_def(key).is_none()
        {
            return Err(ApiError::validation(
                "type",
                format!("names no type: {key}"),
            ));
        }
        let results = index.search().query(&q, type_key.as_deref(), limit);
        let rows: Vec<SearchRow> = results
            .hits
            .iter()
            .filter_map(|hit| {
                let doc = index.object(hit.id)?;
                let def = index.type_def(&doc.type_key)?;
                Some(SearchRow {
                    id: doc.id,
                    type_key: doc.type_key.clone(),
                    type_name: def.name.clone(),
                    type_icon: def.icon.clone(),
                    title: doc.title.clone(),
                    icon: doc.icon.clone(),
                    updated_at: doc.updated_at,
                    score: hit.score,
                    snippet: snippet(&doc.body, &q, SNIPPET_WIDTH),
                })
            })
            .collect();
        Ok(json!({
            "query": q,
            "total": results.total,
            "results": rows,
        }))
    })?;
    Ok(Json(body))
}

/// One row a search returns.
#[derive(Debug, Serialize)]
struct SearchRow {
    id: Uuid,
    #[serde(rename = "type")]
    type_key: String,
    type_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    type_icon: Option<String>,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    score: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippet: Option<String>,
}
