//! Column promotion: plan a text, select or multi-select column's move to a
//! relation, then create the target type and its records.
//!
//! The plan stage is a read. The targets stage writes the new type and one
//! record per distinct value, skipping both when they already exist. Later
//! stages that write the temporary relation and restore the key extend this
//! route; the plan names them too, so the preview does not change mid-run.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use thing_core::model::{ObjectDoc, Revision, RevisionAction, Role, Snapshot};
use thing_core::promote::{self, PromoteOptions, PromotePlan};
use thing_core::slug::key_from_name;
use thing_core::store::{SpaceStore, type_path};
use thing_core::validate::{self, MAX_TITLE_LEN};
use time::OffsetDateTime;

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

    let resume_key = match body.stage {
        Stage::Targets => body.target_type.clone().or_else(|| {
            // A retry after the type was created must resume rather than
            // report the key as taken; the derived key is the type it made.
            let derived = key_from_name(&options.target_name);
            handle
                .with_index(|index| index.type_def(&derived).is_some())
                .then_some(derived)
        }),
        Stage::Plan => body.target_type.clone(),
    };
    let plan = handle.with_index(|index| {
        promote::plan(index, &key, &body.property, &options, resume_key.as_deref())
    });

    match body.stage {
        Stage::Plan => Ok(Json(json!(plan))),
        Stage::Targets => run_targets(&handle, &caller, plan),
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
