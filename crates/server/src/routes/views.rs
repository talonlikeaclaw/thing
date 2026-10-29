//! View routes: a type's named saved queries.
//!
//! A view lives in the type file, so every handler here reads the type, edits
//! its `views` list, validates the whole definition, and writes the same
//! `types/<key>.yml` the type routes own. Keys are minted once from a name and
//! never move; the kind is fixed at creation, because showing the same records
//! differently is a new view, not a mode of the old one.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use thing_core::index::SpaceIndex;
use thing_core::model::{
    Filter, MAX_VIEW_NAME_LEN, Role, Sort, TITLE_KEY, TypeDef, ViewDef, ViewKind,
};
use thing_core::slug::key_from_name;
use thing_core::store::{SpaceStore, type_path};
use uuid::Uuid;

use super::types::{check_type, type_detail};
use super::{ApiJson, clean_text, double_option, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/types/{key}/views", post(create))
        .route(
            "/api/spaces/{space}/types/{key}/views/{view}",
            patch(update).delete(remove),
        )
        .route(
            "/api/spaces/{space}/types/{key}/views/{view}/default",
            post(make_default),
        )
        .route(
            "/api/spaces/{space}/types/{key}/views/{view}/move",
            post(move_view),
        )
}

/// The body a new view may carry. Omitted layout and query fields copy the
/// type's current default view, so a new view starts where the user was.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateViewRequest {
    name: String,
    kind: ViewKind,
    #[serde(default)]
    filter: Option<Filter>,
    #[serde(default)]
    sorts: Option<Vec<Sort>>,
    #[serde(default)]
    columns: Option<Vec<String>>,
    #[serde(default)]
    widths: Option<BTreeMap<String, u16>>,
    #[serde(default)]
    group_by: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    date_property: Option<String>,
}

/// `POST /api/spaces/{space}/types/{key}/views` [editor]
async fn create(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    ApiJson(body): ApiJson<CreateViewRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let name = clean_text("name", &body.name, MAX_VIEW_NAME_LEN)?;
    let view_key = key_from_name(&name);

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<TypeDef, ApiError> {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        if let Some(existing) = def
            .views
            .iter()
            .find(|view| view.name.trim().to_lowercase() == name.to_lowercase())
        {
            return Err(ApiError::conflict(
                format!("view {} already exists", existing.key),
                json!({ "reason": "view name exists", "view": existing.key }),
            ));
        }
        if def.view(&view_key).is_some() {
            return Err(ApiError::conflict(
                format!("view {view_key} already exists"),
                json!({ "reason": "view key exists", "view": view_key }),
            ));
        }
        let source = def
            .default_view()
            .ok_or_else(|| ApiError::internal(format!("type {key} has no default view")))?;
        let view = ViewDef {
            key: view_key.clone(),
            name,
            kind: body.kind,
            filter: body.filter.unwrap_or_else(|| source.filter.clone()),
            sorts: body.sorts.unwrap_or_else(|| source.sorts.clone()),
            columns: body
                .columns
                .unwrap_or_else(|| copied_columns(source, body.kind)),
            widths: body.widths.unwrap_or_else(|| {
                if body.kind == ViewKind::Table {
                    source.widths.clone()
                } else {
                    BTreeMap::new()
                }
            }),
            group_by: clean_optional_key(body.group_by),
            cover: clean_optional_key(body.cover),
            date_property: clean_optional_key(body.date_property),
        };
        let mut next = def.clone();
        next.views.push(view);
        validated(index, &next)?;
        Ok(next)
    })?;

    let created = next
        .views
        .last()
        .expect("a created view is in the list")
        .key
        .clone();
    let detail = commit(&handle, space, &caller, &next, &created)?;
    Ok((StatusCode::CREATED, detail))
}

/// The columns a new view starts with: the default view's, unless those are
/// empty or do not begin with `title`, in which case the title alone. A calendar
/// never carries columns.
fn copied_columns(source: &ViewDef, kind: ViewKind) -> Vec<String> {
    if kind == ViewKind::Calendar {
        return Vec::new();
    }
    if source.columns.first().map(String::as_str) == Some(TITLE_KEY) {
        source.columns.clone()
    } else {
        vec![TITLE_KEY.to_owned()]
    }
}

/// A field that names a member: trim it, and an empty string means absent.
fn clean_optional_key(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// The mutable subset of a view. `kind` and `key` are deliberately absent;
/// `deny_unknown_fields` makes sending either a `422`, not a silent no-op.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchViewRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    filter: Option<Filter>,
    #[serde(default)]
    sorts: Option<Vec<Sort>>,
    #[serde(default)]
    columns: Option<Vec<String>>,
    #[serde(default)]
    widths: Option<BTreeMap<String, u16>>,
    #[serde(default, deserialize_with = "double_option")]
    group_by: Option<Option<String>>,
    /// `null` clears the cover; leaving it out leaves it alone.
    #[serde(default, deserialize_with = "double_option")]
    cover: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    date_property: Option<Option<String>>,
}

impl PatchViewRequest {
    fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.filter.is_none()
            && self.sorts.is_none()
            && self.columns.is_none()
            && self.widths.is_none()
            && self.group_by.is_none()
            && self.cover.is_none()
            && self.date_property.is_none()
    }
}

/// `PATCH /api/spaces/{space}/types/{key}/views/{view}` [editor]
async fn update(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key, view_key)): Path<(String, String, String)>,
    ApiJson(body): ApiJson<PatchViewRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    if body.is_empty() {
        return Err(ApiError::validation("body", "nothing to change"));
    }
    let name = body
        .name
        .as_deref()
        .map(|name| clean_text("name", name, MAX_VIEW_NAME_LEN))
        .transpose()?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<TypeDef, ApiError> {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        let mut next = def.clone();
        let view = next
            .views
            .iter_mut()
            .find(|view| view.key == view_key)
            .ok_or_else(|| ApiError::not_found(format!("view {view_key} of type {key}")))?;
        if let Some(name) = name {
            view.name = name;
        }
        if let Some(filter) = body.filter {
            view.filter = filter;
        }
        if let Some(sorts) = body.sorts {
            view.sorts = sorts;
        }
        if let Some(columns) = body.columns {
            view.columns = columns;
        }
        if let Some(widths) = body.widths {
            view.widths = widths;
        }
        if let Some(group_by) = body.group_by {
            view.group_by = clean_optional_key(group_by);
        }
        if let Some(cover) = body.cover {
            view.cover = clean_optional_key(cover);
        }
        if let Some(date_property) = body.date_property {
            view.date_property = clean_optional_key(date_property);
        }
        validated(index, &next)?;
        Ok(next)
    })?;

    let detail = commit(&handle, space, &caller, &next, &view_key)?;
    Ok(detail)
}

/// `DELETE /api/spaces/{space}/types/{key}/views/{view}` [editor]
///
/// The last view is refused; a type always opens with one. Deleting the default
/// promotes the view that followed it, else the first remaining one.
async fn remove(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key, view_key)): Path<(String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<TypeDef, ApiError> {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        let mut next = def.clone();
        let position = next
            .views
            .iter()
            .position(|view| view.key == view_key)
            .ok_or_else(|| ApiError::not_found(format!("view {view_key} of type {key}")))?;
        if next.views.len() == 1 {
            return Err(ApiError::conflict(
                "a type needs at least one view",
                json!({ "reason": "a type needs at least one view" }),
            ));
        }
        let was_default = next.default_view == view_key;
        next.views.remove(position);
        if was_default {
            let promoted = next
                .views
                .get(position)
                .or_else(|| next.views.first())
                .expect("a remaining view");
            next.default_view = promoted.key.clone();
        }
        validated(index, &next)?;
        Ok(next)
    })?;

    let detail = commit(&handle, space, &caller, &next, &view_key)?;
    Ok(detail)
}

/// `POST /api/spaces/{space}/types/{key}/views/{view}/default` [editor]
///
/// The default is the first tab, so naming one moves it there. Idempotent:
/// naming the current default writes the same definition again.
async fn make_default(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key, view_key)): Path<(String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<TypeDef, ApiError> {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        let mut next = def.clone();
        let position = next
            .views
            .iter()
            .position(|view| view.key == view_key)
            .ok_or_else(|| ApiError::not_found(format!("view {view_key} of type {key}")))?;
        if position > 0 {
            let view = next.views.remove(position);
            next.views.insert(0, view);
        }
        next.default_view = view_key.clone();
        validated(index, &next)?;
        Ok(next)
    })?;

    let detail = commit(&handle, space, &caller, &next, &view_key)?;
    Ok(detail)
}

/// The one field a move takes: the 0-based slot the view lands in after the
/// write, so up is `position - 1` and the client needs no neighbour key.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MoveViewRequest {
    position: usize,
}

/// `POST /api/spaces/{space}/types/{key}/views/{view}/move` [editor]
///
/// Permutes the type's ordered `views` list. The order is the file's order, so
/// it is shared space state. The default view is the first tab and stays first:
/// it cannot move, and no other view may take slot 0 — `make_default` is the
/// only way a view lands there.
async fn move_view(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key, view_key)): Path<(String, String, String)>,
    ApiJson(body): ApiJson<MoveViewRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<TypeDef, ApiError> {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        let mut next = def.clone();
        let from = next
            .views
            .iter()
            .position(|view| view.key == view_key)
            .ok_or_else(|| ApiError::not_found(format!("view {view_key} of type {key}")))?;
        let last = next.views.len() - 1;
        if body.position > last {
            return Err(ApiError::validation(
                "position",
                format!("position {} is past the last slot ({last})", body.position),
            ));
        }
        let is_default = view_key == next.default_view;
        if (is_default && body.position != 0) || (!is_default && body.position == 0) {
            return Err(ApiError::conflict(
                "the default view stays first",
                json!({ "reason": "the default view stays first" }),
            ));
        }
        let view = next.views.remove(from);
        next.views.insert(body.position, view);
        validated(index, &next)?;
        Ok(next)
    })?;

    let detail = commit(&handle, space, &caller, &next, &view_key)?;
    Ok(detail)
}

/// Runs the shared type validation and turns its errors into one `422`.
fn validated(index: &SpaceIndex, def: &TypeDef) -> Result<(), ApiError> {
    let schema = index.schema();
    let errors = check_type(&schema, def);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(ApiError::validation_all(errors))
    }
}

/// Writes the type through the store's fingerprint guard, reloads the index and
/// announces which view changed. Every route returns the updated detail.
fn commit(
    handle: &Arc<SpaceHandle>,
    space: Uuid,
    caller: &Caller,
    def: &TypeDef,
    view: &str,
) -> Result<Json<Value>, ApiError> {
    let path = type_path(&def.key);
    let expected = handle.with_index(|index| index.fingerprint(&path));
    handle.store.save_type(def, expected)?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.updated", json!({ "key": def.key, "view": view }));
    tracing::info!(
        space = %space,
        user = %caller.user.id,
        key = %def.key,
        view = %view,
        "view written"
    );
    Ok(Json(json!(type_detail(handle, &def.key)?)))
}
