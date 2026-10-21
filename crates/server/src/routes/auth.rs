//! Sign-in routes: register, login, logout, me.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use super::spaces::spaces_of;
use super::{ApiJson, cleared_with_cookie, json_with_cookie};
use crate::accounts::{Accounts, Invite, User};
use crate::auth::{
    Caller, MIN_PASSWORD_LEN, SESSION_LIFETIME, cleared_cookie, hash_password, mint_token,
    session_cookie, token_hash, verify_password,
};
use crate::error::ApiError;
use crate::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RegisterRequest {
    email: String,
    password: String,
    name: String,
    /// Required unless this is the install's first account.
    #[serde(default)]
    invite: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Serialize)]
pub struct UserView {
    pub id: Uuid,
    pub email: String,
    pub name: String,
}

impl From<&User> for UserView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            email: user.email.clone(),
            name: user.name.clone(),
        }
    }
}

/// `POST /api/auth/register` — the first account needs no invite; every later
/// one redeems a live invite and joins that invite's space at its role.
async fn register(
    State(state): State<SharedState>,
    ApiJson(body): ApiJson<RegisterRequest>,
) -> Result<Response, ApiError> {
    let email = clean_email(&body.email)?;
    let name = clean_name(&body.name)?;
    let password_chars = body.password.chars().count();
    if password_chars < MIN_PASSWORD_LEN {
        return Err(ApiError::validation(
            "password",
            format!("use at least {MIN_PASSWORD_LEN} characters"),
        ));
    }

    // The first-account gate and an invite's single use are read-then-write;
    // one registration at a time keeps two requests from both passing it.
    let _registration = state.registration.lock().await;

    let now = OffsetDateTime::now_utc();
    let invite = if state.accounts.user_count()? == 0 {
        None
    } else {
        Some(live_invite(&state.accounts, body.invite.as_deref(), now)?)
    };

    // Hash before writing: this is the slow step, and a bad invite is refused
    // above without paying for it. Argon2 is CPU- and memory-heavy, so it runs
    // off the async workers and behind a small concurrency bound.
    let password = body.password;
    let hash = {
        let _hashing = state
            .hashing
            .acquire()
            .await
            .expect("the hashing semaphore is never closed");
        tokio::task::spawn_blocking(move || hash_password(&password))
            .await
            .map_err(|err| ApiError::internal(format!("hashing the password failed: {err}")))?
            .map_err(|err| ApiError::internal(format!("hashing the password failed: {err}")))?
    };
    let user = state.accounts.create_user(&email, &name, &hash, now)?;

    if let Some(invite) = invite {
        let handle = state
            .registry
            .get(invite.space_id)
            .ok_or_else(|| ApiError::not_found(format!("space {}", invite.space_id)))?;
        let _guard = handle.write.lock().await;
        handle.update_meta_locked(|meta| meta.set_member(user.id, invite.role))?;
        state
            .accounts
            .mark_invite_used(&invite.code, user.id, now)?;
        handle.broadcast(
            "member.added",
            serde_json::json!({ "user": user.id, "role": invite.role }),
        );
        tracing::info!(
            space = %invite.space_id,
            user = %user.id,
            role = %invite.role,
            "member joined"
        );
    }

    let token = start_session(&state, user.id, now)?;
    let body = serde_json::json!({
        "user": UserView::from(&user),
        "spaces": spaces_of(&state, user.id),
    });
    Ok(json_with_cookie(
        &session_cookie(&token, state.config.cookie_secure),
        StatusCode::CREATED,
        body,
    ))
}

/// `POST /api/auth/login`
async fn login(
    State(state): State<SharedState>,
    ApiJson(body): ApiJson<LoginRequest>,
) -> Result<Response, ApiError> {
    let refusal = || ApiError::unauthenticated("that email and password do not match an account");
    let email = clean_email(&body.email)?;
    let Some((user, stored)) = state.accounts.credentials(&email)? else {
        return Err(refusal());
    };
    let password = body.password;
    let valid = {
        let _hashing = state
            .hashing
            .acquire()
            .await
            .expect("the hashing semaphore is never closed");
        tokio::task::spawn_blocking(move || verify_password(&password, &stored))
            .await
            .map_err(|err| ApiError::internal(format!("verifying the password failed: {err}")))?
    };
    if !valid {
        return Err(refusal());
    }

    let now = OffsetDateTime::now_utc();
    let token = start_session(&state, user.id, now)?;
    let body = serde_json::json!({
        "user": UserView::from(&user),
        "spaces": spaces_of(&state, user.id),
    });
    Ok(json_with_cookie(
        &session_cookie(&token, state.config.cookie_secure),
        StatusCode::OK,
        body,
    ))
}

/// `POST /api/auth/logout` — forgets this session and clears the cookie.
async fn logout(State(state): State<SharedState>, caller: Caller) -> Result<Response, ApiError> {
    state.accounts.delete_session(&caller.session)?;
    Ok(cleared_with_cookie(
        &cleared_cookie(state.config.cookie_secure),
        StatusCode::NO_CONTENT,
    ))
}

/// `GET /api/auth/me`
async fn me(caller: Caller) -> Json<UserView> {
    Json(UserView::from(&caller.user))
}

/// Records a session and returns the token, which only the client ever sees.
fn start_session(state: &SharedState, user: Uuid, now: OffsetDateTime) -> Result<String, ApiError> {
    let token = mint_token();
    state
        .accounts
        .create_session(&token_hash(&token), user, now, now + SESSION_LIFETIME)?;
    Ok(token)
}

/// The invite this registration redeems, or the reason it cannot.
fn live_invite(
    accounts: &Accounts,
    code: Option<&str>,
    now: OffsetDateTime,
) -> Result<Invite, ApiError> {
    let code = code
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .ok_or_else(|| {
            ApiError::validation(
                "invite",
                "this install is already set up; an invite is required",
            )
        })?;
    let invite = accounts
        .invite(code)?
        .ok_or_else(|| ApiError::validation("invite", "no such invite"))?;
    if invite.used_by.is_some() {
        return Err(ApiError::validation(
            "invite",
            "this invite has already been used",
        ));
    }
    if invite.expires_at.is_some_and(|expires| expires <= now) {
        return Err(ApiError::validation("invite", "this invite has expired"));
    }
    Ok(invite)
}

/// One spelling for an address: trimmed, lowercased, and with an `@` in it.
fn clean_email(email: &str) -> Result<String, ApiError> {
    let email = email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(ApiError::validation(
            "email",
            "use an address like you@example.com",
        ));
    }
    Ok(email)
}

fn clean_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::validation("name", "a name is required"));
    }
    Ok(name.to_owned())
}
