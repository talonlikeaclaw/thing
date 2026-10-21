//! Space routes: the space itself, its invites and its members.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::model::{Member, Role, SpaceMeta};
use thing_core::schedule;
use thing_core::store::SpaceStore;
use thing_core::store::fs::FsSpaceStore;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{ApiJson, clean_icon, clean_text, double_option, space_for, uuid_param};
use crate::accounts::{Invite, User};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// Longest space name; the same order of magnitude as a title.
const MAX_SPACE_NAME_LEN: usize = 200;
/// A space with no timezone is UTC until someone says otherwise.
const DEFAULT_TIMEZONE: &str = "UTC";

/// Trims a zone, maps an empty one to UTC, and refuses a name jiff cannot
/// resolve. Due and overdue are calendar days in this zone.
fn clean_timezone(zone: &str) -> Result<String, ApiError> {
    let zone = zone.trim();
    let zone = if zone.is_empty() {
        DEFAULT_TIMEZONE
    } else {
        zone
    };
    schedule::resolve_timezone(zone).map_err(ApiError::from)?;
    Ok(zone.to_owned())
}

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces", get(list).post(create))
        .route(
            "/api/spaces/{space}",
            get(detail).patch(update).delete(remove),
        )
        .route(
            "/api/spaces/{space}/invites",
            get(list_invites).post(create_invite),
        )
        .route("/api/spaces/{space}/invites/{code}", delete(revoke_invite))
        .route("/api/spaces/{space}/health", get(health))
        .route(
            "/api/spaces/{space}/members/{user}",
            post(set_member).delete(remove_member),
        )
}

#[derive(Debug, Serialize)]
pub struct SpaceSummary {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub role: Role,
    pub member_count: usize,
    pub type_count: usize,
}

impl SpaceSummary {
    /// The space as one user sees it, or `None` when they are not a member.
    pub fn of(handle: &SpaceHandle, user: Uuid) -> Option<Self> {
        let meta = handle.meta();
        let role = meta.role_of(user)?;
        Some(Self {
            id: meta.id,
            name: meta.name,
            icon: meta.icon,
            role,
            member_count: meta.members.len(),
            type_count: handle.type_count(),
        })
    }
}

#[derive(Debug, Serialize)]
pub struct MemberView {
    pub user: Uuid,
    pub name: String,
    pub email: Option<String>,
    pub role: Role,
}

#[derive(Debug, Serialize)]
pub struct SpaceDetail {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub timezone: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub role: Role,
    pub members: Vec<MemberView>,
    pub type_count: usize,
}

#[derive(Debug, Serialize)]
pub struct InviteView {
    pub code: String,
    pub role: Role,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub used_at: Option<OffsetDateTime>,
}

/// The spaces this user is a member of, in id order.
pub fn spaces_of(state: &SharedState, user: Uuid) -> Vec<SpaceSummary> {
    state
        .registry
        .spaces()
        .iter()
        .filter_map(|handle| SpaceSummary::of(handle, user))
        .collect()
}

/// `GET /api/spaces`
async fn list(State(state): State<SharedState>, caller: Caller) -> Json<Vec<SpaceSummary>> {
    Json(spaces_of(&state, caller.user.id))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSpaceRequest {
    name: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    timezone: Option<String>,
}

/// `POST /api/spaces` — the creator is the first owner.
async fn create(
    State(state): State<SharedState>,
    caller: Caller,
    ApiJson(body): ApiJson<CreateSpaceRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let meta = SpaceMeta {
        id: Uuid::now_v7(),
        name: clean_name(&body.name)?,
        icon: clean_icon(body.icon),
        timezone: clean_timezone(body.timezone.as_deref().unwrap_or(DEFAULT_TIMEZONE))?,
        created_at: OffsetDateTime::now_utc(),
        members: vec![Member {
            user: caller.user.id,
            role: Role::Owner,
        }],
    };

    let dir = state.registry.spaces_dir().join(meta.id.to_string());
    FsSpaceStore::create(&dir, &meta)?;
    let handle = state.registry.load(&dir)?;
    tracing::info!(space = %meta.id, user = %caller.user.id, "space created");

    let body = detail_of(&state, &handle, caller.user.id)?;
    Ok((StatusCode::CREATED, Json(body)))
}

/// `GET /api/spaces/{space}/health` [viewer]
///
/// What is wrong with the files: a file that will not parse, a relation whose
/// target is gone, or two objects whose titles collide on one file name.
async fn health(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    let problems = handle.with_index(|index| index.problems());
    Ok(Json(super::problems_json(&problems)))
}

/// `GET /api/spaces/{space}`
async fn detail(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    Ok(Json(detail_of(&state, &handle, caller.user.id)?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchSpaceRequest {
    #[serde(default)]
    name: Option<String>,
    /// `null` clears the icon; leaving the field out leaves it alone.
    #[serde(default, deserialize_with = "double_option")]
    icon: Option<Option<String>>,
    #[serde(default)]
    timezone: Option<String>,
}

/// `PATCH /api/spaces/{space}` [owner]
async fn update(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<PatchSpaceRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Owner)?;
    if body.name.is_none() && body.icon.is_none() && body.timezone.is_none() {
        return Err(ApiError::validation("body", "nothing to change"));
    }
    let name = body.name.as_deref().map(clean_name).transpose()?;
    let timezone = body.timezone.as_deref().map(clean_timezone).transpose()?;

    let _guard = handle.write.lock().await;
    handle.update_meta_locked(|meta| {
        if let Some(name) = name {
            meta.name = name;
        }
        if let Some(icon) = body.icon {
            meta.icon = clean_icon(icon);
        }
        if let Some(timezone) = &timezone {
            meta.timezone = timezone.clone();
        }
    })?;
    handle.broadcast("space.updated", json!({}));
    tracing::info!(space = %space, user = %caller.user.id, "space updated");
    Ok(Json(detail_of(&state, &handle, caller.user.id)?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfirmRequest {
    confirm: String,
}

/// `DELETE /api/spaces/{space}` [owner]
///
/// `confirm` must repeat the space's name: this is the one operation in M1 that
/// destroys files rather than moving them.
async fn remove(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<ConfirmRequest>,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Owner)?;
    let name = handle.meta().name;
    if body.confirm.trim() != name {
        return Err(ApiError::validation(
            "confirm",
            format!("type the space's name ({name}) to delete it"),
        ));
    }

    // Hold the write lock so no write is in flight while the files go.
    let _guard = handle.write.lock().await;
    let dir = handle.store.space_dir().to_owned();
    std::fs::remove_dir_all(&dir).map_err(|err| ApiError::from(CoreError::Io(err)))?;
    handle.broadcast("space.deleted", json!({}));
    state.registry.remove(space);
    tracing::info!(space = %space, user = %caller.user.id, path = %dir.display(), "space deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateInviteRequest {
    role: Role,
}

/// `POST /api/spaces/{space}/invites` [owner]
///
/// Invites do not expire in M1: the table carries an expiry, the API does not
/// set one.
async fn create_invite(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    ApiJson(body): ApiJson<CreateInviteRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let space = uuid_param(&space, "space")?;
    space_for(&state, &caller, space, Role::Owner)?;

    let code = Uuid::new_v4().simple().to_string();
    state.accounts.create_invite(
        &code,
        space,
        body.role,
        caller.user.id,
        OffsetDateTime::now_utc(),
        None,
    )?;
    tracing::info!(space = %space, user = %caller.user.id, role = %body.role, "invite created");

    let url = format!(
        "{}/join/{code}",
        state.config.public_url.trim_end_matches('/')
    );
    let body = json!({ "code": code, "url": url, "expires_at": Value::Null });
    Ok((StatusCode::CREATED, Json(body)))
}

/// `GET /api/spaces/{space}/invites` [owner]
async fn list_invites(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<Vec<InviteView>>, ApiError> {
    let space = uuid_param(&space, "space")?;
    space_for(&state, &caller, space, Role::Owner)?;
    let invites = state
        .accounts
        .invites_of_space(space)?
        .into_iter()
        .map(invite_view)
        .collect();
    Ok(Json(invites))
}

/// `DELETE /api/spaces/{space}/invites/{code}` [owner]
async fn revoke_invite(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, code)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    space_for(&state, &caller, space, Role::Owner)?;
    if !state.accounts.delete_invite(space, &code)? {
        return Err(ApiError::not_found(format!("invite {code}")));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetMemberRequest {
    role: Role,
}

/// `POST /api/spaces/{space}/members/{user}` [owner] — adds a member, or changes
/// the role of one already there.
async fn set_member(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, user)): Path<(String, String)>,
    ApiJson(body): ApiJson<SetMemberRequest>,
) -> Result<Json<Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let user = uuid_param(&user, "user")?;
    let handle = space_for(&state, &caller, space, Role::Owner)?;
    if state.accounts.user_by_id(user)?.is_none() {
        return Err(ApiError::not_found(format!("user {user}")));
    }

    let _guard = handle.write.lock().await;
    let existing = handle.meta().role_of(user);
    if handle.meta().is_last_owner(user) && body.role != Role::Owner {
        return Err(ApiError::validation(
            "role",
            "the last owner cannot step down; make someone else an owner first",
        ));
    }
    handle.update_meta_locked(|meta| meta.set_member(user, body.role))?;
    handle.broadcast(
        if existing.is_some() {
            "member.updated"
        } else {
            "member.added"
        },
        json!({ "user": user, "role": body.role }),
    );
    tracing::info!(space = %space, user = %user, role = %body.role, "member set");
    Ok(Json(detail_of(&state, &handle, caller.user.id)?))
}

/// `DELETE /api/spaces/{space}/members/{user}` [owner]
async fn remove_member(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, user)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let space = uuid_param(&space, "space")?;
    let user = uuid_param(&user, "user")?;
    let handle = space_for(&state, &caller, space, Role::Owner)?;
    let _guard = handle.write.lock().await;
    if handle.meta().is_last_owner(user) {
        return Err(ApiError::validation(
            "user",
            "the last owner cannot be removed; make someone else an owner first",
        ));
    }
    if handle.meta().role_of(user).is_none() {
        return Err(ApiError::not_found(format!("member {user}")));
    }

    handle.update_meta_locked(|meta| {
        meta.remove_member(user);
    })?;
    handle.broadcast("member.removed", json!({ "user": user }));
    tracing::info!(space = %space, user = %user, "member removed");
    Ok(StatusCode::NO_CONTENT)
}

/// One space's metadata with every member's account filled in.
///
/// A member this install has no account for keeps their row and is named
/// `Unknown member <uuid>`, so a space copied from another install still opens.
fn detail_of(
    state: &SharedState,
    handle: &Arc<SpaceHandle>,
    user: Uuid,
) -> Result<Value, ApiError> {
    let meta = handle.meta();
    let members = meta
        .members
        .iter()
        .map(|member| member_view(state, member))
        .collect::<Result<Vec<_>, _>>()?;
    let role = meta
        .role_of(user)
        .expect("the caller passed the role guard");
    let detail = SpaceDetail {
        id: meta.id,
        name: meta.name,
        icon: meta.icon,
        timezone: meta.timezone,
        created_at: meta.created_at,
        role,
        members,
        type_count: handle.type_count(),
    };
    Ok(json!(detail))
}

fn member_view(state: &SharedState, member: &Member) -> Result<MemberView, ApiError> {
    let account: Option<User> = state.accounts.user_by_id(member.user)?;
    Ok(MemberView {
        user: member.user,
        name: account
            .as_ref()
            .map(|user| user.name.clone())
            .unwrap_or_else(|| format!("Unknown member {}", member.user)),
        email: account.map(|user| user.email),
        role: member.role,
    })
}

fn invite_view(invite: Invite) -> InviteView {
    InviteView {
        code: invite.code,
        role: invite.role,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
        used_at: invite.used_at,
    }
}

/// A space name is a display string like any other, one limit long.
fn clean_name(name: &str) -> Result<String, ApiError> {
    clean_text("name", name, MAX_SPACE_NAME_LEN)
}

#[cfg(test)]
mod tests {
    use thing_core::index::Problems;

    use super::*;

    #[test]
    fn a_zone_is_trimmed_and_an_empty_one_means_utc() {
        assert_eq!(clean_timezone("  ").expect("empty is UTC"), "UTC");
        assert_eq!(
            clean_timezone(" Europe/Berlin ").expect("known zone"),
            "Europe/Berlin"
        );
    }

    #[test]
    fn an_unknown_zone_is_a_validation_failure() {
        let err = clean_timezone("Mars/Olympus_Mons").expect_err("unknown zone");
        assert_eq!(err.message(), "unknown time zone Mars/Olympus_Mons");
    }

    #[test]
    fn health_json_carries_the_schedule_problems() {
        let problems = Problems {
            invalid_timezone: Some("Mars/Olympus_Mons".to_owned()),
            schedule_key_conflicts: vec!["due_date".to_owned()],
            ..Problems::default()
        };
        let body = super::super::problems_json(&problems);
        assert_eq!(body["invalid_timezone"], "Mars/Olympus_Mons");
        assert_eq!(body["schedule_key_conflicts"], json!(["due_date"]));
    }
}
