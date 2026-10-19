//! Passwords, session tokens, and the cookie that carries one.
//!
//! One spelling for each: argon2 with default parameters for passwords,
//! `sha256(token)` in the database, and `thing_session` as the only cookie.

use std::time::Duration;

use argon2::password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash};
use argon2::{Argon2, password_hash};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::accounts::User;
use crate::error::ApiError;
use crate::state::SharedState;

/// The session cookie's name.
pub const SESSION_COOKIE: &str = "thing_session";
/// How long a session lives.
pub const SESSION_LIFETIME: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// The same lifetime, as the cookie's `Max-Age`.
pub const SESSION_MAX_AGE: i64 = 30 * 24 * 60 * 60;
/// Shortest password the API accepts.
pub const MIN_PASSWORD_LEN: usize = 10;

/// Hashes a password with argon2's default parameters and a random salt.
pub fn hash_password(password: &str) -> Result<String, password_hash::Error> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
}

/// Whether the password matches the stored hash; never says why it did not.
pub fn verify_password(password: &str, stored: &str) -> bool {
    let Ok(hash) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

/// A new session token: 64 hex characters from two UUIDv4s.
pub fn mint_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// What the database stores for a token.
pub fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The `Set-Cookie` value that signs a browser in.
pub fn session_cookie(token: &str, secure: bool) -> String {
    cookie(token, SESSION_MAX_AGE, secure)
}

/// The `Set-Cookie` value that signs a browser out.
pub fn cleared_cookie(secure: bool) -> String {
    cookie("", 0, secure)
}

fn cookie(token: &str, max_age: i64, secure: bool) -> String {
    let secure = if secure { "; Secure" } else { "" };
    format!("{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}")
}

/// The session token on a request: the cookie, or `?session=` for non-browser
/// clients (the WebSocket and, later, API tokens).
pub fn session_token(parts: &Parts) -> Option<String> {
    cookie_value(parts, SESSION_COOKIE).or_else(|| query_value(parts, "session"))
}

fn cookie_value(parts: &Parts, name: &str) -> Option<String> {
    let header = parts
        .headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?;
    header
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty())
}

fn query_value(parts: &Parts, name: &str) -> Option<String> {
    let query = parts.uri.query()?;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty())
}

/// The signed-in user, resolved from the session cookie or `?session=`.
#[derive(Debug)]
pub struct Caller {
    pub user: User,
    /// The hash of the token this request presented, so a sign-out deletes
    /// exactly this session and no other.
    pub session: String,
}

impl FromRequestParts<SharedState> for Caller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &SharedState) -> Result<Self, ApiError> {
        let token =
            session_token(parts).ok_or_else(|| ApiError::unauthenticated("sign in to continue"))?;
        let session = token_hash(&token);
        let user = state
            .accounts
            .user_for_session(&session, OffsetDateTime::now_utc())?
            .ok_or_else(|| ApiError::unauthenticated("the session has ended; sign in again"))?;
        Ok(Self { user, session })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_verifies_against_its_own_hash_and_no_other() {
        let hash = hash_password("correct-horse-battery").expect("hashes");
        assert!(verify_password("correct-horse-battery", &hash));
        assert!(!verify_password("correct-horse-battery ", &hash));
        assert_ne!(
            hash, "correct-horse-battery",
            "the hash is not the password"
        );
        assert!(!verify_password("anything", "not-a-phc-string"));
    }

    #[test]
    fn the_same_password_hashes_differently_every_time() {
        let first = hash_password("correct-horse-battery").expect("hashes");
        let second = hash_password("correct-horse-battery").expect("hashes");
        assert_ne!(first, second, "a random salt per hash");
    }

    #[test]
    fn a_token_is_sixty_four_hex_characters_and_hashes_to_sixty_four() {
        let token = mint_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|ch| ch.is_ascii_hexdigit()));
        let hash = token_hash(&token);
        assert_eq!(hash.len(), 64);
        assert_ne!(hash, token);
        assert_ne!(mint_token(), token);
    }

    #[test]
    fn the_cookie_carries_the_flags_the_plan_fixes() {
        let cookie = session_cookie("abc", false);
        assert_eq!(
            cookie,
            "thing_session=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000"
        );
        assert!(session_cookie("abc", true).ends_with("; Max-Age=2592000; Secure"));
        assert!(cleared_cookie(false).ends_with("Max-Age=0"));
    }
}
