//! The HTTP surface: routing, the shared request plumbing, and the SPA fallback.
//!
//! Every error leaves as the same `{"error":{code,message,details}}` envelope,
//! including a malformed body or path parameter — which is why requests are
//! extracted through [`ApiJson`] and parsed with [`uuid_param`] rather than
//! axum's own rejections.

mod auth;
mod objects;
mod properties;
mod spaces;
mod types;
mod values;

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{FromRequest, FromRequestParts, Query, Request};
use axum::http::request::Parts;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::index::Problems;
use thing_core::model::Role;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::auth::Caller;
use crate::config::Config;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

pub fn router(config: &Config, state: SharedState) -> Router {
    // The API's catch-all is a route, not a fallback, so a mistyped `/api/...`
    // path is JSON here and never the SPA's `index.html`; the paths that exist
    // are registered above it and win over the catch-all.
    let app = Router::new()
        .route("/api/health", get(health))
        .merge(auth::routes())
        .merge(spaces::routes())
        .merge(types::routes())
        .merge(properties::routes())
        .merge(objects::routes())
        .merge(crate::events::routes())
        .route("/api", any(no_such_route))
        .route("/api/{*rest}", any(no_such_route));

    let index = config.static_dir.join("index.html");
    let app = if index.is_file() {
        // `fallback`, not `not_found_service`: a client-side route must answer
        // 200 with the app, not 404 with the app's bytes.
        let spa = ServeDir::new(&config.static_dir).fallback(ServeFile::new(index));
        app.fallback_service(spa)
    } else {
        tracing::warn!(
            dir = %config.static_dir.display(),
            "no SPA build found; serving the API only"
        );
        app.fallback(spa_missing)
    };
    app.layer(TraceLayer::new_for_http().make_span_with(trace_span))
        .with_state(state)
}

/// What one request's trace span records: never the query string, which can
/// carry a session token when a non-browser client uses `?session=`.
fn trace_span(request: &Request) -> tracing::Span {
    tracing::debug_span!(
        "request",
        method = %request.method(),
        path = %request.uri().path()
    )
}

/// `GET /api/health` — liveness, and the version the client is talking to.
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": thing_core::VERSION }))
}

/// Any other `/api` path is JSON, never the SPA's `index.html`.
async fn no_such_route(method: Method, uri: Uri) -> ApiError {
    ApiError::from(CoreError::NotFound(format!("{method} {uri}")))
}

/// A request for the SPA when nothing was built.
async fn spa_missing() -> (StatusCode, &'static str) {
    (
        StatusCode::NOT_FOUND,
        "no SPA build; run `npm run build` in web/",
    )
}

/// `Json`, but a body that will not deserialize is our error envelope.
pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        let Json(value) = Json::<T>::from_request(request, state)
            .await
            .map_err(|err| ApiError::validation("body", err.body_text()))?;
        Ok(Self(value))
    }
}

/// The query string, read by hand for two reasons: a bad parameter leaves as our
/// error envelope rather than axum's own rejection, and a parameter the route
/// does not know is refused by name instead of ignored.
pub struct ApiQuery(BTreeMap<String, String>);

impl ApiQuery {
    /// Reads `name`; absent or empty is `None`.
    pub fn raw(&mut self, name: &str) -> Option<String> {
        self.0.remove(name).filter(|value| !value.is_empty())
    }

    /// Reads `name` as `T`; unparseable is a `422` naming it.
    pub fn parse<T>(&mut self, name: &str) -> Result<Option<T>, ApiError>
    where
        T: std::str::FromStr,
        T::Err: std::fmt::Display,
    {
        let Some(raw) = self.raw(name) else {
            return Ok(None);
        };
        raw.parse::<T>()
            .map(Some)
            .map_err(|err| ApiError::validation(name, err.to_string()))
    }

    /// Refuses whatever the route did not read.
    pub fn finish(self) -> Result<(), ApiError> {
        match self.0.keys().next() {
            Some(unknown) => Err(ApiError::validation(
                unknown,
                "is not a parameter of this route",
            )),
            None => Ok(()),
        }
    }
}

impl<S> FromRequestParts<S> for ApiQuery
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        let Query(pairs) = Query::<BTreeMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|err| ApiError::validation("query", err.body_text()))?;
        Ok(Self(pairs))
    }
}

/// A path parameter that must be a UUID; anything else is a `422` naming it.
pub fn uuid_param(value: &str, field: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::validation(field, format!("{value} is not an id")))
}

/// Trims a display string and checks it is there and not too long.
pub fn clean_text(field: &str, value: &str, max: usize) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(ApiError::validation(
            field,
            format!("a {field} is required"),
        ));
    }
    if value.chars().count() > max {
        return Err(ApiError::validation(
            field,
            format!("keep {field} under {max} characters"),
        ));
    }
    Ok(value.to_owned())
}

/// An icon of nothing is no icon, so `""` and `"  "` both mean the key is absent.
pub fn clean_icon(icon: Option<String>) -> Option<String> {
    icon.map(|icon| icon.trim().to_owned())
        .filter(|icon| !icon.is_empty())
}

/// Tells `null` apart from a missing field, so `icon: null` clears the icon
/// while leaving the field out leaves it alone.
pub fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// The space the caller may act on at this role.
///
/// A space the caller is not a member of is `404`, never `403`, so the API does
/// not disclose which spaces exist.
pub fn space_for(
    state: &SharedState,
    caller: &Caller,
    space: Uuid,
    required: Role,
) -> Result<Arc<SpaceHandle>, ApiError> {
    let handle = state
        .registry
        .get(space)
        .ok_or_else(|| ApiError::not_found(format!("space {space}")))?;
    match handle.with_index(|index| index.meta().role_of(caller.user.id)) {
        Some(role) if role.allows(required) => Ok(handle),
        Some(role) => Err(ApiError::forbidden(format!(
            "this needs the {required} role; you are {role}"
        ))),
        None => Err(ApiError::not_found(format!("space {space}"))),
    }
}

/// What is wrong with a space's files, as the API and `reindex` report it.
pub fn problems_json(problems: &Problems) -> Value {
    json!({
        "unparseable": problems
            .unparseable
            .iter()
            .map(|file| json!({ "path": file.path, "message": file.message }))
            .collect::<Vec<_>>(),
        "dangling_relations": problems
            .dangling_relations
            .iter()
            .map(|relation| json!({
                "object": relation.object,
                "path": relation.path,
                "property": relation.property,
                "target": relation.target,
            }))
            .collect::<Vec<_>>(),
        "duplicate_slugs": problems
            .duplicate_slugs
            .iter()
            .map(|duplicate| json!({
                "type": duplicate.type_key,
                "slug": duplicate.slug,
                "objects": duplicate.objects,
            }))
            .collect::<Vec<_>>(),
    })
}

/// A JSON response carrying the cookie that starts a session.
pub fn json_with_cookie(cookie: &str, status: StatusCode, body: Value) -> Response {
    attach_cookie(cookie, (status, Json(body)).into_response())
}

/// A bodiless response carrying the cookie that clears a session.
pub fn cleared_with_cookie(cookie: &str, status: StatusCode) -> Response {
    attach_cookie(cookie, status.into_response())
}

fn attach_cookie(cookie: &str, mut response: Response) -> Response {
    match cookie.parse() {
        Ok(value) => {
            response.headers_mut().insert("set-cookie", value);
        }
        Err(err) => tracing::error!(%err, "the session cookie header was malformed"),
    }
    response
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tempfile::TempDir;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::*;
    use crate::accounts::Accounts;
    use crate::spaces::SpaceRegistry;
    use crate::state::{ACCOUNTS_FILE, AppState};

    const PASSWORD: &str = "correct-horse-battery";

    struct Server {
        _root: TempDir,
        router: Router,
        state: SharedState,
    }

    /// A server over a temporary data directory, with no SPA build.
    fn server() -> Server {
        let root = tempfile::tempdir().expect("a temporary data directory");
        let config = Config {
            data_dir: root.path().to_path_buf(),
            bind: "127.0.0.1:0".parse().expect("a socket address"),
            public_url: "http://localhost:5173".to_owned(),
            static_dir: root.path().join("no-spa"),
            cookie_secure: false,
        };
        let registry = Arc::new(SpaceRegistry::new(&config.data_dir));
        registry.prepare().expect("creates spaces/");
        let accounts = Accounts::open(&config.data_dir.join(ACCOUNTS_FILE))
            .expect("creates the accounts database");
        let state = AppState::new(config.clone(), registry, accounts);
        let router = router(&config, Arc::clone(&state));
        Server {
            _root: root,
            router,
            state,
        }
    }

    /// A reply, with the cookie the server set (if any).
    struct Reply {
        status: StatusCode,
        body: Value,
        cookie: Option<String>,
    }

    impl Reply {
        fn code(&self) -> &str {
            self.body["error"]["code"].as_str().unwrap_or_default()
        }

        fn field(&self) -> &str {
            self.body["error"]["details"]["field"]
                .as_str()
                .unwrap_or_default()
        }
    }

    impl Server {
        async fn call(
            &self,
            method: &str,
            uri: &str,
            body: Option<Value>,
            cookie: Option<&str>,
        ) -> Reply {
            let mut request = Request::builder().method(method).uri(uri);
            if let Some(cookie) = cookie {
                request = request.header("cookie", cookie);
            }
            let request = match body {
                Some(body) => request
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .expect("a request"),
                None => request.body(Body::empty()).expect("a request"),
            };
            let response = self
                .router
                .clone()
                .oneshot(request)
                .await
                .expect("the router answers");
            let status = response.status();
            let cookie = response
                .headers()
                .get("set-cookie")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.split(';').next().expect("a cookie pair").to_owned());
            let bytes = response
                .into_body()
                .collect()
                .await
                .expect("a body")
                .to_bytes();
            let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            Reply {
                status,
                body,
                cookie,
            }
        }

        /// Registers an account and returns its cookie.
        async fn register(&self, email: &str, invite: Option<&str>) -> Reply {
            let mut body = json!({ "email": email, "password": PASSWORD, "name": "Talon" });
            if let Some(invite) = invite {
                body["invite"] = json!(invite);
            }
            self.call("POST", "/api/auth/register", Some(body), None)
                .await
        }
    }

    /// Serves the router on a loopback port for tests that need a real socket.
    async fn serve(router: Router) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a listener");
        let addr = listener.local_addr().expect("a local address");
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("the test server runs");
        });
        addr
    }

    fn cookie_of(reply: &Reply) -> &str {
        reply.cookie.as_deref().expect("a session cookie")
    }

    #[test]
    fn cookie_less_and_unknown_sessions_are_unauthenticated() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let missing = server.call("GET", "/api/auth/me", None, None).await;
            assert_eq!(missing.status, StatusCode::UNAUTHORIZED);
            assert_eq!(missing.code(), "unauthenticated");

            let bogus = server
                .call("GET", "/api/auth/me", None, Some("thing_session=nope"))
                .await;
            assert_eq!(bogus.status, StatusCode::UNAUTHORIZED);
        });
    }

    #[test]
    fn the_first_account_needs_no_invite_and_the_second_one_does() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let first = server.register("first@example.com", None).await;
            assert_eq!(first.status, StatusCode::CREATED, "{:?}", first.body);
            assert_eq!(first.body["spaces"], json!([]));
            assert_eq!(first.body["user"]["email"], "first@example.com");

            let second = server.register("second@example.com", None).await;
            assert_eq!(second.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(second.code(), "validation_failed");
            assert_eq!(second.field(), "invite");

            // With a live invite in hand, a taken address is a conflict instead:
            // the invite gate is the first refusal, the unique email the second.
            let owner_cookie = cookie_of(&first).to_owned();
            let space = create_space(&server, &owner_cookie, "Garden").await;
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/invites"),
                    Some(json!({ "role": "editor" })),
                    Some(&owner_cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let again = server.register("first@example.com", Some(&code)).await;
            assert_eq!(again.status, StatusCode::CONFLICT);
            assert_eq!(again.code(), "conflict");
        });
    }

    #[test]
    fn an_invite_joins_the_space_at_its_role_and_is_used_once() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let space = server
                .call(
                    "POST",
                    "/api/spaces",
                    Some(json!({ "name": "Garden", "icon": "🪴" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(space.status, StatusCode::CREATED, "{:?}", space.body);
            assert_eq!(space.body["role"], "owner");
            let space_id = space.body["id"].as_str().expect("an id").to_owned();

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space_id}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(invite.status, StatusCode::CREATED, "{:?}", invite.body);
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            assert_eq!(
                invite.body["url"],
                format!("http://localhost:5173/join/{code}")
            );

            let joined = server.register("viewer@example.com", Some(&code)).await;
            assert_eq!(joined.status, StatusCode::CREATED, "{:?}", joined.body);
            assert_eq!(joined.body["spaces"][0]["id"], space_id);
            assert_eq!(joined.body["spaces"][0]["role"], "viewer");
            assert_eq!(joined.body["spaces"][0]["member_count"], 2);

            let reused = server.register("late@example.com", Some(&code)).await;
            assert_eq!(reused.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(reused.field(), "invite");

            let unknown = server.register("nobody@example.com", Some("nope")).await;
            assert_eq!(unknown.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unknown.field(), "invite");

            // The member list names the account, and shows the role it joined at.
            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space_id}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(detail.status, StatusCode::OK);
            let members = detail.body["members"].as_array().expect("members").clone();
            assert_eq!(members.len(), 2);
            assert!(members.iter().any(
                |member| member["role"] == "viewer" && member["email"] == "viewer@example.com"
            ));
        });
    }

    #[test]
    fn a_viewer_is_forbidden_to_write_and_a_non_member_cannot_see_the_space() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let garden = create_space(&server, &owner_cookie, "Garden").await;
            let work = create_space(&server, &owner_cookie, "Work").await;

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{garden}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server.register("viewer@example.com", Some(&code)).await;
            let viewer_cookie = cookie_of(&viewer).to_owned();

            let rename = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "name": "Our Garden" })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(rename.status, StatusCode::FORBIDDEN);
            assert_eq!(rename.code(), "forbidden");

            let delete = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "confirm": "Garden" })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(delete.status, StatusCode::FORBIDDEN);

            let no_invites = server
                .call(
                    "GET",
                    &format!("/api/spaces/{garden}/invites"),
                    None,
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(no_invites.status, StatusCode::FORBIDDEN);

            // A space the viewer is not a member of is 404, never 403, and is
            // not in their list either.
            let foreign = server
                .call(
                    "GET",
                    &format!("/api/spaces/{work}"),
                    None,
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(foreign.status, StatusCode::NOT_FOUND);
            assert_eq!(foreign.code(), "not_found");
            let foreign_write = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{work}"),
                    Some(json!({ "name": "Theirs" })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(foreign_write.status, StatusCode::NOT_FOUND);

            let listed = server
                .call("GET", "/api/spaces", None, Some(&viewer_cookie))
                .await;
            let ids: Vec<&str> = listed
                .body
                .as_array()
                .expect("a list")
                .iter()
                .filter_map(|space| space["id"].as_str())
                .collect();
            assert_eq!(ids, vec![garden.as_str()]);
        });
    }

    #[test]
    fn an_owner_keeps_the_space_owned_and_can_hand_it_over() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let owner_id = owner.body["user"]["id"].as_str().expect("an id").to_owned();
            let space = create_space(&server, &owner_cookie, "Garden").await;

            let step_down = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/members/{owner_id}"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(step_down.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(step_down.field(), "role");

            let leave = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{space}/members/{owner_id}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(leave.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(leave.field(), "user");

            let stranger = Uuid::now_v7();
            let unknown_user = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/members/{stranger}"),
                    Some(json!({ "role": "editor" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(unknown_user.status, StatusCode::NOT_FOUND);
        });
    }

    #[test]
    fn signing_out_ends_only_the_session_that_asked() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let first = server.register("owner@example.com", None).await;
            let first_cookie = cookie_of(&first).to_owned();
            let login = server
                .call(
                    "POST",
                    "/api/auth/login",
                    Some(json!({ "email": "owner@example.com", "password": PASSWORD })),
                    None,
                )
                .await;
            assert_eq!(login.status, StatusCode::OK);
            let second_cookie = cookie_of(&login).to_owned();
            assert_ne!(first_cookie, second_cookie);

            let out = server
                .call("POST", "/api/auth/logout", None, Some(&second_cookie))
                .await;
            assert_eq!(out.status, StatusCode::NO_CONTENT);

            let ended = server
                .call("GET", "/api/auth/me", None, Some(&second_cookie))
                .await;
            assert_eq!(ended.status, StatusCode::UNAUTHORIZED);
            let alive = server
                .call("GET", "/api/auth/me", None, Some(&first_cookie))
                .await;
            assert_eq!(alive.status, StatusCode::OK);

            let wrong_password = server
                .call(
                    "POST",
                    "/api/auth/login",
                    Some(json!({ "email": "owner@example.com", "password": "not-the-password" })),
                    None,
                )
                .await;
            assert_eq!(wrong_password.status, StatusCode::UNAUTHORIZED);
            assert_eq!(wrong_password.code(), "unauthenticated");
        });
    }

    async fn create_space(server: &Server, cookie: &str, name: &str) -> String {
        let created = server
            .call(
                "POST",
                "/api/spaces",
                Some(json!({ "name": name })),
                Some(cookie),
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
        created.body["id"].as_str().expect("an id").to_owned()
    }

    /// A space with a `Plant` type that shows `room`, and one plant in it.
    struct Garden {
        space: String,
        plant: String,
    }

    async fn garden(server: &Server, cookie: &str) -> Garden {
        let space = create_space(server, cookie, "Garden").await;
        for (method, path, body, expected) in [
            (
                "POST",
                format!("/api/spaces/{space}/types"),
                json!({ "name": "Plant", "icon": "🪴" }),
                StatusCode::CREATED,
            ),
            (
                "POST",
                format!("/api/spaces/{space}/properties"),
                json!({
                    "name": "Room",
                    "format": "select",
                    "options": [
                        { "name": "Kitchen", "color": "amber" },
                        { "name": "Study", "color": "blue" }
                    ]
                }),
                StatusCode::CREATED,
            ),
            (
                "PATCH",
                format!("/api/spaces/{space}/types/plant"),
                json!({
                    "properties": [{ "key": "room", "featured": true }],
                    "view": {
                        "columns": ["title", "room"],
                        "sorts": [{ "property": "updated_at", "direction": "desc" }],
                        "filter": { "op": "and", "conditions": [] }
                    }
                }),
                StatusCode::OK,
            ),
        ] {
            let reply = server.call(method, &path, Some(body), Some(cookie)).await;
            assert_eq!(reply.status, expected, "{:?}", reply.body);
        }

        let created = server
            .call(
                "POST",
                &format!("/api/spaces/{space}/objects"),
                Some(json!({
                    "type": "plant",
                    "title": "Monstera in the study",
                    "properties": { "room": "kitchen" },
                    "body": "\nWatered.\n",
                })),
                Some(cookie),
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
        Garden {
            space,
            plant: created.body["id"].as_str().expect("an id").to_owned(),
        }
    }

    #[test]
    fn a_type_shows_its_properties_and_a_row_carries_their_labels() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let types = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/types", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(types.status, StatusCode::OK);
            assert_eq!(types.body[0]["key"], "plant");
            assert_eq!(types.body[0]["property_count"], 1);
            assert_eq!(types.body[0]["object_count"], 1);

            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/types/plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.body["properties"][0]["key"], "room");
            assert_eq!(detail.body["view"]["columns"], json!(["title", "room"]));

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.status, StatusCode::OK, "{:?}", list.body);
            assert_eq!(list.body["total"], 1);
            assert_eq!(list.body["has_more"], false);
            let row = &list.body["objects"][0];
            assert_eq!(row["title"], "Monstera in the study");
            assert_eq!(
                row["values"]["room"],
                json!({ "value": "kitchen", "label": "Kitchen" }),
                "the option key travels with the name a cell shows"
            );
        });
    }

    #[test]
    fn a_filter_narrows_the_list_and_a_bad_one_names_its_field() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let list = format!("/api/spaces/{}/objects", garden.space);

            let kept = server
                .call(
                    "GET",
                    &format!(
                        "{list}?type=plant&filter={}",
                        url_encoded(
                            &json!({
                                "op": "and",
                                "conditions": [{
                                    "property": "room",
                                    "condition": "equal",
                                    "value": "kitchen"
                                }]
                            })
                            .to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(kept.status, StatusCode::OK, "{:?}", kept.body);
            assert_eq!(kept.body["total"], 1);

            let dropped = server
                .call(
                    "GET",
                    &format!(
                        "{list}?type=plant&filter={}",
                        url_encoded(
                            &json!({
                                "op": "and",
                                "conditions": [{
                                    "property": "room",
                                    "condition": "equal",
                                    "value": "study"
                                }]
                            })
                            .to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(dropped.body["total"], 0);

            let unknown = server
                .call(
                    "GET",
                    &format!(
                        "{list}?type=plant&filter={}",
                        url_encoded(
                            &json!({
                                "op": "and",
                                "conditions": [{
                                    "property": "ghost",
                                    "condition": "equal",
                                    "value": "x"
                                }]
                            })
                            .to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unknown.field(), "ghost");

            let nonsense = server
                .call(
                    "GET",
                    &format!("{list}?type=plant&nonsense=1"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(nonsense.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(nonsense.field(), "nonsense");
        });
    }

    #[test]
    fn a_search_matches_a_title_and_a_write_needs_the_current_revision() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let object = format!("/api/spaces/{}/objects/{}", garden.space, garden.plant);

            let found = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant&q=watered", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(found.body["total"], 1, "the body is searched too");
            let missing = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant&q=ficus", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(missing.body["total"], 0);

            let stale = server
                .call(
                    "PATCH",
                    &object,
                    Some(json!({ "rev": 7, "title": "Fern" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stale.status, StatusCode::CONFLICT);
            assert_eq!(stale.body["error"]["details"]["current_rev"], 1);
            assert_eq!(stale.body["error"]["details"]["reason"], "stale revision");

            let missing_rev = server
                .call(
                    "PATCH",
                    &object,
                    Some(json!({ "title": "Fern" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(missing_rev.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(missing_rev.field(), "body");

            let written = server
                .call(
                    "PATCH",
                    &object,
                    Some(json!({ "rev": 1, "title": "Monstera by the window" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(written.status, StatusCode::OK, "{:?}", written.body);
            assert_eq!(written.body["rev"], 2);
            assert_eq!(written.body["title"], "Monstera by the window");
            assert_eq!(
                written.body["properties"]["room"]["value"], "kitchen",
                "a title write leaves the values alone"
            );

            // The title names the file, so the object moved, and the id did not.
            let listed = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(listed.body["objects"][0]["id"], garden.plant);
        });
    }

    #[test]
    fn a_trashed_object_leaves_the_list_and_comes_back_with_its_revision() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let object = format!("/api/spaces/{}/objects/{}", garden.space, garden.plant);

            let trashed = server.call("DELETE", &object, None, Some(&cookie)).await;
            assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);
            assert_eq!(trashed.body["rev"], 1);
            assert!(trashed.body["trashed_at"].is_string());
            assert_eq!(trashed.body["title"], "Monstera in the study");

            let gone = server.call("GET", &object, None, Some(&cookie)).await;
            assert_eq!(gone.status, StatusCode::NOT_FOUND);

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.body["total"], 0);

            let trash = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/trash", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(trash.body[0]["id"], garden.plant);
            assert_eq!(
                trash.body[0]["trashed_from"],
                "objects/plant/monstera-in-the-study.md"
            );

            let restored = server
                .call("POST", &format!("{object}/restore"), None, Some(&cookie))
                .await;
            assert_eq!(restored.status, StatusCode::OK, "{:?}", restored.body);
            assert_eq!(restored.body["rev"], 1, "trashing is not a revision");
            assert_eq!(restored.body["trashed_at"], Value::Null);

            let back = server.call("GET", &object, None, Some(&cookie)).await;
            assert_eq!(back.status, StatusCode::OK);

            let history = server
                .call("GET", &format!("{object}/history"), None, Some(&cookie))
                .await;
            let actions: Vec<&str> = history
                .body
                .as_array()
                .expect("revisions")
                .iter()
                .filter_map(|revision| revision["action"].as_str())
                .collect();
            assert_eq!(actions, vec!["create", "delete", "restore"]);
        });
    }

    #[test]
    fn renaming_a_property_key_rewrites_what_names_it() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let renamed = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/properties/room/rename", garden.space),
                    Some(json!({ "key": "space" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(renamed.status, StatusCode::OK, "{:?}", renamed.body);
            assert_eq!(renamed.body["key"], "space");

            let gone = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/properties/room", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(gone.status, StatusCode::NOT_FOUND);

            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                detail.body["properties"]["space"]["value"], "kitchen",
                "the value moved with the key"
            );
            assert_eq!(detail.body["properties"].get("room"), None);
            assert_eq!(detail.body["rev"], 2, "the rewrite counts as a write");

            let history = server
                .call(
                    "GET",
                    &format!(
                        "/api/spaces/{}/objects/{}/history",
                        garden.space, garden.plant
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            let revisions = history.body.as_array().expect("revisions");
            assert_eq!(revisions.len(), 2);
            assert_eq!(revisions[1]["changed"], json!(["space", "room"]));
        });
    }

    #[test]
    fn a_type_with_objects_is_only_deleted_when_the_caller_says_so() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let types = format!("/api/spaces/{}/types/plant", garden.space);

            let refused = server.call("DELETE", &types, None, Some(&cookie)).await;
            assert_eq!(refused.status, StatusCode::CONFLICT);
            assert_eq!(refused.body["error"]["details"]["objects"], 1);

            let deleted = server
                .call(
                    "DELETE",
                    &format!("{types}?delete_objects=true"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(deleted.status, StatusCode::NO_CONTENT);

            let gone = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(gone.status, StatusCode::NOT_FOUND);

            let trash = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/trash", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                trash.body.as_array().expect("trash").len(),
                1,
                "its objects were trashed, not destroyed"
            );
        });
    }

    #[test]
    fn a_viewer_may_read_the_schema_and_an_outside_caller_sees_nothing() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &owner_cookie).await;
            let work = create_space(&server, &owner_cookie, "Work").await;

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server.register("viewer@example.com", Some(&code)).await;
            let viewer_cookie = cookie_of(&viewer).to_owned();

            for path in [
                format!("/api/spaces/{}/types", garden.space),
                format!("/api/spaces/{}/properties", garden.space),
                format!("/api/spaces/{}/objects?type=plant", garden.space),
                format!("/api/spaces/{}/trash", garden.space),
                format!("/api/spaces/{}/health", garden.space),
            ] {
                let read = server.call("GET", &path, None, Some(&viewer_cookie)).await;
                assert_eq!(read.status, StatusCode::OK, "{path}");
            }

            let write = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "Sneaky" })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(write.status, StatusCode::FORBIDDEN);

            // A space the caller is not in is 404 on every one of these, never 403.
            for path in [
                format!("/api/spaces/{work}/types"),
                format!("/api/spaces/{work}/objects?type=plant"),
                format!("/api/spaces/{work}/health"),
            ] {
                let foreign = server.call("GET", &path, None, Some(&viewer_cookie)).await;
                assert_eq!(foreign.status, StatusCode::NOT_FOUND, "{path}");
            }
        });
    }

    #[test]
    fn an_object_needs_a_type_that_exists_and_a_title_that_is_there() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let unknown_type = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "ghost", "title": "Boo" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown_type.status, StatusCode::NOT_FOUND);

            let blank = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "   " })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(blank.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(blank.field(), "title");

            let unknown_property = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({
                        "type": "plant",
                        "title": "Fern",
                        "properties": { "ghost": "x" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown_property.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                unknown_property.body["error"]["details"]["errors"][0]["field"],
                "ghost"
            );

            let unknown_option = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({
                        "type": "plant",
                        "title": "Fern",
                        "properties": { "room": "attic" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown_option.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                unknown_option.body["error"]["details"]["errors"][0]["message"],
                "unknown option attic"
            );
        });
    }

    #[test]
    fn a_second_type_of_the_same_name_conflicts_and_a_reserved_name_is_refused() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let types = format!("/api/spaces/{}/types", garden.space);

            let again = server
                .call(
                    "POST",
                    &types,
                    Some(json!({ "name": "plant" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(again.status, StatusCode::CONFLICT);

            let reserved = server
                .call(
                    "POST",
                    &types,
                    Some(json!({ "name": "Properties" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(reserved.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(reserved.field(), "name");
        });
    }

    /// Percent-encodes a JSON document the way a browser sends it in a query.
    fn url_encoded(text: &str) -> String {
        text.bytes()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (byte as char).to_string()
                }
                other => format!("%{other:02X}"),
            })
            .collect()
    }
    use crate::events::SpaceEvent;

    /// The next event, or a failure rather than a test that hangs.
    async fn next_event(events: &mut tokio::sync::broadcast::Receiver<SpaceEvent>) -> SpaceEvent {
        tokio::time::timeout(std::time::Duration::from_secs(2), events.recv())
            .await
            .expect("an event within two seconds")
            .expect("a live channel")
    }

    #[test]
    fn every_write_broadcasts_its_event_to_the_space() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&space).expect("an id"))
                .expect("a loaded space");
            let mut events = handle.events.subscribe();
            let base = format!("/api/spaces/{space}");

            let created_type = server
                .call(
                    "POST",
                    &format!("{base}/types"),
                    Some(json!({ "name": "Plant" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created_type.status, StatusCode::CREATED);
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "type.created");
            assert_eq!(event.space.to_string(), space);
            assert_eq!(event.payload["key"], "plant");

            server
                .call(
                    "POST",
                    &format!("{base}/properties"),
                    Some(json!({
                        "name": "Room",
                        "format": "select",
                        "options": [{ "name": "Kitchen" }]
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "property.created");

            server
                .call(
                    "PATCH",
                    &format!("{base}/types/plant"),
                    Some(json!({ "properties": [{ "key": "room" }] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "type.updated");

            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "plant",
                        "title": "Monstera",
                        "properties": { "room": "kitchen" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            let id = created.body["id"].as_str().expect("an id").to_owned();
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.created");
            assert_eq!(event.payload["id"], id.as_str());
            assert_eq!(event.payload["type"], "plant");
            assert_eq!(event.payload["rev"], 1);

            server
                .call(
                    "PATCH",
                    &format!("{base}/objects/{id}"),
                    Some(json!({ "rev": 1, "title": "Monstera in the study" })),
                    Some(&cookie),
                )
                .await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.updated");
            assert_eq!(event.payload["rev"], 2);

            server
                .call(
                    "DELETE",
                    &format!("{base}/objects/{id}"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "object.deleted");

            server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/restore"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "object.restored");

            server
                .call(
                    "DELETE",
                    &format!("{base}/objects/{id}"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "object.deleted");
            server
                .call("DELETE", &format!("{base}/trash/{id}"), None, Some(&cookie))
                .await;
            assert_eq!(next_event(&mut events).await.event, "object.purged");

            server
                .call(
                    "PATCH",
                    &base,
                    Some(json!({ "name": "Our Garden" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "space.updated");
        });
    }

    /// Reads an HTTP response head, through the blank line that ends it.
    async fn read_head(stream: &mut tokio::net::TcpStream) -> String {
        use tokio::io::AsyncReadExt;
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).await.expect("a head byte");
            head.push(byte[0]);
        }
        String::from_utf8(head).expect("an ASCII head")
    }

    /// Reads one unmasked WebSocket text frame, the only kind the server sends.
    async fn read_text_frame(stream: &mut tokio::net::TcpStream) -> String {
        use tokio::io::AsyncReadExt;
        let mut header = [0u8; 2];
        stream
            .read_exact(&mut header)
            .await
            .expect("a frame header");
        assert_eq!(header[0] & 0x0f, 1, "a text frame");
        assert_eq!(header[1] & 0x80, 0, "a server frame is unmasked");
        let mut len = usize::from(header[1] & 0x7f);
        if len == 126 {
            let mut extended = [0u8; 2];
            stream
                .read_exact(&mut extended)
                .await
                .expect("a frame length");
            len = usize::from(u16::from_be_bytes(extended));
        } else if len == 127 {
            let mut extended = [0u8; 8];
            stream
                .read_exact(&mut extended)
                .await
                .expect("a frame length");
            len = u64::from_be_bytes(extended) as usize;
        }
        let mut payload = vec![0u8; len];
        stream
            .read_exact(&mut payload)
            .await
            .expect("a frame payload");
        String::from_utf8(payload).expect("UTF-8 text")
    }

    /// Writes a handshake request and returns the stream and the response head.
    async fn handshake(
        addr: std::net::SocketAddr,
        path: &str,
        origin: Option<&str>,
    ) -> (tokio::net::TcpStream, String) {
        use tokio::io::AsyncWriteExt;
        let mut stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("a connection");
        let origin = origin.map_or_else(String::new, |origin| format!("Origin: {origin}\r\n"));
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n{origin}\r\n"
        );
        stream
            .write_all(request.as_bytes())
            .await
            .expect("a handshake");
        let head = read_head(&mut stream).await;
        (stream, head)
    }

    #[test]
    fn the_socket_greets_the_client_then_relays_writes() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let token = cookie
                .strip_prefix("thing_session=")
                .expect("the session cookie");
            let addr = serve(server.router.clone()).await;

            let path = format!("/api/spaces/{}/events?session={token}", garden.space);
            let (mut socket, head) = handshake(addr, &path, None).await;
            assert!(head.starts_with("HTTP/1.1 101"), "{head}");
            let hello: serde_json::Value =
                serde_json::from_str(&read_text_frame(&mut socket).await).expect("a hello frame");
            assert_eq!(hello["event"], "hello");
            assert_eq!(hello["space"], garden.space.as_str());

            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({ "rev": 1, "properties": { "room": "study" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let event: serde_json::Value =
                serde_json::from_str(&read_text_frame(&mut socket).await).expect("an event");
            assert_eq!(event["event"], "object.updated");
            assert_eq!(event["payload"]["id"], garden.plant.as_str());
            assert_eq!(event["payload"]["rev"], 2);

            // The session query parameter is the only credential; without it
            // the upgrade is refused before a socket exists.
            let (anonymous, head) =
                handshake(addr, &format!("/api/spaces/{}/events", garden.space), None).await;
            assert!(head.starts_with("HTTP/1.1 401"), "{head}");
            drop(anonymous);

            // A browser origin that is not this app is refused before a socket.
            let (foreign, head) = handshake(addr, &path, Some("https://evil.example")).await;
            assert!(head.starts_with("HTTP/1.1 403"), "{head}");
            drop(foreign);

            // The public URL's own origin is accepted.
            let (same, head) = handshake(addr, &path, Some("http://localhost:5173")).await;
            assert!(head.starts_with("HTTP/1.1 101"), "{head}");
            drop(same);
        });
    }
    #[test]
    fn member_changes_broadcast_the_membership_they_write() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let member = server.register("member@example.com", Some(&code)).await;
            let user = member.body["user"]["id"]
                .as_str()
                .expect("an id")
                .to_owned();

            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&space).expect("an id"))
                .expect("a loaded space");
            let mut events = handle.events.subscribe();

            let endpoint = format!("/api/spaces/{space}/members/{user}");
            server
                .call(
                    "POST",
                    &endpoint,
                    Some(json!({ "role": "editor" })),
                    Some(&cookie),
                )
                .await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "member.updated");
            assert_eq!(event.payload["role"], "editor");

            server
                .call(
                    "POST",
                    &endpoint,
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "member.updated");

            server.call("DELETE", &endpoint, None, Some(&cookie)).await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "member.removed");
            assert_eq!(event.payload["user"], user.as_str());

            // Adding someone who is not a member yet is `member.added`.
            server
                .call(
                    "POST",
                    &endpoint,
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(next_event(&mut events).await.event, "member.added");
        });
    }
    /// Waits for the server to end the socket, allowing a close frame first.
    async fn expect_closed(socket: &mut tokio::net::TcpStream) {
        use tokio::io::AsyncReadExt;
        let mut buffer = [0u8; 2];
        let outcome =
            tokio::time::timeout(std::time::Duration::from_secs(2), socket.read(&mut buffer))
                .await
                .expect("the server closes the socket");
        match outcome {
            Ok(0) | Err(_) => {}
            Ok(_) => assert_eq!(buffer[0] & 0x0f, 8, "a close frame"),
        }
    }

    #[test]
    fn removing_a_member_closes_their_live_socket() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server.register("viewer@example.com", Some(&code)).await;
            let viewer_token = cookie_of(&viewer)
                .strip_prefix("thing_session=")
                .expect("the session cookie")
                .to_owned();
            let viewer_id = viewer.body["user"]["id"]
                .as_str()
                .expect("an id")
                .to_owned();

            let addr = serve(server.router.clone()).await;
            let path = format!("/api/spaces/{space}/events?session={viewer_token}");
            let (mut socket, head) = handshake(addr, &path, None).await;
            assert!(head.starts_with("HTTP/1.1 101"), "{head}");
            let hello: serde_json::Value =
                serde_json::from_str(&read_text_frame(&mut socket).await).expect("a hello frame");
            assert_eq!(hello["event"], "hello");

            let removed = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{space}/members/{viewer_id}"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(removed.status, StatusCode::NO_CONTENT);

            let event: serde_json::Value =
                serde_json::from_str(&read_text_frame(&mut socket).await).expect("an event");
            assert_eq!(event["event"], "member.removed");
            assert_eq!(event["payload"]["user"], viewer_id.as_str());

            expect_closed(&mut socket).await;
        });
    }
}
