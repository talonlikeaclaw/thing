//! Property routes: the space-wide property definitions every type picks from.
//!
//! A property is defined once per space and referenced by key, so renaming one
//! is a rewrite of every file that names it, not a copy. Its key never changes
//! on a display-name edit; `POST /rename` is the one operation that moves it,
//! and it moves the values with it.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::index::SpaceIndex;
use thing_core::model::{ObjectDoc, OptionDef, PropertyDef, PropertyFormat, Role, is_reserved_key};
use thing_core::schedule::is_schedule_key;
use thing_core::slug::{is_valid_key, key_from_name};
use thing_core::store::{SpaceStore, property_path};
use thing_core::validate::MAX_TITLE_LEN;
use time::OffsetDateTime;

use super::{ApiJson, ApiQuery, clean_text, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/properties", get(list).post(create))
        .route(
            "/api/spaces/{space}/properties/{key}",
            get(detail).patch(update).delete(remove),
        )
        .route("/api/spaces/{space}/properties/{key}/rename", post(rename))
}

/// `GET /api/spaces/{space}/properties` [viewer]
async fn list(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Vec<PropertyDef>>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    Ok(Json(
        handle.with_index(|index| index.properties().cloned().collect()),
    ))
}

/// `GET /api/spaces/{space}/properties/{key}` [viewer]
async fn detail(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    Ok(Json(json!(property_of(&handle, &key)?)))
}

/// One option as a request writes it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OptionInput {
    /// Absent only when the property is created: the key is then derived from
    /// the name. An edit sends back the key it read, so renaming an option's
    /// display name never moves a stored value.
    #[serde(default)]
    key: Option<String>,
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreatePropertyRequest {
    name: String,
    format: PropertyFormat,
    #[serde(default)]
    options: Option<Vec<OptionInput>>,
    #[serde(default)]
    target_type: Option<String>,
    #[serde(default)]
    multi: Option<bool>,
}

/// `POST /api/spaces/{space}/properties` [editor]
async fn create(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<CreatePropertyRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let name = clean_text("name", &body.name, MAX_TITLE_LEN)?;
    let key = key_from_name(&name);
    if is_reserved_key(&key) {
        return Err(ApiError::validation(
            "name",
            format!("{name} derives the reserved key {key}; rename it"),
        ));
    }
    reject_schedule_key("name", &key)?;
    let options = read_options(body.options.as_deref().unwrap_or_default(), None)?;
    let multi = body.multi.unwrap_or(false);

    let def = PropertyDef {
        key: key.clone(),
        name,
        format: body.format,
        options,
        target_type: body.target_type.clone(),
        multi,
    };

    let _guard = handle.write.lock().await;
    handle.with_index(|index| check_shape(index, &def))?;
    if handle.with_index(|index| declared_property(index, &key).is_some()) {
        return Err(ApiError::from(CoreError::AlreadyExists(
            property_path(&key).display().to_string(),
        )));
    }
    handle.store.save_property(&def, None)?;
    let path = property_path(&key);
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("property.created", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "property created");
    Ok((
        StatusCode::CREATED,
        Json(json!(property_of(&handle, &key)?)),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchPropertyRequest {
    #[serde(default)]
    name: Option<String>,
    /// The whole option list, in display order.
    #[serde(default)]
    options: Option<Vec<OptionInput>>,
}

/// `PATCH /api/spaces/{space}/properties/{key}` [editor]
///
/// The format is fixed once the property exists: values are stored for it, and
/// changing what they mean is a new property, not an edit of this one.
async fn update(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    ApiJson(body): ApiJson<PatchPropertyRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    if body.name.is_none() && body.options.is_none() {
        return Err(ApiError::validation("body", "nothing to change"));
    }
    let name = body
        .name
        .as_deref()
        .map(|name| clean_text("name", name, MAX_TITLE_LEN))
        .transpose()?;

    let _guard = handle.write.lock().await;
    let next = handle.with_index(|index| -> Result<PropertyDef, ApiError> {
        let def = declared_property(index, &key)
            .ok_or_else(|| ApiError::not_found(format!("property {key}")))?;
        let mut next = def.clone();
        if let Some(name) = name {
            next.name = name;
        }
        if let Some(options) = &body.options {
            let read = read_options(options, Some(&next.options))?;
            check_options_kept(index, &next.key, &read, &def.options)?;
            next.options = read;
        }
        Ok(next)
    })?;

    let path = property_path(&key);
    let expected = handle.with_index(|index| index.fingerprint(&path));
    handle.store.save_property(&next, expected)?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("property.updated", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "property updated");
    Ok(Json(json!(property_of(&handle, &key)?)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RenamePropertyRequest {
    key: String,
}

/// `POST /api/spaces/{space}/properties/{key}/rename` [editor]
///
/// Rewrites the key everywhere it appears, one file at a time, so the space is
/// rebuilt from disk afterwards rather than patched file by file.
async fn rename(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    ApiJson(body): ApiJson<RenamePropertyRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let next = body.key.trim().to_owned();
    if !is_valid_key(&next) {
        return Err(ApiError::validation(
            "key",
            "a key is lowercase letters, digits and underscores, starting with a letter",
        ));
    }
    if is_reserved_key(&next) {
        return Err(ApiError::validation(
            "key",
            format!("{next} is a reserved frontmatter key"),
        ));
    }
    reject_schedule_key("key", &next)?;

    let _guard = handle.write.lock().await;
    handle.with_index(|index| {
        if declared_property(index, &key).is_none() {
            return Err(ApiError::not_found(format!("property {key}")));
        }
        if declared_property(index, &next).is_some() {
            return Err(ApiError::from(CoreError::AlreadyExists(
                property_path(&next).display().to_string(),
            )));
        }
        Ok(())
    })?;

    handle
        .store
        .rename_property_key(&key, &next, OffsetDateTime::now_utc(), caller.user.id)?;
    rebuild(&handle)?;
    handle.broadcast("property.updated", json!({ "key": next }));
    tracing::info!(space = %space, user = %caller.user.id, from = %key, to = %next, "property renamed");
    Ok(Json(json!(property_of(&handle, &next)?)))
}

/// `DELETE /api/spaces/{space}/properties/{key}?force=true` [editor]
///
/// A property any type or any object uses is refused unless `force=true`, which
/// strips it from every file it appears in and records what it dropped in each
/// object's history.
async fn remove(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    mut query: ApiQuery,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let force = query.parse::<bool>("force")?.unwrap_or(false);
    query.finish()?;

    let _guard = handle.write.lock().await;
    let (types, objects) = handle.with_index(|index| {
        if declared_property(index, &key).is_none() {
            return Err(ApiError::not_found(format!("property {key}")));
        }
        Ok(usage(index, &key))
    })?;
    if (types > 0 || objects > 0) && !force {
        return Err(ApiError::conflict(
            format!("property {key} is in use"),
            json!({ "reason": "in use", "types": types, "objects": objects }),
        ));
    }

    handle
        .store
        .remove_property_key(&key, OffsetDateTime::now_utc(), caller.user.id)?;
    rebuild(&handle)?;
    handle.broadcast("property.deleted", json!({ "key": key }));
    tracing::info!(space = %space, user = %caller.user.id, key = %key, "property deleted");
    Ok(StatusCode::NO_CONTENT)
}

/// The whole definition, or a `404` naming the key. Property routes address
/// declared files only; the generated schedule keys are not properties the
/// space owns.
fn property_of(handle: &Arc<SpaceHandle>, key: &str) -> Result<PropertyDef, ApiError> {
    handle
        .with_index(|index| declared_property(index, key).cloned())
        .ok_or_else(|| ApiError::not_found(format!("property {key}")))
}

fn declared_property<'a>(index: &'a SpaceIndex, key: &str) -> Option<&'a PropertyDef> {
    index.properties().find(|def| def.key == key)
}

/// Schedule keys are generated in every space, whether or not a type uses them,
/// so a declared property may never take one.
fn reject_schedule_key(field: &str, key: &str) -> Result<(), ApiError> {
    if is_schedule_key(key) {
        return Err(ApiError::validation(
            field,
            format!("{key} is a generated schedule key"),
        ));
    }
    Ok(())
}

/// Rebuilds the index from disk, which a space-wide rewrite leaves true again.
fn rebuild(handle: &Arc<SpaceHandle>) -> Result<(), ApiError> {
    let outcome = handle.with_index_mut(|index| -> Result<(), CoreError> {
        *index = SpaceIndex::rebuild_from_disk(&handle.store)?;
        Ok(())
    });
    outcome.map_err(ApiError::from)
}

/// Reads a request's option list into definitions.
///
/// `previous` is the list the property already has: an option whose key is left
/// out keeps the key of the option with its name, so a client that sends names
/// and colors back cannot accidentally re-key a stored value.
fn read_options(
    inputs: &[OptionInput],
    previous: Option<&[OptionDef]>,
) -> Result<Vec<OptionDef>, ApiError> {
    let mut options: Vec<OptionDef> = Vec::with_capacity(inputs.len());
    for input in inputs {
        let name = clean_text("options.name", &input.name, MAX_TITLE_LEN)?;
        let key = match &input.key {
            Some(key) => key.trim().to_owned(),
            None => match previous.and_then(|known| {
                known
                    .iter()
                    .find(|option| option.name == name)
                    .map(|option| option.key.clone())
            }) {
                Some(key) => key,
                None => key_from_name(&name),
            },
        };
        if !is_valid_key(&key) {
            return Err(ApiError::validation(
                "options.key",
                format!("{key} is not a key: lowercase letters, digits and underscores"),
            ));
        }
        if options.iter().any(|option| option.key == key) {
            return Err(ApiError::validation(
                "options.key",
                format!("{key} is listed twice"),
            ));
        }
        options.push(OptionDef {
            key,
            name,
            color: input.color.clone().unwrap_or_default().trim().to_owned(),
        });
    }
    Ok(options)
}

/// Refuses options left over that a stored value still names.
fn check_options_kept(
    index: &SpaceIndex,
    key: &str,
    next: &[OptionDef],
    previous: &[OptionDef],
) -> Result<(), ApiError> {
    for option in previous {
        if next.iter().any(|kept| kept.key == option.key) {
            continue;
        }
        let users = holders(index, key, &option.key);
        if users > 0 {
            return Err(ApiError::validation(
                "options",
                format!(
                    "{} is still used by {users} object(s); move them to another option first",
                    option.name
                ),
            ));
        }
    }
    Ok(())
}

/// How many objects and types name this property.
fn usage(index: &SpaceIndex, key: &str) -> (usize, usize) {
    let types = index
        .types()
        .filter(|def| {
            def.properties.iter().any(|member| member.key == key)
                || def.views.iter().any(|view| {
                    view.columns.iter().any(|column| column == key)
                        || view.widths.contains_key(key)
                        || view.sorts.iter().any(|sort| sort.property == key)
                        || view
                            .filter
                            .conditions
                            .iter()
                            .any(|condition| condition.property == key)
                        || view.group_by.as_deref() == Some(key)
                        || view.cover.as_deref() == Some(key)
                        || view.date_property.as_deref() == Some(key)
                })
        })
        .count();
    let objects = index
        .objects()
        .chain(index.trash())
        .filter(|doc| doc.properties.contains_key(key))
        .count();
    (types, objects)
}

/// How many objects hold this option key of this property.
fn holders(index: &SpaceIndex, key: &str, option: &str) -> usize {
    index
        .objects()
        .chain(index.trash())
        .filter(|doc| holds_option(doc, key, option))
        .count()
}

fn holds_option(doc: &ObjectDoc, key: &str, option: &str) -> bool {
    match doc.properties.get(key) {
        Some(thing_core::model::Value::Text(text)) => text == option,
        Some(thing_core::model::Value::List(items)) => items.iter().any(|item| item == option),
        _ => false,
    }
}

/// Checks a new definition: options belong to `select` and `multi_select` and
/// name real keys, a relation may name a type, and nothing else takes either.
fn check_shape(index: &SpaceIndex, def: &PropertyDef) -> Result<(), ApiError> {
    let selects = matches!(
        def.format,
        PropertyFormat::Select | PropertyFormat::MultiSelect
    );
    if !selects && !def.options.is_empty() {
        return Err(ApiError::validation(
            "options",
            "only a select or multi_select property has options",
        ));
    }
    if def.format != PropertyFormat::Relation {
        if def.target_type.is_some() {
            return Err(ApiError::validation(
                "target_type",
                "only a relation names a target type",
            ));
        }
        if def.multi {
            return Err(ApiError::validation(
                "multi",
                "only a relation can hold more than one target",
            ));
        }
        return Ok(());
    }
    if let Some(target) = &def.target_type
        && index.type_def(target).is_none()
    {
        return Err(ApiError::validation(
            "target_type",
            format!("{target} is not a type in this space"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    #[test]
    fn a_schedule_key_cannot_be_declared_as_a_property() {
        for key in thing_core::schedule::SCHEDULE_KEYS {
            let err = reject_schedule_key("name", key).expect_err(key);
            assert_eq!(err.message(), format!("{key} is a generated schedule key"));
        }
        reject_schedule_key("name", "room").expect("an ordinary key");
    }

    #[test]
    fn an_option_key_is_derived_from_the_name_when_it_is_left_out() {
        let inputs = [OptionInput {
            key: None,
            name: "To do".to_owned(),
            color: Some("amber".to_owned()),
        }];
        assert_eq!(
            read_options(&inputs, None).expect("options"),
            vec![OptionDef {
                key: "to_do".to_owned(),
                name: "To do".to_owned(),
                color: "amber".to_owned(),
            }]
        );
    }

    #[test]
    fn an_option_left_out_keeps_the_key_of_the_one_it_is_named_after() {
        let known = [OptionDef {
            key: "todo".to_owned(),
            name: "To do".to_owned(),
            color: "amber".to_owned(),
        }];
        let inputs = [OptionInput {
            key: None,
            name: "To do".to_owned(),
            color: Some("green".to_owned()),
        }];
        let options = read_options(&inputs, Some(&known)).expect("options");
        assert_eq!(options[0].key, "todo");
        assert_eq!(options[0].color, "green");
    }

    #[test]
    fn a_duplicated_option_key_is_refused() {
        let inputs = [
            OptionInput {
                key: Some("todo".to_owned()),
                name: "To do".to_owned(),
                color: None,
            },
            OptionInput {
                key: Some("todo".to_owned()),
                name: "Done".to_owned(),
                color: None,
            },
        ];
        assert!(read_options(&inputs, None).is_err());
    }

    #[test]
    fn an_option_holding_objects_blocks_its_removal() {
        use std::collections::BTreeMap;

        use thing_core::model::{SpaceMeta, Value};
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
        let status = PropertyDef {
            key: "status".to_owned(),
            name: "Status".to_owned(),
            format: PropertyFormat::Select,
            options: vec![OptionDef {
                key: "todo".to_owned(),
                name: "To do".to_owned(),
                color: String::new(),
            }],
            target_type: None,
            multi: false,
        };
        store.save_property(&status, None).expect("property");
        let doc = ObjectDoc {
            id: Uuid::now_v7(),
            type_key: "plant".to_owned(),
            title: "Monstera".to_owned(),
            rev: 1,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            created_by: Uuid::now_v7(),
            updated_by: Uuid::now_v7(),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::from([("status".to_owned(), Value::Text("todo".to_owned()))]),
            body: String::new(),
        };
        let path = store.new_object_path("plant", &doc.title).expect("a path");
        store.save_object(&path, &doc, None).expect("object");
        let index = SpaceIndex::rebuild_from_disk(&store).expect("index");

        assert_eq!(
            check_options_kept(&index, "status", &[], &status.options)
                .expect_err("an option in use")
                .message(),
            "To do is still used by 1 object(s); move them to another option first"
        );
        assert_eq!(usage(&index, "status"), (0, 1));
        assert!(check_options_kept(&index, "status", &status.options, &status.options).is_ok());
    }
}
