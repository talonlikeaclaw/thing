//! Object routes: the records themselves, their trash and their history.
//!
//! One write path serves every mutation: take the space's write lock, validate
//! against the index, write through the store — which refuses a file that
//! changed underneath — append the revision, and reload what changed. Nothing
//! here computes an order or a rule the core engine already owns.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thing_core::index::SpaceIndex;
use thing_core::markdown;
use thing_core::model::{
    ObjectDoc, ObjectSummary, PropertyFormat, Revision, RevisionAction, Role, Snapshot, Sort,
    TITLE_KEY, Value as CoreValue,
};
use thing_core::query;
use thing_core::schedule::{self, DUE_DATE_KEY, RECURRENCE_KEY};
use thing_core::store::{SpaceStore, trash_path};
use thing_core::validate::{self, MAX_TITLE_LEN};
use thing_core::value as core_value;
use time::OffsetDateTime;
use uuid::Uuid;

use super::values::{Projection, object_json, space_timezone};
use super::{ApiJson, ApiQuery, clean_text, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// Rows a list returns when the caller does not say.
const DEFAULT_LIMIT: usize = 50;
/// Most rows one list will return, so a page cannot be unbounded.
const MAX_LIMIT: usize = 500;
/// The name a revision's change list gives the body, next to `title`.
const BODY_KEY: &str = "body";

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/objects", get(list).post(create))
        .route(
            "/api/spaces/{space}/objects/{object}",
            get(detail).patch(update).delete(remove),
        )
        .route(
            "/api/spaces/{space}/objects/{object}/restore",
            post(restore),
        )
        .route(
            "/api/spaces/{space}/objects/{object}/complete",
            post(complete),
        )
        .route("/api/spaces/{space}/objects/{object}/raw", get(raw))
        .route("/api/spaces/{space}/objects/{object}/history", get(history))
        .route(
            "/api/spaces/{space}/objects/{object}/history/{rev}",
            get(history_at),
        )
        .route("/api/spaces/{space}/agenda", get(agenda))
        .route("/api/spaces/{space}/trash", get(trash))
        .route("/api/spaces/{space}/trash/{object}", delete(purge))
}

/// `GET /api/spaces/{space}/objects` [viewer]
///
/// The type's saved view unless the request overrides it, filtered by the search
/// text over titles and bodies, then sorted and paged.
async fn list(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    mut query: ApiQuery,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let type_key = query
        .raw("type")
        .ok_or_else(|| ApiError::validation("type", "a type is required"))?;
    let filter = json_param(&mut query, "filter")?;
    let sorts: Option<Vec<Sort>> = json_param(&mut query, "sorts")?;
    let requested_view = query.raw("view");
    let text = query.raw("q");
    let limit = query
        .parse::<usize>("limit")?
        .unwrap_or(DEFAULT_LIMIT)
        .min(MAX_LIMIT);
    let offset = query.parse::<usize>("offset")?.unwrap_or(0);
    query.finish()?;

    let list = handle.with_index(|index| {
        let def = index
            .type_def(&type_key)
            .ok_or_else(|| ApiError::not_found(format!("type {type_key}")))?;
        let schema = index.schema();

        let mut errors = Vec::new();
        if let Some(filter) = &filter
            && let Err(mut found) = validate::validate_filter(&schema, def, filter)
        {
            errors.append(&mut found);
        }
        if let Some(sorts) = &sorts
            && let Err(mut found) = validate::validate_sorts(&schema, def, sorts)
        {
            errors.append(&mut found);
        }
        if !errors.is_empty() {
            return Err(ApiError::validation_all(errors));
        }

        let view = match requested_view {
            Some(key) => def.view(&key).ok_or_else(|| {
                ApiError::validation("view", format!("names no view of {type_key}: {key}"))
            })?,
            None => def
                .default_view()
                .ok_or_else(|| ApiError::not_found(format!("default view of {type_key}")))?,
        };
        let filter = filter.unwrap_or_else(|| view.filter.clone());
        let sorts = sorts.unwrap_or_else(|| view.sorts.clone());
        let rows: Vec<ObjectSummary> = index
            .summaries(&type_key)
            .iter()
            .filter(|summary| match &text {
                Some(text) => matches_text(index, summary, text),
                None => true,
            })
            .cloned()
            .collect();
        let matched = query::apply(&filter, &sorts, &rows, &schema);
        let total = matched.len();
        let projection = Projection::new(index);
        let page: Vec<Value> = matched
            .iter()
            .skip(offset)
            .take(limit)
            .map(|summary| {
                serde_json::to_value(projection.summary_json(def, view, summary))
                    .expect("a row serializes")
            })
            .collect();
        Ok(Json(json!({
            "view": view.key,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + page.len() < total,
            "objects": page,
        })))
    })?;
    Ok(list)
}

/// Reads a URL-encoded JSON parameter, naming it in the error when it will not
/// parse, so `filter` and `sorts` are refused by field like every other input.
fn json_param<T: serde::de::DeserializeOwned>(
    query: &mut ApiQuery,
    name: &str,
) -> Result<Option<T>, ApiError> {
    let Some(raw) = query.raw(name) else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| ApiError::validation(name, err.to_string()))
}

/// Whether the search text appears in the object's title or its body.
fn matches_text(index: &SpaceIndex, summary: &ObjectSummary, text: &str) -> bool {
    let needle = text.to_lowercase();
    if summary.title.to_lowercase().contains(&needle) {
        return true;
    }
    index
        .object(summary.id)
        .map(|doc| doc.body.to_lowercase().contains(&needle))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateObjectRequest {
    #[serde(rename = "type")]
    type_key: String,
    title: String,
    /// Values by property key; `null` means the key is absent.
    #[serde(default)]
    properties: BTreeMap<String, Value>,
    #[serde(default)]
    body: String,
}

/// `POST /api/spaces/{space}/objects` [editor]
async fn create(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<CreateObjectRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let title = clean_text("title", &body.title, MAX_TITLE_LEN)?;
    let properties = read_properties(&body.properties)?
        .into_iter()
        .filter_map(|(key, value)| value.map(|value| (key, value)))
        .collect();
    let now = OffsetDateTime::now_utc();
    let doc = ObjectDoc {
        id: Uuid::now_v7(),
        type_key: body.type_key.clone(),
        title,
        rev: 1,
        created_at: now,
        updated_at: now,
        created_by: caller.user.id,
        updated_by: caller.user.id,
        trashed_at: None,
        trashed_from: None,
        properties,
        body: body.body.clone(),
    };

    let _guard = handle.write.lock().await;
    let path = handle.with_index(|index| -> Result<PathBuf, ApiError> {
        if index.type_def(&doc.type_key).is_none() {
            return Err(ApiError::not_found(format!("type {}", doc.type_key)));
        }
        if let Err(errors) = validate::validate_object(&index.schema(), &doc) {
            return Err(ApiError::validation_all(errors));
        }
        Ok(handle.store.new_object_path(&doc.type_key, &doc.title)?)
    })?;

    handle.store.save_object(&path, &doc, None)?;
    handle.store.append_revision(
        doc.id,
        &Revision {
            rev: doc.rev,
            at: now,
            by: caller.user.id,
            action: RevisionAction::Create,
            snapshot: snapshot_of(&doc),
            body: Some(doc.body.clone()),
        },
    )?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast(
        "object.created",
        json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
    );
    tracing::info!(space = %space, user = %caller.user.id, object = %doc.id, "object created");

    let created = handle
        .with_index(|index| {
            index
                .object(doc.id)
                .map(|live| json!(object_json(index, live)))
        })
        .ok_or_else(|| ApiError::internal("the object did not survive its own write"))?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchObjectRequest {
    #[serde(default)]
    title: Option<String>,
    /// Values to merge by property key; `null` removes the key.
    #[serde(default)]
    properties: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    body: Option<String>,
    /// The revision the caller last read; a different one is a conflict.
    rev: u64,
}

/// `PATCH /api/spaces/{space}/objects/{object}` [editor]
async fn update(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
    ApiJson(body): ApiJson<PatchObjectRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let title = body
        .title
        .as_deref()
        .map(|title| clean_text("title", title, MAX_TITLE_LEN))
        .transpose()?;
    let values = body.properties.as_ref().map(read_properties).transpose()?;
    let body_text = body.body;
    let rev = body.rev;

    commit(&handle, &caller, id, rev, RevisionAction::Update, |next| {
        if let Some(title) = title {
            next.title = title;
        }
        if let Some(values) = &values {
            for (key, value) in values {
                match value {
                    Some(value) => {
                        next.properties.insert(key.clone(), value.clone());
                    }
                    None => {
                        next.properties.remove(key);
                    }
                }
            }
        }
        let body_changed = match &body_text {
            Some(text) => {
                let changed = *text != next.body;
                next.body = text.clone();
                changed
            }
            None => false,
        };
        Ok(body_changed)
    })
    .await?;

    tracing::info!(
        space = %space,
        user = %caller.user.id,
        object = %id,
        rev = rev + 1,
        "object updated"
    );
    Ok(Json(object_response(&handle, id)?))
}

/// `POST /api/spaces/{space}/objects/{object}/complete` [editor]
///
/// Records one completion: a one-off loses its due date, a recurring record
/// advances it. Complete never changes the title or the body.
async fn complete(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
    ApiJson(body): ApiJson<CompleteRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let now = OffsetDateTime::now_utc();

    commit(
        &handle,
        &caller,
        id,
        body.rev,
        RevisionAction::Complete,
        |next| {
            let (def, timezone) = handle.with_index(|index| {
                (
                    index.type_def(&next.type_key).cloned(),
                    space_timezone(index),
                )
            });
            let Some(def) = def else {
                return Err(ApiError::not_found(format!("type {}", next.type_key)));
            };
            let updated = schedule::complete(&def, next, &timezone, now)?;
            *next = updated;
            Ok(false)
        },
    )
    .await?;

    tracing::info!(space = %space, user = %caller.user.id, object = %id, "object completed");
    Ok(Json(object_response(&handle, id)?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteRequest {
    rev: u64,
}

/// One write path for every object mutation: lock, load, check the revision,
/// apply the closure, increment, validate, save under the fingerprint guard,
/// record the revision, reload the index and broadcast.
///
/// The closure returns whether it changed the body; only an update records one.
async fn commit(
    handle: &Arc<SpaceHandle>,
    caller: &Caller,
    id: Uuid,
    rev: u64,
    action: RevisionAction,
    change: impl FnOnce(&mut ObjectDoc) -> Result<bool, ApiError>,
) -> Result<ObjectDoc, ApiError> {
    let _guard = handle.write.lock().await;
    let (path, previous, doc) = handle.with_index(|index| -> Result<_, ApiError> {
        let doc = index
            .object(id)
            .cloned()
            .ok_or_else(|| ApiError::not_found(format!("object {id}")))?;
        let path = index
            .object_path(id)
            .ok_or_else(|| ApiError::internal("a live object always has a file"))?
            .to_owned();
        let expected = index.fingerprint(&path);
        Ok((path, expected, doc))
    })?;
    if rev != doc.rev {
        return Err(ApiError::conflict(
            "the object has changed since you loaded it; reload and retry",
            json!({ "reason": "stale revision", "current_rev": doc.rev }),
        ));
    }

    let mut next = doc.clone();
    let body_changed = change(&mut next)?;
    next.rev = doc.rev + 1;
    next.updated_at = OffsetDateTime::now_utc();
    next.updated_by = caller.user.id;

    let retitled = next.title != doc.title;
    let target = if retitled {
        handle.store.new_object_path(&next.type_key, &next.title)?
    } else {
        path.clone()
    };

    handle.with_index(|index| {
        if let Err(errors) = validate::validate_object(&index.schema(), &next) {
            return Err(ApiError::validation_all(errors));
        }
        Ok(())
    })?;

    if target == path {
        handle.store.save_object(&path, &next, previous)?;
    } else {
        // Written under the new name before the old one goes, so a crash leaves
        // the object twice rather than not at all; the index reports the pair.
        handle.store.save_object(&target, &next, None)?;
        handle.store.remove_object(&path, previous)?;
    }
    handle.store.append_revision(
        next.id,
        &Revision {
            rev: next.rev,
            at: next.updated_at,
            by: caller.user.id,
            action,
            snapshot: snapshot_of(&next),
            body: (action == RevisionAction::Update && body_changed).then(|| next.body.clone()),
        },
    )?;
    handle.with_index_mut(|index| {
        if target != path {
            index.reload_file(&handle.store, &path)?;
        }
        index.reload_file(&handle.store, &target)
    })?;
    broadcast_change(handle, action, &next);
    Ok(next)
}

/// The event one committed write announces. Complete carries the new due date
/// so a listener can react without refetching; a one-off has none.
fn broadcast_change(handle: &Arc<SpaceHandle>, action: RevisionAction, doc: &ObjectDoc) {
    let identity = json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev });
    match action {
        RevisionAction::Update => handle.broadcast("object.updated", identity),
        RevisionAction::Complete => {
            let mut payload = identity;
            if let Some(CoreValue::Text(due)) = doc.properties.get(DUE_DATE_KEY) {
                payload["due_date"] = json!(due);
            }
            handle.broadcast("object.completed", payload);
        }
        _ => {}
    }
}

/// One object as a write returns it.
fn object_response(handle: &Arc<SpaceHandle>, id: Uuid) -> Result<Value, ApiError> {
    handle
        .with_index(|index| index.object(id).map(|live| json!(object_json(index, live))))
        .ok_or_else(|| ApiError::internal("the object did not survive its own write"))
}

/// `GET /api/spaces/{space}/objects/{object}` [viewer]
async fn detail(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
    mut query: ApiQuery,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let with = query.raw("with");
    query.finish()?;
    let mut wanted: Vec<&str> = Vec::new();
    if let Some(with) = with.as_deref() {
        for name in with.split(',') {
            match name {
                "history" | "backlinks" => wanted.push(name),
                other => {
                    return Err(ApiError::validation(
                        "with",
                        format!("{other} is not something an object carries"),
                    ));
                }
            }
        }
    }

    let mut body = handle
        .with_index(|index| index.object(id).map(|doc| json!(object_json(index, doc))))
        .ok_or_else(|| ApiError::not_found(format!("object {id}")))?;
    if wanted.contains(&"history") {
        body["history"] = json!(history_json(&handle.store.read_revisions(id)?));
    }
    if wanted.contains(&"backlinks") {
        body["backlinks"] = json!(backlinks(&handle, id));
    }
    Ok(Json(body))
}

/// `DELETE /api/spaces/{space}/objects/{object}` [editor]
async fn remove(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let _guard = handle.write.lock().await;
    let (summary, path) = handle.with_index(|index| -> Result<_, ApiError> {
        let doc = index
            .object(id)
            .ok_or_else(|| ApiError::not_found(format!("object {id}")))?;
        let path = index
            .object_path(id)
            .ok_or_else(|| ApiError::internal("a live object always has a file"))?;
        Ok((ObjectSummary::from(doc), path.to_owned()))
    })?;

    trash_and_record(
        &handle,
        &caller,
        &summary,
        &path,
        OffsetDateTime::now_utc(),
        RevisionAction::Delete,
    )?;
    handle.broadcast(
        "object.deleted",
        json!({ "id": summary.id, "type": summary.type_key, "rev": summary.rev }),
    );
    tracing::info!(space = %space, user = %caller.user.id, object = %id, "object trashed");

    let trashed = handle
        .with_index(|index| index.trashed(id).map(|doc| json!(TrashItem::of(doc))))
        .ok_or_else(|| ApiError::internal("the object did not reach the trash"))?;
    Ok(Json(trashed))
}

/// `POST /api/spaces/{space}/objects/{object}/restore` [editor]
async fn restore(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let _guard = handle.write.lock().await;
    let (doc, from) = handle.with_index(|index| -> Result<_, ApiError> {
        let doc = index
            .trashed(id)
            .cloned()
            .ok_or_else(|| ApiError::not_found(format!("trashed object {id}")))?;
        Ok((doc, trash_path(id)))
    })?;

    let path = handle.store.restore(id)?;
    // A restore puts the object back where it was; its rev never moved, so the
    // revision repeats it rather than inventing a new one.
    handle.store.append_revision(
        id,
        &Revision {
            rev: doc.rev,
            at: OffsetDateTime::now_utc(),
            by: caller.user.id,
            action: RevisionAction::Restore,
            snapshot: snapshot_of(&doc),
            body: None,
        },
    )?;
    handle.with_index_mut(|index| {
        index.reload_file(&handle.store, &from)?;
        index.reload_file(&handle.store, &path)
    })?;
    handle.broadcast(
        "object.restored",
        json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
    );
    tracing::info!(space = %space, user = %caller.user.id, object = %id, path = %path.display(), "object restored");

    let restored = handle
        .with_index(|index| index.object(id).map(|live| json!(object_json(index, live))))
        .ok_or_else(|| ApiError::internal("the object did not survive its own restore"))?;
    Ok(Json(restored))
}

/// `DELETE /api/spaces/{space}/trash/{object}` [editor]
///
/// The only operation in the API that destroys data: the trash file and the
/// object's whole history go.
async fn purge(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let _guard = handle.write.lock().await;
    let (from, trashed) = handle.with_index(|index| -> Result<_, ApiError> {
        let from = index
            .trash_path(id)
            .map(std::path::Path::to_owned)
            .ok_or_else(|| ApiError::not_found(format!("trashed object {id}")))?;
        let doc = index
            .trashed(id)
            .cloned()
            .ok_or_else(|| ApiError::not_found(format!("trashed object {id}")))?;
        Ok((from, doc))
    })?;

    handle.store.purge(id)?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &from))?;
    handle.broadcast(
        "object.purged",
        json!({ "id": trashed.id, "type": trashed.type_key, "rev": trashed.rev }),
    );
    tracing::info!(space = %space, user = %caller.user.id, object = %id, "object purged");
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/spaces/{space}/objects/{object}/raw` [viewer]
///
/// The object's file, as the format writes it.
async fn raw(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let text = handle
        .with_index(|index| index.object(id).map(markdown::serialize_object))
        .ok_or_else(|| ApiError::not_found(format!("object {id}")))?;
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        text,
    )
        .into_response())
}

/// `GET /api/spaces/{space}/objects/{object}/history` [viewer]
async fn history(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    known_object(&handle, id)?;
    let revisions = handle.store.read_revisions(id)?;
    Ok(Json(json!(history_json(&revisions))))
}

/// `GET /api/spaces/{space}/objects/{object}/history/{rev}` [viewer]
///
/// A revision is addressed by its number. Trashing and restoring do not change
/// what an object holds, so their lines repeat the revision they followed; this
/// returns the newest line with that number, which is the event that happened.
async fn history_at(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, object, rev)): Path<(String, String, u64)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let id = uuid_param(&object, "object")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    known_object(&handle, id)?;
    let revisions = handle.store.read_revisions(id)?;
    let found = revisions
        .iter()
        .rfind(|revision| revision.rev == rev)
        .ok_or_else(|| ApiError::not_found(format!("revision {rev} of object {id}")))?;
    Ok(Json(json!(found)))
}

/// `GET /api/spaces/{space}/agenda?days=14` [viewer]
///
/// One pass over live objects of scheduled types, bucketed by calendar day in
/// the space's zone. The server owns the classification; the client renders it.
///
/// `today` is the space's civil date for the header; the bucket of records due
/// today is `due_today`, because one JSON object cannot carry the same key
/// twice. The plan's example showed both under `today`, which no parser can
/// represent.
async fn agenda(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    mut query: ApiQuery,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let days = query.parse::<i64>("days")?.unwrap_or(14);
    query.finish()?;
    if !(1..=90).contains(&days) {
        return Err(ApiError::validation("days", "must be between 1 and 90"));
    }

    let body = handle.with_index(|index| {
        let timezone = space_timezone(index);
        let now = OffsetDateTime::now_utc();
        let today = schedule::today_in(&timezone, now);
        let mut rows: Vec<AgendaRow> = Vec::new();
        let mut later_count = 0;

        for doc in index.objects() {
            let Some(def) = index.type_def(&doc.type_key) else {
                continue;
            };
            let Some(schedule) = schedule::state(def, doc, &timezone, now) else {
                continue;
            };
            let (Some(due), Some(distance)) = (schedule.due_date, schedule.days_until_due) else {
                continue;
            };
            if matches!(
                schedule.status,
                schedule::DueStatus::Unscheduled | schedule::DueStatus::Done
            ) {
                continue;
            }
            if distance > days {
                later_count += 1;
                continue;
            }
            let recurrence = match doc.properties.get(RECURRENCE_KEY) {
                Some(CoreValue::Recurrence(value)) => Some(schedule::recurrence_label(value)),
                _ => None,
            };
            rows.push(AgendaRow {
                id: doc.id,
                type_key: doc.type_key.clone(),
                type_name: def.name.clone(),
                type_icon: def.icon.clone(),
                title: doc.title.clone(),
                rev: doc.rev,
                due_date: due.to_string(),
                status: schedule.status,
                days_until_due: distance,
                recurrence,
                last_completed_at: schedule.last_completed_at,
            });
        }

        rows.sort_by(|left, right| {
            left.due_date
                .cmp(&right.due_date)
                .then_with(|| left.title.cmp(&right.title))
        });
        let overdue = rows
            .iter()
            .filter(|row| row.status == schedule::DueStatus::Overdue)
            .cloned()
            .collect::<Vec<_>>();
        let due_today = rows
            .iter()
            .filter(|row| row.status == schedule::DueStatus::Today)
            .cloned()
            .collect::<Vec<_>>();
        let upcoming = rows
            .iter()
            .filter(|row| row.status == schedule::DueStatus::Upcoming)
            .cloned()
            .collect::<Vec<_>>();

        json!({
            "today": today.to_string(),
            "timezone": index.meta().timezone,
            "overdue": overdue,
            "due_today": due_today,
            "upcoming": upcoming,
            "later_count": later_count,
        })
    });
    Ok(Json(body))
}

/// One scheduled record as the agenda lists it.
#[derive(Debug, Clone, Serialize)]
struct AgendaRow {
    id: Uuid,
    #[serde(rename = "type")]
    type_key: String,
    type_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    type_icon: Option<String>,
    title: String,
    rev: u64,
    due_date: String,
    status: schedule::DueStatus,
    days_until_due: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    recurrence: Option<String>,
    #[serde(
        with = "time::serde::rfc3339::option",
        skip_serializing_if = "Option::is_none"
    )]
    last_completed_at: Option<OffsetDateTime>,
}

/// `GET /api/spaces/{space}/trash` [viewer]
async fn trash(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let items: Vec<TrashItem> =
        handle.with_index(|index| index.trash().map(TrashItem::of).collect());
    Ok(Json(json!(items)))
}

/// One trashed object as the trash list shows it.
#[derive(Debug, Serialize)]
struct TrashItem {
    id: Uuid,
    #[serde(rename = "type")]
    type_key: String,
    title: String,
    rev: u64,
    #[serde(with = "time::serde::rfc3339::option")]
    trashed_at: Option<OffsetDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trashed_from: Option<String>,
}

impl TrashItem {
    fn of(doc: &ObjectDoc) -> Self {
        Self {
            id: doc.id,
            type_key: doc.type_key.clone(),
            title: doc.title.clone(),
            rev: doc.rev,
            trashed_at: doc.trashed_at,
            trashed_from: doc.trashed_from.clone(),
        }
    }
}

/// Moves one object to the trash and appends the revision that records it.
///
/// The object's `rev` does not move: trashing and restoring change where a file
/// lives, not what it holds.
pub fn trash_and_record(
    handle: &Arc<SpaceHandle>,
    caller: &Caller,
    summary: &ObjectSummary,
    path: &std::path::Path,
    at: OffsetDateTime,
    action: RevisionAction,
) -> Result<(), ApiError> {
    let expected = handle.with_index(|index| index.fingerprint(path));
    handle.store.move_to_trash(path, at, expected)?;
    handle.store.append_revision(
        summary.id,
        &Revision {
            rev: summary.rev,
            at,
            by: caller.user.id,
            action,
            snapshot: Snapshot {
                title: summary.title.clone(),
                properties: summary.properties.clone(),
            },
            body: None,
        },
    )?;
    handle.with_index_mut(|index| {
        index.reload_file(&handle.store, path)?;
        index.reload_file(&handle.store, &trash_path(summary.id))
    })?;
    Ok(())
}

/// The history as the API shows it: every revision, each with what it changed
/// against the one before it.
fn history_json(revisions: &[Revision]) -> Vec<Value> {
    revisions
        .iter()
        .enumerate()
        .map(|(at, revision)| {
            let previous = at.checked_sub(1).map(|before| &revisions[before]);
            let mut json = json!(revision);
            json["changed"] = json!(changed_keys(previous, revision));
            json
        })
        .collect()
}

/// What a revision changed: `title`, `body` and every property key whose value
/// it added, altered or dropped. The first revision changed everything it holds.
fn changed_keys(previous: Option<&Revision>, revision: &Revision) -> Vec<String> {
    let mut keys = Vec::new();
    let Some(previous) = previous else {
        keys.push(TITLE_KEY.to_owned());
        keys.extend(revision.snapshot.properties.keys().cloned());
        if revision.body.is_some() {
            keys.push(BODY_KEY.to_owned());
        }
        return keys;
    };
    if previous.snapshot.title != revision.snapshot.title {
        keys.push(TITLE_KEY.to_owned());
    }
    for (key, value) in &revision.snapshot.properties {
        if previous.snapshot.properties.get(key) != Some(value) {
            keys.push(key.clone());
        }
    }
    for key in previous.snapshot.properties.keys() {
        if !revision.snapshot.properties.contains_key(key) {
            keys.push(key.clone());
        }
    }
    if revision.body.is_some() {
        keys.push(BODY_KEY.to_owned());
    }
    keys
}

/// Objects that point at this one through a relation.
///
/// Backlinks are the relation values that name this id; M5's index is a faster
/// way to ask the same question, not a different answer.
fn backlinks(handle: &Arc<SpaceHandle>, id: Uuid) -> Vec<Value> {
    handle.with_index(|index| {
        let mut found = Vec::new();
        for doc in index.objects() {
            for (key, value) in &doc.properties {
                if index.property_def(key).map(|def| def.format) != Some(PropertyFormat::Relation) {
                    continue;
                }
                if !names(value, id) {
                    continue;
                }
                found.push(json!({
                    "id": doc.id,
                    "type": doc.type_key,
                    "title": doc.title,
                    "property": key,
                }));
            }
        }
        found
    })
}

/// Whether a relation value holds this target id.
fn names(value: &CoreValue, target: Uuid) -> bool {
    let target = target.to_string();
    match value {
        CoreValue::Text(id) => *id == target,
        CoreValue::List(ids) => ids.contains(&target),
        _ => false,
    }
}

/// The object's title and property map after a write.
fn snapshot_of(doc: &ObjectDoc) -> Snapshot {
    Snapshot {
        title: doc.title.clone(),
        properties: doc.properties.clone(),
    }
}

/// Reads a request's property map: `null` removes the key, anything else is a
/// value of whatever variant the JSON holds, which validation then checks
/// against the property's format.
fn read_properties(
    raw: &BTreeMap<String, Value>,
) -> Result<BTreeMap<String, Option<CoreValue>>, ApiError> {
    let mut values = BTreeMap::new();
    for (key, value) in raw {
        if value.is_null() {
            values.insert(key.clone(), None);
            continue;
        }
        values.insert(key.clone(), Some(core_value::from_json(key, value)?));
    }
    Ok(values)
}

/// A `404` unless the object exists, live or trashed.
fn known_object(handle: &Arc<SpaceHandle>, id: Uuid) -> Result<(), ApiError> {
    let known =
        handle.with_index(|index| index.object(id).is_some() || index.trashed(id).is_some());
    if known {
        Ok(())
    } else {
        Err(ApiError::not_found(format!("object {id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn revision(rev: u64, title: &str, values: &[(&str, &str)], body: Option<&str>) -> Revision {
        Revision {
            rev,
            at: OffsetDateTime::UNIX_EPOCH,
            by: Uuid::nil(),
            action: RevisionAction::Update,
            snapshot: Snapshot {
                title: title.to_owned(),
                properties: values
                    .iter()
                    .map(|(key, value)| ((*key).to_owned(), CoreValue::Text((*value).to_owned())))
                    .collect(),
            },
            body: body.map(str::to_owned),
        }
    }

    #[test]
    fn the_first_revision_lists_everything_it_holds() {
        let first = revision(1, "Monstera", &[("room", "kitchen")], Some("\nWatered.\n"));
        assert_eq!(
            changed_keys(None, &first),
            vec!["title".to_owned(), "room".to_owned(), "body".to_owned()]
        );
    }

    #[test]
    fn a_later_revision_reports_only_what_moved() {
        let before = revision(1, "Monstera", &[("room", "kitchen")], Some("\nWatered.\n"));
        let after = revision(2, "Monstera", &[("room", "study")], None);
        assert_eq!(changed_keys(Some(&before), &after), vec!["room".to_owned()]);

        let retitled = revision(3, "Fern", &[("room", "study")], Some("\nRepotted.\n"));
        assert_eq!(
            changed_keys(Some(&after), &retitled),
            vec!["title".to_owned(), "body".to_owned()]
        );

        let emptied = revision(4, "Fern", &[], None);
        assert_eq!(
            changed_keys(Some(&retitled), &emptied),
            vec!["room".to_owned()]
        );
    }

    #[test]
    fn a_null_value_removes_the_key_and_a_scalar_becomes_a_value() {
        let raw = BTreeMap::from([
            ("room".to_owned(), json!("kitchen")),
            ("watering".to_owned(), json!(7)),
            ("tags".to_owned(), json!(["easy"])),
            ("gone".to_owned(), Value::Null),
        ]);
        let values = read_properties(&raw).expect("values");
        assert_eq!(values["room"], Some(CoreValue::Text("kitchen".to_owned())));
        assert_eq!(values["watering"], Some(CoreValue::Number(7.0)));
        assert_eq!(
            values["tags"],
            Some(CoreValue::List(vec!["easy".to_owned()]))
        );
        assert_eq!(values["gone"], None);
    }

    #[test]
    fn a_relation_value_names_its_target() {
        let target = Uuid::now_v7();
        assert!(names(&CoreValue::Text(target.to_string()), target));
        assert!(names(
            &CoreValue::List(vec![target.to_string(), Uuid::now_v7().to_string()]),
            target
        ));
        assert!(!names(&CoreValue::Text(Uuid::now_v7().to_string()), target));
        assert!(!names(&CoreValue::List(Vec::new()), target));
    }

    #[test]
    fn search_text_matches_a_title_and_leaves_the_rest_alone() {
        let summary = ObjectSummary {
            id: Uuid::now_v7(),
            type_key: "plant".to_owned(),
            title: "Monstera in the study".to_owned(),
            rev: 1,
            updated_at: OffsetDateTime::UNIX_EPOCH,
            properties: BTreeMap::new(),
        };
        assert!(matches_text(&empty_index(), &summary, "MONSTERA"));
        assert!(!matches_text(&empty_index(), &summary, "ficus"));
    }

    fn empty_index() -> SpaceIndex {
        use thing_core::model::SpaceMeta;
        use thing_core::store::fs::FsSpaceStore;

        let dir = tempfile::tempdir().expect("a temporary space");
        let meta = SpaceMeta {
            id: Uuid::now_v7(),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: OffsetDateTime::now_utc(),
            members: Vec::new(),
        };
        let store = FsSpaceStore::create(dir.path(), &meta).expect("space");
        SpaceIndex::rebuild_from_disk(&store).expect("index")
    }
}
