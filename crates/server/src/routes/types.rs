//! Type routes: a space's types, their property lists and their saved view.
//!
//! A type's key is derived from its name once, when it is created, and never
//! changes afterwards: renaming the display name is a write to the file, not a
//! move, so nothing that points at `types/<key>.yml` has to follow.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::index::SpaceIndex;
use thing_core::model::{
    Direction, EmptyPlacement, Filter, FilterOp, ObjectSummary, RevisionAction, Role, Sort,
    TITLE_KEY, TypeDef, TypeProperty, UPDATED_AT_KEY, ViewDef, is_reserved_key,
};
use thing_core::slug::{is_valid_key, key_from_name};
use thing_core::store::{SpaceStore, type_path};
use thing_core::validate::{self, MAX_TITLE_LEN, Schema};
use time::OffsetDateTime;

use super::{ApiJson, ApiQuery, clean_icon, clean_text, double_option, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::routes::objects::trash_and_record;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/types", get(list).post(create))
        .route(
            "/api/spaces/{space}/types/{key}",
            get(detail).patch(update).delete(remove),
        )
}

/// A type as a list shows it: names, counts, no definitions.
#[derive(Debug, Serialize)]
pub struct TypeSummary {
    pub key: String,
    pub name: String,
    pub name_plural: String,
    pub icon: Option<String>,
    pub description: String,
    pub property_count: usize,
    pub object_count: usize,
}

impl TypeSummary {
    fn of(index: &SpaceIndex, def: &TypeDef) -> Self {
        Self {
            key: def.key.clone(),
            name: def.name.clone(),
            name_plural: def.name_plural.clone(),
            icon: def.icon.clone(),
            description: def.description.clone(),
            property_count: def.properties.len(),
            object_count: index.summaries(&def.key).len(),
        }
    }
}

/// `GET /api/spaces/{space}/types` [viewer]
async fn list(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Vec<TypeSummary>>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let types = handle.with_index(|index| {
        index
            .types()
            .map(|def| TypeSummary::of(index, def))
            .collect()
    });
    Ok(Json(types))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateTypeRequest {
    name: String,
    #[serde(default)]
    name_plural: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

/// The view a type starts with: newest first, no filter, the title alone.
fn default_view() -> ViewDef {
    ViewDef {
        sorts: vec![Sort {
            property: UPDATED_AT_KEY.to_owned(),
            direction: Direction::Desc,
            empty: EmptyPlacement::End,
        }],
        filter: Filter {
            op: FilterOp::And,
            conditions: Vec::new(),
        },
        columns: vec![TITLE_KEY.to_owned()],
    }
}

/// `POST /api/spaces/{space}/types` [editor]
async fn create(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<CreateTypeRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let name = clean_text("name", &body.name, MAX_TITLE_LEN)?;
    let name_plural = match body.name_plural.as_deref() {
        Some(plural) => clean_text("name_plural", plural, MAX_TITLE_LEN)?,
        None => format!("{name}s"),
    };
    let key = key_from_name(&name);
    if is_reserved_key(&key) {
        return Err(ApiError::validation(
            "name",
            format!("{name} derives the reserved key {key}; rename it"),
        ));
    }

    let def = TypeDef {
        key: key.clone(),
        name,
        name_plural,
        icon: clean_icon(body.icon),
        description: body.description.unwrap_or_default().trim().to_owned(),
        properties: Vec::new(),
        view: default_view(),
    };

    let _guard = handle.write.lock().await;
    // A second type whose name derives the same key is a conflict, not a
    // silently numbered `plant_2`: the caller asked for a name that is taken.
    if handle.with_index(|index| index.type_def(&key).is_some()) {
        return Err(ApiError::from(CoreError::AlreadyExists(
            type_path(&key).display().to_string(),
        )));
    }
    handle.store.save_type(&def, None)?;
    let path = type_path(&key);
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.created", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "type created");

    let created = handle
        .with_index(|index| index.type_def(&key).cloned())
        .ok_or_else(|| ApiError::internal("the type did not survive its own write"))?;
    Ok((StatusCode::CREATED, Json(json!(created))))
}

/// `GET /api/spaces/{space}/types/{key}` [viewer]
async fn detail(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let def = type_of(&handle, &key)?;
    Ok(Json(json!(def)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchTypeRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    name_plural: Option<String>,
    /// `null` clears the icon; leaving the field out leaves it alone.
    #[serde(default, deserialize_with = "double_option")]
    icon: Option<Option<String>>,
    #[serde(default)]
    description: Option<String>,
    /// The type's properties, in display order; the whole list, not a patch of it.
    #[serde(default)]
    properties: Option<Vec<TypeProperty>>,
    #[serde(default)]
    view: Option<ViewDef>,
}

/// `PATCH /api/spaces/{space}/types/{key}` [editor]
async fn update(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    ApiJson(body): ApiJson<PatchTypeRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    if body.name.is_none()
        && body.name_plural.is_none()
        && body.icon.is_none()
        && body.description.is_none()
        && body.properties.is_none()
        && body.view.is_none()
    {
        return Err(ApiError::validation("body", "nothing to change"));
    }
    let name = body
        .name
        .as_deref()
        .map(|name| clean_text("name", name, MAX_TITLE_LEN))
        .transpose()?;
    let name_plural = body
        .name_plural
        .as_deref()
        .map(|plural| clean_text("name_plural", plural, MAX_TITLE_LEN))
        .transpose()?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| {
        let def = index
            .type_def(&key)
            .ok_or_else(|| ApiError::not_found(format!("type {key}")))?;
        let mut next = def.clone();
        if let Some(name) = name {
            next.name = name;
        }
        if let Some(name_plural) = name_plural {
            next.name_plural = name_plural;
        }
        if let Some(icon) = body.icon.clone() {
            next.icon = clean_icon(icon);
        }
        if let Some(description) = &body.description {
            next.description = description.trim().to_owned();
        }
        if let Some(properties) = &body.properties {
            next.properties = properties.clone();
        }
        if let Some(view) = &body.view {
            next.view = view.clone();
        }
        let schema = index.schema();
        let mut errors = check_members(index, &next.properties);
        errors.extend(check_view(&schema, &next));
        if errors.is_empty() {
            Ok(next)
        } else {
            Err(ApiError::validation_all(errors))
        }
    })?;

    let path = type_path(&key);
    let expected = handle.with_index(|index| index.fingerprint(&path));
    handle.store.save_type(&next, expected)?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.updated", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "type updated");
    Ok(Json(json!(type_of(&handle, &key)?)))
}

/// `DELETE /api/spaces/{space}/types/{key}?delete_objects=true` [editor]
///
/// A type with objects is refused unless the caller says what happens to them;
/// they are trashed, not purged, so nothing is destroyed by deleting a type.
async fn remove(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    mut query: ApiQuery,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let delete_objects = query.parse::<bool>("delete_objects")?.unwrap_or(false);
    query.finish()?;
    let _guard = handle.write.lock().await;
    let live: Vec<(ObjectSummary, PathBuf)> = handle.with_index(|index| {
        if index.type_def(&key).is_none() {
            return Err(ApiError::not_found(format!("type {key}")));
        }
        Ok(index
            .summaries(&key)
            .iter()
            .filter_map(|summary| {
                index
                    .object_path(summary.id)
                    .map(|path| (summary.clone(), path.to_owned()))
            })
            .collect())
    })?;
    if !live.is_empty() && !delete_objects {
        return Err(ApiError::conflict(
            format!("type {key} still has {} objects", live.len()),
            json!({ "reason": "objects remain", "objects": live.len() }),
        ));
    }

    let now = OffsetDateTime::now_utc();
    for (summary, path) in &live {
        trash_and_record(&handle, &caller, summary, path, now, RevisionAction::Delete)?;
        handle.broadcast(
            "object.deleted",
            json!({ "id": summary.id, "type": summary.type_key, "rev": summary.rev }),
        );
    }
    handle.store.remove_type(&key)?;
    let path = type_path(&key);
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.deleted", json!({ "key": key }));
    tracing::info!(
        space = %space,
        user = %caller.user.id,
        key = %key,
        objects = live.len(),
        "type deleted"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// The whole definition, or a `404` naming the key.
fn type_of(handle: &Arc<SpaceHandle>, key: &str) -> Result<TypeDef, ApiError> {
    handle
        .with_index(|index| index.type_def(key).cloned())
        .ok_or_else(|| ApiError::not_found(format!("type {key}")))
}

/// Checks a type's property list: every key is a legal, defined property, listed
/// once. A member names a property of the space, never an invented one.
fn check_members(index: &SpaceIndex, members: &[TypeProperty]) -> Vec<CoreError> {
    let mut errors = Vec::new();
    let mut seen: Vec<&str> = Vec::with_capacity(members.len());
    for member in members {
        let key = member.key.as_str();
        if !is_valid_key(key) {
            errors.push(CoreError::ValidationFailed {
                field: key.to_owned(),
                message: "is not a key: lowercase letters, digits and underscores, starting with a letter"
                    .to_owned(),
            });
        } else if is_reserved_key(key) {
            errors.push(CoreError::ValidationFailed {
                field: key.to_owned(),
                message: "is a reserved frontmatter key".to_owned(),
            });
        } else if index.property_def(key).is_none() {
            errors.push(CoreError::ValidationFailed {
                field: key.to_owned(),
                message: "is not a property of this space".to_owned(),
            });
        }
        if seen.contains(&key) {
            errors.push(CoreError::ValidationFailed {
                field: key.to_owned(),
                message: "is listed twice".to_owned(),
            });
        }
        seen.push(key);
    }
    errors
}

/// Checks a type's view: `title` first, every other column a property of the
/// type, and the filter and sorts valid for it.
fn check_view(schema: &Schema, def: &TypeDef) -> Vec<CoreError> {
    let mut errors = Vec::new();
    if def.view.columns.first().map(String::as_str) != Some(TITLE_KEY) {
        errors.push(CoreError::ValidationFailed {
            field: "view.columns".to_owned(),
            message: format!("must start with {TITLE_KEY}"),
        });
    }
    let mut seen: Vec<&str> = Vec::with_capacity(def.view.columns.len());
    for column in &def.view.columns {
        if column != TITLE_KEY && !def.properties.iter().any(|member| &member.key == column) {
            errors.push(CoreError::ValidationFailed {
                field: column.clone(),
                message: format!("is not a property of type {}", def.key),
            });
        }
        if seen.contains(&column.as_str()) {
            errors.push(CoreError::ValidationFailed {
                field: column.clone(),
                message: "is listed twice".to_owned(),
            });
        }
        seen.push(column);
    }
    if let Err(mut found) = validate::validate_filter(schema, def, &def.view.filter) {
        errors.append(&mut found);
    }
    if let Err(mut found) = validate::validate_sorts(schema, def, &def.view.sorts) {
        errors.append(&mut found);
    }
    errors
}

#[cfg(test)]
mod tests {
    use thing_core::model::{PropertyDef, PropertyFormat};
    use thing_core::store::fs::FsSpaceStore;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn the_default_view_lists_the_title_and_shows_the_newest_first() {
        let view = default_view();
        assert_eq!(view.columns, vec![TITLE_KEY]);
        assert!(view.filter.conditions.is_empty());
        assert_eq!(view.sorts.len(), 1);
        assert_eq!(view.sorts[0].property, UPDATED_AT_KEY);
        assert_eq!(view.sorts[0].direction, Direction::Desc);
    }

    #[test]
    fn a_member_that_is_not_a_defined_property_is_refused() {
        let index = &index_of(&[]);
        let errors = check_members(
            index,
            &[TypeProperty {
                key: "ghost".to_owned(),
                required: false,
                featured: false,
            }],
        );
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid ghost: is not a property of this space"]
        );
    }

    #[test]
    fn a_view_column_that_is_not_a_property_is_refused() {
        let index = index_of(&[property("room", PropertyFormat::Text)]);
        let schema = index.schema();
        let def = TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            properties: Vec::new(),
            view: ViewDef {
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec![TITLE_KEY.to_owned(), "room".to_owned()],
            },
        };
        assert_eq!(
            check_view(&schema, &def)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["invalid room: is not a property of type plant"]
        );
    }

    fn property(key: &str, format: PropertyFormat) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: key.to_owned(),
            format,
            options: Vec::new(),
            target_type: None,
            multi: false,
        }
    }

    fn index_of(properties: &[PropertyDef]) -> SpaceIndex {
        let dir = tempfile::tempdir().expect("a temporary space");
        let meta = thing_core::model::SpaceMeta {
            id: Uuid::now_v7(),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: OffsetDateTime::now_utc(),
            members: Vec::new(),
        };
        let store = FsSpaceStore::create(dir.path(), &meta).expect("creates the space");
        for def in properties {
            store.save_property(def, None).expect("property");
        }
        SpaceIndex::rebuild_from_disk(&store).expect("index")
    }
}
