//! Column promotion: plan a text, select or multi-select column's move to a
//! relation, create the target type and its records, link every source record
//! through a temporary relation, then restore the column's key.
//!
//! The plan stage is a read. `targets` writes the new type and one record per
//! distinct value, `links` writes the temporary relation and moves the views,
//! and `finish` removes the old column and renames the relation back. Every
//! stage skips what an earlier run already wrote, so a retry resumes.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::index::SpaceIndex;
use thing_core::model::{
    ObjectDoc, PropertyFormat, Revision, RevisionAction, Role, Snapshot, Value as CoreValue,
};
use thing_core::promote::{self, PromoteOptions, PromotePlan};
use thing_core::slug::key_from_name;
use thing_core::store::{FileFingerprint, SpaceStore, property_path, type_path};
use thing_core::validate::{self, MAX_TITLE_LEN};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{ApiJson, clean_icon, clean_text, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new().route(
        "/api/spaces/{space}/types/{key}/promote",
        post(promote_column),
    )
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    Plan,
    Targets,
    Links,
    Finish,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetInput {
    name: String,
    #[serde(default)]
    name_plural: Option<String>,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PromoteRequest {
    stage: Stage,
    /// The source property key.
    property: String,
    target: TargetInput,
    /// The target type key a retry reuses instead of deriving a new one.
    #[serde(default)]
    target_type: Option<String>,
    relation_name: String,
    #[serde(default)]
    multi: bool,
    #[serde(default)]
    split: Option<String>,
}

/// `POST /api/spaces/{space}/types/{key}/promote` [editor]
///
/// `plan` reads and returns the whole migration preview. `targets` creates the
/// target type when it is missing and every record whose folded title is not
/// already present; a retry names the same type and reuses every record.
async fn promote_column(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, key)): Path<(String, String)>,
    ApiJson(body): ApiJson<PromoteRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let name = clean_text("target.name", &body.target.name, MAX_TITLE_LEN)?;
    let name_plural = match body.target.name_plural.as_deref() {
        Some(plural) => Some(clean_text("target.name_plural", plural, MAX_TITLE_LEN)?),
        None => None,
    };
    let relation_name = clean_text("relation_name", &body.relation_name, MAX_TITLE_LEN)?;
    let options = PromoteOptions {
        target_name: name,
        target_name_plural: name_plural,
        target_icon: clean_icon(body.target.icon),
        relation_name,
        multi: body.multi,
        split: body
            .split
            .map(|delimiter| delimiter.trim().to_owned())
            .filter(|delimiter| !delimiter.is_empty()),
    };

    let _guard = handle.write.lock().await;
    handle.with_index(|index| {
        if index.type_def(&key).is_none() {
            return Err(ApiError::not_found(format!("type {key}")));
        }
        Ok(())
    })?;

    // Finish does not need a plan: once the rename has run the source key names
    // a relation, which the plan validator rightly refuses as a source.
    if matches!(body.stage, Stage::Finish) {
        let target_key = body.target_type.clone().ok_or_else(|| {
            ApiError::validation("target_type", "finish names the created target type")
        })?;
        return run_finish(
            &handle,
            &caller,
            &body.property,
            &target_key,
            &promote::temporary_key(&body.property),
            body.multi,
        );
    }

    let resume_key = match body.stage {
        Stage::Targets => body.target_type.clone().or_else(|| {
            // A retry after the type was created must resume rather than
            // report the key as taken; the derived key is the type it made.
            let derived = key_from_name(&options.target_name);
            handle
                .with_index(|index| index.type_def(&derived).is_some())
                .then_some(derived)
        }),
        Stage::Links => body.target_type.clone(),
        Stage::Plan | Stage::Finish => body.target_type.clone(),
    };
    if matches!(body.stage, Stage::Links) && resume_key.is_none() {
        return Err(ApiError::validation(
            "target_type",
            "linking names the created target type",
        ));
    }
    let plan = handle.with_index(|index| {
        promote::plan(index, &key, &body.property, &options, resume_key.as_deref())
    });

    match body.stage {
        Stage::Plan => Ok(Json(json!(plan))),
        Stage::Targets => run_targets(&handle, &caller, plan),
        Stage::Links => run_links(&handle, &caller, plan),
        Stage::Finish => unreachable!("finish returns before the plan"),
    }
}

/// Writes the type and records a planned `targets` stage describes.
fn run_targets(
    handle: &Arc<SpaceHandle>,
    caller: &Caller,
    plan: PromotePlan,
) -> Result<Json<Value>, ApiError> {
    let targets = handle.with_index(|index| promote::targets(index, &plan))?;
    if targets.create_type {
        handle.store.save_type(&targets.type_def, None)?;
        let path = type_path(&targets.type_def.key);
        handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
        handle.broadcast("type.created", json!({ "key": targets.type_def.key }));
        tracing::info!(space = %handle.meta().id, user = %caller.user.id, key = %targets.type_def.key, "promotion target type created");
    }

    let now = OffsetDateTime::now_utc();
    let mut created = 0usize;
    for record in &targets.records {
        if record.exists {
            continue;
        }
        let doc: ObjectDoc =
            promote::target_record(&plan, record.id, &record.title, now, caller.user.id);
        handle.with_index(|index| {
            if let Err(errors) = validate::validate_object(&index.schema(), &doc) {
                return Err(ApiError::validation_all(errors));
            }
            Ok(())
        })?;
        let path = handle.store.new_object_path(&doc.type_key, &doc.title)?;
        handle.store.save_object(&path, &doc, None)?;
        handle.store.append_revision(
            doc.id,
            &Revision {
                rev: doc.rev,
                at: now,
                by: caller.user.id,
                action: RevisionAction::Create,
                snapshot: Snapshot {
                    title: doc.title.clone(),
                    icon: doc.icon.clone(),
                    cover: doc.cover.clone(),
                    cover_position: doc.cover_position.clone(),
                    properties: doc.properties.clone(),
                },
                body: Some(doc.body.clone()),
            },
        )?;
        handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
        handle.broadcast(
            "object.created",
            json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
        );
        created += 1;
    }

    let rows: Vec<Value> = targets
        .records
        .iter()
        .map(|record| {
            json!({
                "id": record.id,
                "title": record.title,
                "exists": record.exists,
            })
        })
        .collect();
    // The newest target row is the most useful ordering for a caller that just
    // watched them appear; the ids are what a retry depends on.
    tracing::info!(
        space = %handle.meta().id,
        user = %caller.user.id,
        type_key = %targets.type_def.key,
        created,
        "promotion targets written"
    );
    Ok(Json(json!({
        "type": targets.type_def.key,
        "type_created": targets.create_type,
        "created": created,
        "records": rows,
    })))
}

/// Writes the temporary relation, moves the type's views onto it and links
/// every source record the first time it runs.
///
/// The relation property and the type are written before the objects so the
/// validator sees the new member; a record that already holds the temporary key
/// is skipped, and a second run writes nothing.
fn run_links(
    handle: &Arc<SpaceHandle>,
    caller: &Caller,
    plan: PromotePlan,
) -> Result<Json<Value>, ApiError> {
    let linked = handle.with_index(|index| promote::links(index, &plan))?;
    let relation_key = linked.property.key.clone();
    if linked.create_property {
        let path = property_path(&relation_key);
        handle.store.save_property(&linked.property, None)?;
        handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
        handle.broadcast("property.created", json!({ "key": relation_key }));
    }

    let type_key = linked.type_def.key.clone();
    let path = type_path(&type_key);
    let expected = handle.with_index(|index| index.fingerprint(&path));
    handle.store.save_type(&linked.type_def, expected)?;
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
    handle.broadcast("type.updated", json!({ "key": type_key }));

    let now = OffsetDateTime::now_utc();
    let mut written = 0usize;
    for link in &linked.links {
        let prepared = handle.with_index(
            |index| -> Result<Option<(ObjectDoc, PathBuf, Option<FileFingerprint>)>, ApiError> {
                let (doc, path) = match (index.object(link.record), index.trashed(link.record)) {
                    (Some(doc), _) => (
                        doc.clone(),
                        index.object_path(link.record).map(|path| path.to_owned()),
                    ),
                    (None, Some(doc)) => (
                        doc.clone(),
                        index.trash_path(link.record).map(|path| path.to_owned()),
                    ),
                    (None, None) => return Ok(None),
                };
                let Some(path) = path else {
                    return Ok(None);
                };
                let previous = index.fingerprint(&path);
                Ok(Some((doc, path, previous)))
            },
        )?;
        let Some((doc, path, previous)) = prepared else {
            continue;
        };
        if doc.properties.contains_key(&relation_key) {
            continue;
        }
        let value = if plan.relation.multi {
            CoreValue::List(link.targets.iter().map(Uuid::to_string).collect())
        } else {
            CoreValue::Text(link.targets[0].to_string())
        };
        let mut next = doc;
        next.properties.insert(relation_key.clone(), value);
        next.rev += 1;
        next.updated_at = now;
        next.updated_by = caller.user.id;
        handle.with_index(|index| {
            validate::validate_object(&index.schema(), &next).map_err(ApiError::validation_all)
        })?;
        handle.store.save_object(&path, &next, previous)?;
        handle.store.append_revision(
            next.id,
            &Revision {
                rev: next.rev,
                at: now,
                by: caller.user.id,
                action: RevisionAction::Update,
                snapshot: Snapshot {
                    title: next.title.clone(),
                    icon: next.icon.clone(),
                    cover: next.cover.clone(),
                    cover_position: next.cover_position.clone(),
                    properties: next.properties.clone(),
                },
                body: None,
            },
        )?;
        handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;
        handle.broadcast(
            "object.updated",
            json!({ "id": next.id, "type": next.type_key, "rev": next.rev }),
        );
        written += 1;
    }

    let filters_dropped: usize = plan.views.iter().map(|view| view.filters_dropped).sum();
    tracing::info!(
        space = %handle.meta().id,
        user = %caller.user.id,
        property = %relation_key,
        written,
        "promotion links written"
    );
    Ok(Json(json!({
        "property": relation_key,
        "created": linked.create_property,
        "links": written,
        "filters_dropped": filters_dropped,
        "views": plan.views,
    })))
}

/// Removes the old column and restores the temporary relation's key to the
/// source spelling, reusing the store's remove and rename paths so history keeps
/// every dropped value.
///
/// A finish whose relation already carries the source key is a no-op.
fn run_finish(
    handle: &Arc<SpaceHandle>,
    caller: &Caller,
    source_key: &str,
    target_key: &str,
    relation_key: &str,
    multi: bool,
) -> Result<Json<Value>, ApiError> {
    let (old, temporary, target_exists) = handle.with_index(|index| {
        (
            index
                .properties()
                .find(|def| def.key == source_key)
                .cloned(),
            index
                .properties()
                .find(|def| def.key == relation_key)
                .cloned(),
            index.type_def(target_key).is_some(),
        )
    });
    if !target_exists {
        return Err(ApiError::not_found(format!("type {target_key}")));
    }
    match (old.as_ref(), temporary.as_ref()) {
        (_, Some(temporary)) => {
            if temporary.format != PropertyFormat::Relation
                || temporary.target_type.as_deref() != Some(target_key)
                || temporary.multi != multi
            {
                return Err(ApiError::conflict(
                    format!("{relation_key} does not point at the created type"),
                    json!({ "reason": "relation mismatch", "key": relation_key }),
                ));
            }
        }
        (Some(old), None) if already_finished(old, target_key, multi) => {
            return Ok(Json(json!({ "key": source_key, "finished": false })));
        }
        (Some(_), None) => {
            return Err(ApiError::conflict(
                format!("{relation_key} does not exist; the links stage has not run"),
                json!({ "reason": "missing temporary relation" }),
            ));
        }
        (None, None) => {
            return Err(ApiError::conflict(
                format!("neither {source_key} nor {relation_key} exists"),
                json!({ "reason": "nothing to finish" }),
            ));
        }
    }

    let now = OffsetDateTime::now_utc();
    if old.is_some() {
        handle
            .store
            .remove_property_key(source_key, now, caller.user.id)?;
    }
    if temporary.is_some() {
        handle
            .store
            .rename_property_key(relation_key, source_key, now, caller.user.id)?;
    }
    rebuild(handle)?;
    handle.broadcast("property.updated", json!({ "key": source_key }));
    tracing::info!(
        space = %handle.meta().id,
        user = %caller.user.id,
        from = %relation_key,
        to = %source_key,
        "promotion finished"
    );
    Ok(Json(json!({ "key": source_key, "finished": true })))
}

/// Whether a definition at the source key is already the finished relation.
fn already_finished(def: &thing_core::model::PropertyDef, target_key: &str, multi: bool) -> bool {
    def.format == PropertyFormat::Relation
        && def.target_type.as_deref() == Some(target_key)
        && def.multi == multi
}

/// Rebuilds the index after a space-wide rewrite touched several files.
fn rebuild(handle: &Arc<SpaceHandle>) -> Result<(), ApiError> {
    let outcome = handle.with_index_mut(|index| -> Result<(), CoreError> {
        *index = SpaceIndex::rebuild_from_disk(&handle.store)?;
        Ok(())
    });
    outcome.map_err(ApiError::from)
}
