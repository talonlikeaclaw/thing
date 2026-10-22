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
    Direction, EmptyPlacement, Filter, FilterOp, ObjectSummary, PropertyDef, RevisionAction, Role,
    ScheduleLabels, Sort, TITLE_KEY, TypeDef, TypeProperty, UPDATED_AT_KEY, ViewDef, ViewKind,
    is_reserved_key,
};
use thing_core::schedule::{DUE_DATE_KEY, SCHEDULE_KEYS, is_schedule_key, schedule_property_defs};
use thing_core::slug::key_from_name;
use thing_core::store::{SpaceStore, remove_property_from_type, type_path};
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
    pub schedule: bool,
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
            schedule: def.schedule,
            property_count: def.properties.len() + if def.schedule { 3 } else { 0 },
            object_count: index.summaries(&def.key).len(),
        }
    }
}

/// A type as detail, create and patch return it: the definition its files hold
/// plus the generated schedule properties the client never has to guess.
#[derive(Debug, Serialize)]
pub struct TypeDetail {
    pub key: String,
    pub name: String,
    pub name_plural: String,
    pub icon: Option<String>,
    pub description: String,
    pub schedule: bool,
    #[serde(skip_serializing_if = "ScheduleLabels::is_empty")]
    pub schedule_labels: ScheduleLabels,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub implicit_properties: Vec<PropertyDef>,
    pub properties: Vec<TypeProperty>,
    pub views: Vec<ViewDef>,
    pub default_view: String,
}

impl TypeDetail {
    fn of(def: &TypeDef) -> Self {
        let implicit_properties = if def.schedule {
            let defs = schedule_property_defs();
            SCHEDULE_KEYS
                .iter()
                .filter_map(|key| defs.get(*key).cloned())
                .map(|mut property| {
                    if let Some(name) = def.schedule_labels.for_key(&property.key) {
                        property.name = name.to_owned();
                    }
                    property
                })
                .collect()
        } else {
            Vec::new()
        };
        Self {
            key: def.key.clone(),
            name: def.name.clone(),
            name_plural: def.name_plural.clone(),
            icon: def.icon.clone(),
            description: def.description.clone(),
            schedule: def.schedule,
            schedule_labels: def.schedule_labels.clone(),
            implicit_properties,
            properties: def.properties.clone(),
            views: def.views.clone(),
            default_view: def.default_view.clone(),
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
    #[serde(default)]
    schedule: bool,
    #[serde(default)]
    schedule_labels: Option<ScheduleLabels>,
}

/// Labels are short interface names, not prose; the key itself stays fixed.
const MAX_SCHEDULE_LABEL_LEN: usize = 80;

fn clean_schedule_labels(labels: Option<ScheduleLabels>) -> Result<ScheduleLabels, ApiError> {
    let Some(labels) = labels else {
        return Ok(ScheduleLabels::default());
    };
    let clean = |field: &str, value: Option<String>| -> Result<Option<String>, ApiError> {
        let Some(value) = value else {
            return Ok(None);
        };
        let value = value.trim();
        if value.is_empty() {
            return Ok(None);
        }
        if value.chars().count() > MAX_SCHEDULE_LABEL_LEN {
            return Err(ApiError::validation(
                field,
                format!("keep {field} under {MAX_SCHEDULE_LABEL_LEN} characters"),
            ));
        }
        Ok(Some(value.to_owned()))
    };
    Ok(ScheduleLabels {
        due: clean("schedule_labels.due", labels.due)?,
        recurrence: clean("schedule_labels.recurrence", labels.recurrence)?,
        last_completed: clean("schedule_labels.last_completed", labels.last_completed)?,
        complete: clean("schedule_labels.complete", labels.complete)?,
    })
}

/// The view a type starts with: newest first, no filter, the title alone.
fn initial_view() -> ViewDef {
    ViewDef {
        key: "all".to_owned(),
        name: "All".to_owned(),
        kind: ViewKind::Table,
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
        widths: std::collections::BTreeMap::new(),
        group_by: None,
        cover: None,
        date_property: None,
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

    let mut def = TypeDef {
        key: key.clone(),
        name,
        name_plural,
        icon: clean_icon(body.icon),
        description: body.description.unwrap_or_default().trim().to_owned(),
        schedule: false,
        schedule_labels: clean_schedule_labels(body.schedule_labels)?,
        properties: Vec::new(),
        views: vec![initial_view()],
        default_view: "all".to_owned(),
    };

    let _guard = handle.write.lock().await;
    // A second type whose name derives the same key is a conflict, not a
    // silently numbered `plant_2`: the caller asked for a name that is taken.
    if handle.with_index(|index| index.type_def(&key).is_some()) {
        return Err(ApiError::from(CoreError::AlreadyExists(
            type_path(&key).display().to_string(),
        )));
    }
    handle.with_index(|index| set_schedule(index, &mut def, body.schedule))?;
    if !def.schedule {
        def.schedule_labels = ScheduleLabels::default();
    }
    handle.with_index(|index| {
        let schema = index.schema();
        let errors = check_type(&schema, &def);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ApiError::validation_all(errors))
        }
    })?;
    handle.store.save_type(&def, None)?;
    let path = type_path(&key);
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.created", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "type created");

    Ok((
        StatusCode::CREATED,
        Json(json!(type_detail(&handle, &key)?)),
    ))
}

/// `GET /api/spaces/{space}/types/{key}` [viewer]
async fn detail(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    Ok(Json(json!(type_detail(&handle, &key)?)))
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
    /// Turning scheduling on or off; the guard and view rewrite live in
    /// [`set_schedule`].
    #[serde(default)]
    schedule: Option<bool>,
    /// Display names for the generated schedule properties; omitted leaves them.
    #[serde(default)]
    schedule_labels: Option<ScheduleLabels>,
    /// The type's properties, in display order; the whole list, not a patch of it.
    #[serde(default)]
    properties: Option<Vec<TypeProperty>>,
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
        && body.schedule.is_none()
        && body.schedule_labels.is_none()
        && body.properties.is_none()
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
            let removed: Vec<String> = next
                .properties
                .iter()
                .filter(|member| !properties.iter().any(|kept| kept.key == member.key))
                .map(|member| member.key.clone())
                .collect();
            next.properties = properties.clone();
            let mut errors = Vec::new();
            for key in &removed {
                for view in validate::dependent_views(&next, key) {
                    let field = if view.group_by.as_deref() == Some(key.as_str()) {
                        "group_by"
                    } else {
                        "date_property"
                    };
                    let message = if field == "group_by" {
                        format!("groups by {key}, which is being removed; change the view first")
                    } else {
                        format!(
                            "uses {key} as its date property, which is being removed; change the view first"
                        )
                    };
                    errors.push(CoreError::ValidationFailed {
                        field: format!("views.{}.{field}", view.key),
                        message,
                    });
                }
            }
            if !errors.is_empty() {
                return Err(ApiError::validation_all(errors));
            }
            for key in &removed {
                remove_property_from_type(&mut next, key);
            }
        }
        if let Some(labels) = &body.schedule_labels {
            next.schedule_labels = clean_schedule_labels(Some(labels.clone()))?;
        }
        if let Some(schedule) = body.schedule {
            set_schedule(index, &mut next, schedule)?;
        }
        if !next.schedule {
            next.schedule_labels = ScheduleLabels::default();
        }
        let schema = index.schema();
        let errors = check_type(&schema, &next);
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
    Ok(Json(json!(type_detail(&handle, &key)?)))
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

/// The whole definition with its generated properties, or a `404` naming the key.
pub(super) fn type_detail(handle: &Arc<SpaceHandle>, key: &str) -> Result<TypeDetail, ApiError> {
    handle
        .with_index(|index| index.type_def(key).map(TypeDetail::of))
        .ok_or_else(|| ApiError::not_found(format!("type {key}")))
}

/// Turns scheduling on or off, with the guards the file format needs.
///
/// Enabling appends `due_date` to the default view once. Disabling refuses
/// while any live or trashed record of the type still holds a schedule key, and
/// while a view structurally depends on one; once it is clear, the keys are
/// dropped from every view in this same write so no view names a missing
/// property.
fn set_schedule(index: &SpaceIndex, next: &mut TypeDef, schedule: bool) -> Result<(), ApiError> {
    if schedule == next.schedule {
        return Ok(());
    }
    if schedule {
        let conflicts: Vec<&str> = index
            .properties()
            .filter(|def| is_schedule_key(&def.key))
            .map(|def| def.key.as_str())
            .collect();
        if !conflicts.is_empty() {
            return Err(ApiError::validation(
                "schedule",
                format!(
                    "the space declares {} with a schedule key; rename or remove it first",
                    conflicts.join(", ")
                ),
            ));
        }
        next.schedule = true;
        let default_key = next.default_view.clone();
        if let Some(view) = next.views.iter_mut().find(|view| view.key == default_key)
            && view.kind != ViewKind::Calendar
            && !view.columns.iter().any(|column| column == DUE_DATE_KEY)
        {
            view.columns.push(DUE_DATE_KEY.to_owned());
        }
        return Ok(());
    }

    let mut holders: Vec<&thing_core::model::ObjectDoc> = index
        .objects()
        .chain(index.trash())
        .filter(|doc| {
            doc.type_key == next.key
                && SCHEDULE_KEYS
                    .iter()
                    .any(|key| doc.properties.contains_key(*key))
        })
        .collect();
    holders.sort_by(|left, right| left.title.cmp(&right.title).then(left.id.cmp(&right.id)));
    if !holders.is_empty() {
        let records: Vec<Value> = holders
            .iter()
            .map(|doc| {
                json!({
                    "id": doc.id,
                    "title": doc.title,
                    "trashed": doc.trashed_at.is_some(),
                })
            })
            .collect();
        return Err(ApiError::conflict(
            "scheduled objects exist",
            json!({
                "reason": "scheduled objects exist",
                "objects": holders.len(),
                "records": records,
            }),
        ));
    }
    let dependent: Vec<&str> = next
        .views
        .iter()
        .filter(|view| {
            view.group_by.as_deref().is_some_and(is_schedule_key)
                || view.date_property.as_deref().is_some_and(is_schedule_key)
        })
        .map(|view| view.key.as_str())
        .collect();
    if !dependent.is_empty() {
        return Err(ApiError::conflict(
            "views use schedule properties",
            json!({
                "reason": "views use schedule properties",
                "views": dependent,
            }),
        ));
    }
    next.schedule = false;
    next.schedule_labels = ScheduleLabels::default();
    for view in &mut next.views {
        view.columns.retain(|column| !is_schedule_key(column));
        view.widths.retain(|key, _| !is_schedule_key(key));
        view.sorts.retain(|sort| !is_schedule_key(&sort.property));
        view.filter
            .conditions
            .retain(|condition| !is_schedule_key(&condition.property));
        if view.cover.as_deref().is_some_and(is_schedule_key) {
            view.cover = None;
        }
    }
    Ok(())
}

/// Checks a type's property list: every key is a legal, defined property, listed
/// once. A member names a property of the space, never an invented one.
fn check_members(schema: &Schema, members: &[TypeProperty]) -> Vec<CoreError> {
    validate::validate_members(schema, members)
        .err()
        .unwrap_or_default()
}

/// Checks a whole type: its property list and every saved view. This is the one
/// call type and view routes share, so the API cannot drift from `/health`.
pub(super) fn check_type(schema: &Schema, def: &TypeDef) -> Vec<CoreError> {
    let mut errors = check_members(schema, &def.properties);
    errors.extend(validate::validate_views(schema, def));
    errors
}

#[cfg(test)]
mod tests {
    use thing_core::model::{ObjectDoc, PropertyDef, PropertyFormat, Value};
    use thing_core::store::fs::FsSpaceStore;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn the_default_view_lists_the_title_and_shows_the_newest_first() {
        let view = initial_view();
        assert_eq!(view.columns, vec![TITLE_KEY]);
        assert!(view.filter.conditions.is_empty());
        assert_eq!(view.sorts.len(), 1);
        assert_eq!(view.sorts[0].property, UPDATED_AT_KEY);
        assert_eq!(view.sorts[0].direction, Direction::Desc);
    }

    #[test]
    fn a_member_that_is_not_a_defined_property_is_refused() {
        let index = index_of(&[]);
        let schema = index.schema();
        let errors = check_members(
            &schema,
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
            schedule: false,
            schedule_labels: Default::default(),
            properties: Vec::new(),
            views: vec![ViewDef {
                key: "all".to_owned(),
                name: "All".to_owned(),
                kind: ViewKind::Table,
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec![TITLE_KEY.to_owned(), "room".to_owned()],
                widths: std::collections::BTreeMap::new(),
                group_by: None,
                cover: None,
                date_property: None,
            }],
            default_view: "all".to_owned(),
        };
        assert_eq!(
            check_type(&schema, &def)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["invalid views.all.columns: names no member: room"]
        );
    }

    fn chore_type() -> TypeDef {
        TypeDef {
            key: "chore".to_owned(),
            name: "Chore".to_owned(),
            name_plural: "Chores".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: Vec::new(),
            views: vec![initial_view()],
            default_view: "all".to_owned(),
        }
    }

    fn chore(title: &str, due: bool) -> ObjectDoc {
        let now = OffsetDateTime::now_utc();
        let mut properties = std::collections::BTreeMap::new();
        if due {
            properties.insert("due_date".to_owned(), Value::Text("2026-10-20".to_owned()));
        }
        ObjectDoc {
            id: Uuid::now_v7(),
            type_key: "chore".to_owned(),
            title: title.to_owned(),
            rev: 1,
            created_at: now,
            updated_at: now,
            created_by: Uuid::now_v7(),
            updated_by: Uuid::now_v7(),
            trashed_at: None,
            trashed_from: None,
            properties,
            body: String::new(),
        }
    }

    #[test]
    fn a_member_may_not_list_a_schedule_key() {
        let index = index_of(&[]);
        let schema = index.schema();
        let errors = check_members(
            &schema,
            &[TypeProperty {
                key: "due_date".to_owned(),
                required: false,
                featured: false,
            }],
        );
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid due_date: is generated by scheduling and is not listed in properties"]
        );
    }

    #[test]
    fn the_summary_counts_and_the_detail_lists_the_generated_properties() {
        let index = index_of(&[]);
        let mut def = chore_type();
        def.schedule = true;
        let summary = TypeSummary::of(&index, &def);
        assert!(summary.schedule);
        assert_eq!(summary.property_count, 3);

        let detail = TypeDetail::of(&def);
        assert!(detail.schedule);
        assert_eq!(
            detail
                .implicit_properties
                .iter()
                .map(|def| def.key.as_str())
                .collect::<Vec<_>>(),
            vec![DUE_DATE_KEY, "recurrence", "last_completed_at"]
        );

        def.schedule = false;
        let plain = TypeDetail::of(&def);
        assert!(!plain.schedule);
        assert!(plain.implicit_properties.is_empty());
        assert_eq!(TypeSummary::of(&index, &def).property_count, 0);
    }

    #[test]
    fn labels_are_trimmed_and_blank_ones_become_defaults() {
        let labels = clean_schedule_labels(Some(ScheduleLabels {
            due: Some("  Next watering  ".to_owned()),
            recurrence: Some("   ".to_owned()),
            last_completed: None,
            complete: Some(" Water ".to_owned()),
        }))
        .expect("clean labels");
        assert_eq!(labels.due.as_deref(), Some("Next watering"));
        assert_eq!(labels.recurrence, None);
        assert_eq!(labels.complete.as_deref(), Some("Water"));
    }

    #[test]
    fn labels_rename_generated_properties_without_moving_their_keys() {
        let mut def = chore_type();
        def.schedule = true;
        def.schedule_labels = ScheduleLabels {
            due: Some("Next watering".to_owned()),
            recurrence: Some("Repeat".to_owned()),
            last_completed: Some("Last watered".to_owned()),
            complete: Some("Water".to_owned()),
        };

        let detail = TypeDetail::of(&def);
        let named: Vec<(&str, &str)> = detail
            .implicit_properties
            .iter()
            .map(|property| (property.key.as_str(), property.name.as_str()))
            .collect();
        assert_eq!(
            named,
            vec![
                (DUE_DATE_KEY, "Next watering"),
                ("recurrence", "Repeat"),
                ("last_completed_at", "Last watered"),
            ]
        );
        assert_eq!(detail.schedule_labels.complete.as_deref(), Some("Water"));
    }

    #[test]
    fn a_schedule_column_needs_the_type_to_be_scheduled() {
        let index = index_of(&[]);
        let schema = index.schema();
        let mut def = chore_type();
        def.schedule = true;
        def.views[0].columns.push(DUE_DATE_KEY.to_owned());
        let found: Vec<String> = check_type(&schema, &def)
            .iter()
            .map(ToString::to_string)
            .collect();
        assert!(found.is_empty(), "{found:?}");
        def.schedule = false;
        assert_eq!(
            check_type(&schema, &def)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["invalid views.all.columns: names no member: due_date"]
        );
    }

    #[test]
    fn turning_scheduling_on_appends_the_due_column_once() {
        let index = index_of(&[]);
        let mut def = chore_type();
        set_schedule(&index, &mut def, true).expect("enables");
        assert!(def.schedule);
        assert_eq!(def.views[0].columns, vec![TITLE_KEY, DUE_DATE_KEY]);
        set_schedule(&index, &mut def, true).expect("still enabled");
        assert_eq!(def.views[0].columns, vec![TITLE_KEY, DUE_DATE_KEY]);
    }

    #[test]
    fn a_declared_schedule_property_blocks_enabling() {
        let index = index_of(&[property("due_date", PropertyFormat::Date)]);
        let mut def = chore_type();
        let err = set_schedule(&index, &mut def, true).expect_err("declared conflict");
        assert!(err.message().contains("declares due_date"));
        assert!(!def.schedule);
    }

    #[test]
    fn disabling_strips_the_schedule_keys_from_the_view() {
        let index = index_of(&[]);
        let mut def = chore_type();
        def.schedule = true;
        def.views[0].columns = vec![
            TITLE_KEY.to_owned(),
            DUE_DATE_KEY.to_owned(),
            "recurrence".to_owned(),
        ];
        def.views[0].sorts.push(Sort {
            property: DUE_DATE_KEY.to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        });
        def.views[0]
            .filter
            .conditions
            .push(thing_core::model::Condition {
                property: "last_completed_at".to_owned(),
                condition: thing_core::model::CondOp::IsEmpty,
                value: None,
            });

        def.schedule_labels.complete = Some("Water".to_owned());
        set_schedule(&index, &mut def, false).expect("disables");
        assert!(!def.schedule);
        assert!(def.schedule_labels.is_empty());
        assert_eq!(def.views[0].columns, vec![TITLE_KEY]);
        assert_eq!(
            def.views[0]
                .sorts
                .iter()
                .map(|sort| sort.property.as_str())
                .collect::<Vec<_>>(),
            vec![UPDATED_AT_KEY]
        );
        assert!(def.views[0].filter.conditions.is_empty());
    }

    #[test]
    fn disabling_is_refused_while_a_record_holds_a_schedule_key() {
        let store_dir = tempfile::tempdir().expect("a temporary space");
        let meta = thing_core::model::SpaceMeta {
            id: Uuid::now_v7(),
            name: "Chores".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: OffsetDateTime::now_utc(),
            members: Vec::new(),
        };
        let store = FsSpaceStore::create(store_dir.path(), &meta).expect("space");
        let mut def = chore_type();
        def.schedule = true;
        store.save_type(&def, None).expect("type");
        let path = store
            .new_object_path("chore", "Water the monstera")
            .expect("path");
        store
            .save_object(&path, &chore("Water the monstera", true), None)
            .expect("object");
        let index = SpaceIndex::rebuild_from_disk(&store).expect("index");

        let err = set_schedule(&index, &mut def, false).expect_err("scheduled object");
        assert_eq!(err.message(), "scheduled objects exist");
        assert_eq!(err.details()["objects"], 1);
        assert_eq!(err.details()["records"][0]["title"], "Water the monstera");
        assert_eq!(err.details()["records"][0]["trashed"], false);
        assert!(def.schedule);

        let (_, at) = store.load_object(&path).expect("object");
        store
            .save_object(&path, &chore("Water the monstera", false), Some(at))
            .expect("cleared");
        let index = SpaceIndex::rebuild_from_disk(&store).expect("index");
        set_schedule(&index, &mut def, false).expect("disables once cleared");
        assert!(!def.schedule);
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
