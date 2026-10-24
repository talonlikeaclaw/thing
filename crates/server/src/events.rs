//! One broadcast channel per space, and the WebSocket that carries it.
//!
//! An event names an identity and its revision, never a payload to merge: the
//! client invalidates what it holds and refetches, so a missed or duplicated
//! frame cannot leave it showing different data from the files.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::header::{HOST, ORIGIN};
use axum::response::Response;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use thing_core::model::Role;
use time::OffsetDateTime;
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::Instant;
use uuid::Uuid;

use crate::auth::Caller;
use crate::routes::{space_for, uuid_param};
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// Events one space may have in flight before a slow listener is dropped.
pub const EVENT_CAPACITY: usize = 256;
/// Authed sockets send nothing; this bounds what a broken client can push.
const MAX_MESSAGE_SIZE: usize = 4 * 1024;
/// Same bound for one frame, so a huge frame is refused while reading it.
const MAX_FRAME_SIZE: usize = 4 * 1024;
/// How often a live socket re-checks its session and membership.
const REVALIDATE: Duration = Duration::from_secs(30);

/// One change in a space, as every WebSocket client receives it.
#[derive(Debug, Clone, Serialize)]
pub struct SpaceEvent {
    pub event: &'static str,
    pub space: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub payload: Value,
}

/// A new channel for one space's events.
pub fn channel() -> broadcast::Sender<SpaceEvent> {
    broadcast::channel(EVENT_CAPACITY).0
}

impl SpaceHandle {
    /// Sends one event to every listener of this space.
    ///
    /// Nobody listening is not an error: the event is for live clients only.
    pub fn broadcast(&self, event: &'static str, payload: Value) {
        let event = SpaceEvent {
            event,
            space: self.id(),
            at: OffsetDateTime::now_utc(),
            payload,
        };
        let _ = self.events.send(event);
    }
}

pub fn routes() -> Router<SharedState> {
    Router::new().route("/api/spaces/{space}/events", get(upgrade))
}

/// `GET /api/spaces/{space}/events` [viewer] — a WebSocket upgrade.
///
/// The session is the cookie or `?session=`, read by [`Caller`] before the
/// upgrade, so an unauthenticated request never becomes a socket.
async fn upgrade(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, crate::error::ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    if !origin_allowed(&headers, &state.config.public_url) {
        return Err(crate::error::ApiError::forbidden(
            "this origin may not open an event stream",
        ));
    }
    // Subscribed before the handshake completes, so no event between the
    // authorization check and the first frame can be missed.
    let events = handle.events.subscribe();
    let user = caller.user.id;
    let session_hash = caller.session;
    let ws = ws
        .max_message_size(MAX_MESSAGE_SIZE)
        .max_frame_size(MAX_FRAME_SIZE);
    Ok(ws.on_upgrade(move |socket| session(socket, state, handle, user, session_hash, events)))
}

/// Whether the handshake's `Origin`, when a browser sends one, is this app's.
///
/// Non-browser clients send no `Origin`; `SameSite=Lax` alone still lets a
/// same-site sibling page open a socket, so the header is checked when present.
///
/// Two authorities are accepted: the configured public URL, and the request's
/// own `Host`. The second is what makes same-origin development work through
/// port forwarders, LAN addresses and `127.0.0.1` versus `localhost`: the
/// browser sends the origin it actually loaded, and a cross-site page cannot
/// forge `Host`, so a foreign origin still fails.
fn origin_allowed(headers: &HeaderMap, public_url: &str) -> bool {
    let Some(origin) = headers.get(ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let origin = origin.trim_end_matches('/');
    if origin.eq_ignore_ascii_case(public_url.trim_end_matches('/')) {
        return true;
    }
    // A sandboxed frame's `null` origin, or anything without a real scheme,
    // is never this app.
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let Some(host) = headers.get(HOST).and_then(|host| host.to_str().ok()) else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    !authority.is_empty() && authority.eq_ignore_ascii_case(host)
}

/// The socket's whole life: `hello`, then every event until either side leaves.
async fn session(
    socket: WebSocket,
    state: SharedState,
    handle: Arc<SpaceHandle>,
    user: Uuid,
    session: String,
    mut events: broadcast::Receiver<SpaceEvent>,
) {
    let (mut outgoing, mut incoming) = socket.split();
    let hello = json!({ "event": "hello", "space": handle.id() }).to_string();
    if outgoing.send(Message::Text(hello.into())).await.is_err() {
        return;
    }
    let user_text = user.to_string();
    let mut checked = Instant::now();

    loop {
        tokio::select! {
            message = incoming.next() => match message {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                // The protocol is server-to-client; any data frame ends it.
                Some(Ok(Message::Text(_) | Message::Binary(_))) => return,
                Some(Ok(_)) => {}
            },
            event = events.recv() => match event {
                Ok(event) => {
                    let Ok(text) = serde_json::to_string(&event) else {
                        tracing::error!(space = %handle.id(), "an event would not serialize");
                        continue;
                    };
                    if outgoing.send(Message::Text(text.into())).await.is_err() {
                        return;
                    }
                    // Revocation is immediate when the event names it, and at
                    // most one revalidation window late for a session that was
                    // ended without an event (sign-out, expiry).
                    if event.event == "space.deleted"
                        || (event.event == "member.removed"
                            && event.payload.get("user").and_then(Value::as_str)
                                == Some(user_text.as_str()))
                    {
                        return;
                    }
                    if checked.elapsed() >= REVALIDATE {
                        checked = Instant::now();
                        let live = state
                            .accounts
                            .user_for_session(&session, OffsetDateTime::now_utc())
                            .ok()
                            .flatten()
                            .is_some();
                        let member = handle
                            .with_index(|index| index.meta().role_of(user).is_some());
                        if !live || !member {
                            return;
                        }
                    }
                }
                // A listener too far behind gets a dropped socket instead of a
                // gap: reconnecting makes the client invalidate the whole space.
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(space = %handle.id(), skipped, "event listener lagged; closing");
                    return;
                }
                Err(RecvError::Closed) => return,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(origin: Option<&'static str>, host: Option<&'static str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(origin) = origin {
            headers.insert(ORIGIN, HeaderValue::from_static(origin));
        }
        if let Some(host) = host {
            headers.insert(HOST, HeaderValue::from_static(host));
        }
        headers
    }

    const PUBLIC: &str = "http://localhost:5173";

    #[test]
    fn a_client_without_origin_is_allowed() {
        assert!(origin_allowed(
            &headers(None, Some("localhost:5173")),
            PUBLIC
        ));
    }

    #[test]
    fn the_configured_public_url_is_allowed() {
        assert!(origin_allowed(
            &headers(Some("http://localhost:5173"), Some("proxy.internal:8080")),
            PUBLIC
        ));
    }

    #[test]
    fn a_same_host_origin_is_allowed_even_on_another_port_or_name() {
        for (origin, host) in [
            ("http://127.0.0.1:5173", "127.0.0.1:5173"),
            ("http://localhost:5174", "localhost:5174"),
            ("https://thing.example.com", "thing.example.com"),
        ] {
            assert!(
                origin_allowed(&headers(Some(origin), Some(host)), PUBLIC),
                "{origin} on {host} should be allowed"
            );
        }
    }

    #[test]
    fn a_foreign_origin_is_refused() {
        for origin in [
            "http://127.0.0.1:5173", // right host, but the Host header differs
            "https://evil.example",
            "null",
            "file://localhost",
        ] {
            assert!(
                !origin_allowed(&headers(Some(origin), Some("localhost:5173")), PUBLIC),
                "{origin} should be refused"
            );
        }
    }

    #[test]
    fn a_missing_host_falls_back_to_the_public_url_only() {
        assert!(!origin_allowed(
            &headers(Some("http://localhost:5174"), None),
            PUBLIC
        ));
        assert!(origin_allowed(
            &headers(Some("http://localhost:5173"), None),
            PUBLIC
        ));
    }
}
