//! One broadcast channel per space, and the WebSocket that carries it.
//!
//! An event names an identity and its revision, never a payload to merge: the
//! client invalidates what it holds and refetches, so a missed or duplicated
//! frame cannot leave it showing different data from the files.

use std::sync::Arc;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use thing_core::model::Role;
use time::OffsetDateTime;
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::auth::Caller;
use crate::routes::{space_for, uuid_param};
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// Events one space may have in flight before a slow listener is dropped.
pub const EVENT_CAPACITY: usize = 256;

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
    ws: WebSocketUpgrade,
) -> Result<Response, crate::error::ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;
    // Subscribed before the handshake completes, so no event between the
    // authorization check and the first frame can be missed.
    let events = handle.events.subscribe();
    Ok(ws.on_upgrade(move |socket| session(socket, handle, events)))
}

/// The socket's whole life: `hello`, then every event until either side leaves.
async fn session(
    socket: WebSocket,
    handle: Arc<SpaceHandle>,
    mut events: broadcast::Receiver<SpaceEvent>,
) {
    let (mut outgoing, mut incoming) = socket.split();
    let hello = json!({ "event": "hello", "space": handle.id() }).to_string();
    if outgoing.send(Message::Text(hello.into())).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            message = incoming.next() => match message {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
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
