//! The HTTP surface: routing, the shared request plumbing, and the SPA fallback.
//!
//! Every error leaves as the same `{"error":{code,message,details}}` envelope,
//! including a malformed body or path parameter — which is why requests are
//! extracted through [`ApiJson`] and parsed with [`uuid_param`] rather than
//! axum's own rejections.

mod auth;
mod csv;
mod objects;
mod properties;
mod spaces;
mod types;
mod values;
mod views;

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{FromRequest, FromRequestParts, Query, Request};
use axum::http::request::Parts;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, Uri};
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
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::auth::Caller;
use crate::config::Config;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// The app is a same-origin SPA with external script/style files; no inline
/// script, no framed use, no third-party image loads. `style-src` keeps
/// `'unsafe-inline'` because React writes `style` attributes for option colours.
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; \
     style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; \
     connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; \
     form-action 'self'";

pub fn router(config: &Config, state: SharedState) -> Router {
    // The API's catch-all is a route, not a fallback, so a mistyped `/api/...`
    // path is JSON here and never the SPA's `index.html`; the paths that exist
    // are registered above it and win over the catch-all.
    let app = Router::new()
        .route("/api/health", get(health))
        .merge(auth::routes())
        .merge(spaces::routes())
        .merge(types::routes())
        .merge(views::routes())
        .merge(properties::routes())
        .merge(csv::routes())
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
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(CONTENT_SECURITY_POLICY),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
        ))
        .with_state(state)
}

/// What one request's trace span records: never the query string, which can
/// carry a session token on the events upgrade.
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

/// Any other `/api` path is JSON, never the SPA's `index.html`. The path alone
/// is echoed: the query can carry the events session token.
async fn no_such_route(method: Method, uri: Uri) -> ApiError {
    ApiError::from(CoreError::NotFound(format!("{method} {}", uri.path())))
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
        "invalid_timezone": problems.invalid_timezone,
        "schedule_key_conflicts": problems.schedule_key_conflicts,
        "view_problems": problems
            .view_problems
            .iter()
            .map(|problem| json!({
                "type": problem.type_key,
                "view": problem.view_key,
                "field": problem.field,
                "message": problem.message,
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
    use axum::http::{HeaderMap, Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tempfile::TempDir;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::*;
    use crate::accounts::Accounts;
    use crate::spaces::SpaceRegistry;
    use crate::state::{ACCOUNTS_FILE, AppState};
    use thing_core::validate::MAX_TITLE_LEN;

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
        headers: HeaderMap,
        /// The response verbatim, for CSV, markdown and other non-JSON bodies.
        bytes: Vec<u8>,
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

        fn text(&self) -> &str {
            std::str::from_utf8(&self.bytes).expect("a UTF-8 response")
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
            match body {
                Some(body) => {
                    let bytes = body.to_string().into_bytes();
                    self.call_raw(method, uri, Some("application/json"), &bytes, cookie)
                        .await
                }
                None => self.call_raw(method, uri, None, &[], cookie).await,
            }
        }

        /// A request with a body that is not JSON: CSV, markdown or nothing.
        async fn call_raw(
            &self,
            method: &str,
            uri: &str,
            content_type: Option<&str>,
            body: &[u8],
            cookie: Option<&str>,
        ) -> Reply {
            let mut request = Request::builder().method(method).uri(uri);
            if let Some(cookie) = cookie {
                request = request.header("cookie", cookie);
            }
            if let Some(content_type) = content_type {
                request = request.header("content-type", content_type);
            }
            let request = request.body(Body::from(body.to_vec())).expect("a request");
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
            let headers = response.headers().clone();
            let bytes = response
                .into_body()
                .collect()
                .await
                .expect("a body")
                .to_bytes()
                .to_vec();
            let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            Reply {
                status,
                body,
                cookie,
                headers,
                bytes,
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
    fn every_response_carries_the_security_headers() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let reply = server.call("GET", "/api/health", None, None).await;
            assert_eq!(reply.status, StatusCode::OK);
            assert_eq!(
                reply.headers.get("content-security-policy").unwrap(),
                CONTENT_SECURITY_POLICY
            );
            assert_eq!(
                reply.headers.get("x-content-type-options").unwrap(),
                "nosniff"
            );
            assert_eq!(reply.headers.get("x-frame-options").unwrap(), "DENY");
            assert_eq!(
                reply.headers.get("referrer-policy").unwrap(),
                "strict-origin-when-cross-origin"
            );
            assert_eq!(
                reply.headers.get("permissions-policy").unwrap(),
                "camera=(), microphone=(), geolocation=()"
            );
        });
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

            // A query token is for the events upgrade only.
            let registered = server.register("query@example.com", None).await;
            let token = cookie_of(&registered)
                .strip_prefix("thing_session=")
                .expect("the session pair");
            let in_query = server
                .call("GET", &format!("/api/auth/me?session={token}"), None, None)
                .await;
            assert_eq!(in_query.status, StatusCode::UNAUTHORIZED);
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
                    "properties": [{ "key": "room", "featured": true }]
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

    /// A second unscheduled type carrying the same `room` property, so an
    /// export of `plant` can be imported without relation targets.
    async fn specimen_type(server: &Server, cookie: &str, space: &str) -> String {
        let created = server
            .call(
                "POST",
                &format!("/api/spaces/{space}/types"),
                Some(json!({ "name": "Specimen" })),
                Some(cookie),
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
        let key = created.body["key"].as_str().expect("a key").to_owned();
        let patched = server
            .call(
                "PATCH",
                &format!("/api/spaces/{space}/types/{key}"),
                Some(json!({ "properties": [{ "key": "room" }] })),
                Some(cookie),
            )
            .await;
        assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);
        key
    }

    #[test]
    fn exporting_a_type_writes_csv_and_a_header_only_template() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("export@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let url = format!("/api/spaces/{}/types/plant/export", garden.space);

            let exported = server.call_raw("GET", &url, None, &[], Some(&cookie)).await;
            assert_eq!(exported.status, StatusCode::OK);
            assert_eq!(
                exported.headers.get("content-type").expect("a type"),
                "text/csv; charset=utf-8"
            );
            let disposition = exported
                .headers
                .get("content-disposition")
                .expect("a disposition")
                .to_str()
                .expect("ASCII");
            assert!(
                disposition.starts_with("attachment; filename=\"thing-plant-"),
                "{disposition}"
            );
            assert!(disposition.ends_with(".csv\""), "{disposition}");
            let date = time::OffsetDateTime::now_utc().date();
            let filename = format!(
                "thing-plant-{:04}-{:02}-{:02}.csv",
                date.year(),
                u8::from(date.month()),
                date.day()
            );
            assert!(disposition.contains(&filename), "{disposition}");

            let text = exported.text();
            assert!(text.starts_with('\u{feff}'), "the export has no BOM");
            let lines: Vec<&str> = text
                .trim_start_matches('\u{feff}')
                .split("\r\n")
                .filter(|line| !line.is_empty())
                .collect();
            assert_eq!(lines[0], "title,room,_body");
            assert_eq!(lines.len(), 2);
            assert!(
                lines[1].starts_with("Monstera in the study,kitchen,\""),
                "{}",
                lines[1]
            );
            assert!(lines[1].contains("Watered."));

            let template = server
                .call_raw(
                    "GET",
                    &format!("{url}?template=true"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(template.status, StatusCode::OK);
            assert_eq!(template.text(), "\u{feff}title,room,_body\r\n");

            let bad_template = server
                .call_raw(
                    "GET",
                    &format!("{url}?template=maybe"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(bad_template.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(bad_template.field(), "template");

            let unknown = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/types/ghost/export", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown.status, StatusCode::NOT_FOUND);

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code");
            let viewer = server
                .register("export-viewer@example.com", Some(code))
                .await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let allowed = server
                .call_raw("GET", &url, None, &[], Some(&viewer_cookie))
                .await;
            assert_eq!(allowed.status, StatusCode::OK);
        });
    }

    #[test]
    fn a_valid_csv_dry_runs_previews_and_commits_with_one_event() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("import@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let specimen = specimen_type(&server, &cookie, &garden.space).await;
            let export = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/types/plant/export", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(export.status, StatusCode::OK);
            let url = format!("/api/spaces/{}/types/{specimen}/import", garden.space);
            let space = Uuid::parse_str(&garden.space).expect("an id");
            let handle = server.state.registry.get(space).expect("a loaded space");

            let dry = server
                .call_raw(
                    "POST",
                    &format!("{url}?dry_run=true"),
                    Some("text/csv"),
                    &export.bytes,
                    Some(&cookie),
                )
                .await;
            assert_eq!(dry.status, StatusCode::OK, "{:?}", dry.body);
            assert_eq!(dry.body["rows"], 1);
            assert_eq!(dry.body["valid"], true);
            assert_eq!(dry.body["errors"], json!([]));
            assert_eq!(dry.body["preview"][0]["row"], 1);
            assert_eq!(dry.body["preview"][0]["title"], "Monstera in the study");
            assert_eq!(dry.body["preview"][0]["values"]["room"], "kitchen");

            let mut events = handle.events.subscribe();
            let commit = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv; charset=utf-8"),
                    &export.bytes,
                    Some(&cookie),
                )
                .await;
            assert_eq!(commit.status, StatusCode::CREATED, "{:?}", commit.body);
            assert_eq!(commit.body["count"], 1);
            assert_eq!(commit.body["created"][0]["title"], "Monstera in the study");
            let first = commit.body["created"][0]["id"]
                .as_str()
                .expect("an id")
                .to_owned();

            let event = next_event(&mut events).await;
            assert_eq!(event.event, "objects.imported");
            assert_eq!(event.payload["type"], specimen.as_str());
            assert_eq!(event.payload["count"], 1);

            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{first}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.status, StatusCode::OK, "{:?}", detail.body);
            assert_eq!(detail.body["type"], specimen.as_str());
            assert_eq!(detail.body["rev"], 1);
            assert_eq!(detail.body["properties"]["room"]["value"], "kitchen");
            assert_eq!(detail.body["body"], "\nWatered.\n");

            let history = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{first}/history", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            let lines = history.body.as_array().expect("a list");
            assert_eq!(lines.len(), 1);
            assert_eq!(lines[0]["action"], "create");

            let raw = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/objects/{first}/raw", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert!(raw.text().starts_with("---\nschema: 4\n"));

            let again = server
                .call_raw("POST", &url, Some("text/csv"), &export.bytes, Some(&cookie))
                .await;
            assert_eq!(again.status, StatusCode::CREATED, "{:?}", again.body);
            assert_ne!(again.body["created"][0]["id"], first.as_str());

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type={specimen}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.body["total"], 2);
        });
    }

    #[test]
    fn an_invalid_import_is_refused_by_row_and_writes_nothing() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("import-bad@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let specimen = specimen_type(&server, &cookie, &garden.space).await;
            let url = format!("/api/spaces/{}/types/{specimen}/import", garden.space);

            let broken = b"title,room\nBad,attic\n";
            let dry = server
                .call_raw(
                    "POST",
                    &format!("{url}?dry_run=true"),
                    Some("text/csv"),
                    broken,
                    Some(&cookie),
                )
                .await;
            assert_eq!(dry.status, StatusCode::OK);
            assert_eq!(dry.body["rows"], 1);
            assert_eq!(dry.body["valid"], false);
            assert_eq!(dry.body["errors"][0]["row"], 1);
            assert_eq!(dry.body["errors"][0]["field"], "room");
            assert_eq!(dry.body["errors"][0]["message"], "unknown option attic");
            assert_eq!(dry.body["preview"], json!([]));

            let refused = server
                .call_raw("POST", &url, Some("text/csv"), broken, Some(&cookie))
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(refused.body["error"]["details"]["errors"][0]["row"], 1);
            assert_eq!(
                refused.body["error"]["details"]["errors"][0]["field"],
                "room"
            );

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type={specimen}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.body["total"], 0, "a refused row wrote something");

            let unknown_header = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    b"title,mystery\nA,x\n",
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown_header.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                unknown_header.body["error"]["details"]["errors"][0]["row"],
                0
            );
            assert_eq!(
                unknown_header.body["error"]["details"]["errors"][0]["field"],
                "mystery"
            );

            let header_only = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    b"title,room\n",
                    Some(&cookie),
                )
                .await;
            assert_eq!(header_only.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                header_only.body["error"]["details"]["errors"][0]["field"],
                "csv"
            );
        });
    }

    #[test]
    fn an_import_checks_its_limits_content_type_and_role() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("import-limits@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let specimen = specimen_type(&server, &cookie, &garden.space).await;
            let url = format!("/api/spaces/{}/types/{specimen}/import", garden.space);

            let too_big = vec![b'a'; 5 * 1024 * 1024 + 1];
            let oversized = server
                .call_raw("POST", &url, Some("text/csv"), &too_big, Some(&cookie))
                .await;
            assert_eq!(oversized.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                oversized.body["error"]["details"]["errors"][0]["field"],
                "csv"
            );
            assert!(
                oversized.body["error"]["details"]["errors"][0]["message"]
                    .as_str()
                    .expect("a message")
                    .contains("5 MiB")
            );

            let mut many = String::from("title,room\n");
            for index in 0..=10_000 {
                many.push_str(&format!("Fern {index},kitchen\n"));
            }
            let too_many = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    many.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(too_many.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(too_many.body["error"]["details"]["errors"][0]["row"], 0);
            assert!(
                too_many.body["error"]["details"]["errors"][0]["message"]
                    .as_str()
                    .expect("a message")
                    .contains("10000")
            );

            let bad_flag = server
                .call_raw(
                    "POST",
                    &format!("{url}?dry_run=maybe"),
                    Some("text/csv"),
                    b"title,room\n",
                    Some(&cookie),
                )
                .await;
            assert_eq!(bad_flag.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(bad_flag.field(), "dry_run");

            let wrong_type = server
                .call_raw("POST", &url, Some("application/json"), b"{}", Some(&cookie))
                .await;
            assert_eq!(wrong_type.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(wrong_type.field(), "content-type");

            let missing_type = server
                .call_raw("POST", &url, None, b"title,room\n", Some(&cookie))
                .await;
            assert_eq!(missing_type.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(missing_type.field(), "content-type");

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code");
            let viewer = server
                .register("import-viewer@example.com", Some(code))
                .await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let refused = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    b"title,room\nFern,kitchen\n",
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);
        });
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
            assert_eq!(detail.body["default_view"], "all");
            assert_eq!(detail.body["views"][0]["key"], "all");
            assert_eq!(detail.body["views"][0]["columns"], json!(["title"]));

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
                row["values"],
                json!({}),
                "the default view shows the title alone"
            );

            let object = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                object.body["properties"]["room"],
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
    fn an_icon_patches_duplicates_and_reaches_every_projection() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("icon@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let objects = format!("/api/spaces/{}/objects", garden.space);

            let created = server
                .call(
                    "POST",
                    &objects,
                    Some(json!({
                        "type": "plant",
                        "title": "Fern",
                        "icon": " 🌿 ",
                        "properties": { "room": "study" },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            assert_eq!(created.body["icon"], "🌿", "the glyph is trimmed");
            let fern = created.body["id"].as_str().expect("an id").to_owned();
            let fern_path = format!("/api/spaces/{}/objects/{fern}", garden.space);

            // A patch that omits the icon leaves it alone; an icon-only patch is
            // a write like any other and bumps the revision.
            let retitled = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 1, "title": "Boston fern" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(retitled.status, StatusCode::OK, "{:?}", retitled.body);
            assert_eq!(retitled.body["icon"], "🌿");

            let icon_only = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 2, "icon": "🪴" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(icon_only.status, StatusCode::OK, "{:?}", icon_only.body);
            assert_eq!(icon_only.body["rev"], 3);
            assert_eq!(icon_only.body["icon"], "🪴");

            let cleared = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 3, "icon": null })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(cleared.status, StatusCode::OK, "{:?}", cleared.body);
            assert!(
                cleared.body.get("icon").is_none(),
                "null clears the key: {:?}",
                cleared.body
            );

            // Set it again, so every projection below has something to carry.
            let reset = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 4, "icon": "🌿" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(reset.status, StatusCode::OK, "{:?}", reset.body);
            assert_eq!(reset.body["rev"], 5);

            let list = server
                .call("GET", &format!("{objects}?type=plant"), None, Some(&cookie))
                .await;
            let row = list.body["objects"]
                .as_array()
                .expect("rows")
                .iter()
                .find(|row| row["title"] == "Boston fern")
                .expect("the renamed row");
            assert_eq!(row["icon"], "🌿");

            let raw = server
                .call_raw("GET", &format!("{fern_path}/raw"), None, &[], Some(&cookie))
                .await;
            assert!(raw.text().starts_with("---\nschema: 4\n"), "{}", raw.text());
            assert!(raw.text().contains("\nicon: 🌿\n"), "{}", raw.text());

            let history = server
                .call("GET", &format!("{fern_path}/history"), None, Some(&cookie))
                .await;
            let lines = history.body.as_array().expect("lines");
            assert_eq!(lines.len(), 5);
            assert_eq!(lines[0]["snapshot"]["icon"], "🌿");
            assert!(
                lines[0]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .any(|key| key == "icon"),
                "the first revision names its icon: {:?}",
                lines[0]
            );
            // The title write kept the icon and did not report it as changed.
            assert_eq!(lines[1]["snapshot"]["icon"], "🌿");
            assert!(
                !lines[1]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .any(|key| key == "icon")
            );
            // The clearing write dropped the key.
            assert!(lines[3]["snapshot"].get("icon").is_none());
            assert!(
                lines[3]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .any(|key| key == "icon")
            );

            // A duplicate copies the document, icon included.
            let copy = server
                .call(
                    "POST",
                    &format!("{fern_path}/duplicate"),
                    Some(json!({})),
                    Some(&cookie),
                )
                .await;
            assert_eq!(copy.status, StatusCode::CREATED, "{:?}", copy.body);
            assert_eq!(copy.body["icon"], "🌿");

            // Trash, list and restore all carry it.
            let trashed = server.call("DELETE", &fern_path, None, Some(&cookie)).await;
            assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);
            assert_eq!(trashed.body["icon"], "🌿");
            let trash = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/trash", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert!(
                trash
                    .body
                    .as_array()
                    .expect("trash")
                    .iter()
                    .any(|item| item["id"] == fern.as_str() && item["icon"] == "🌿")
            );
            let restored = server
                .call("POST", &format!("{fern_path}/restore"), None, Some(&cookie))
                .await;
            assert_eq!(restored.body["icon"], "🌿");

            // `icon` is a frontmatter key, so a property may not take it.
            let reserved = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/properties", garden.space),
                    Some(json!({ "name": "Icon", "format": "text" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(reserved.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(reserved.field(), "name");
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
    fn a_new_object_starts_with_its_title_as_a_heading() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("heading@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let created = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "  Fern  " })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            assert_eq!(created.body["body"], "# Fern\n");

            let id = created.body["id"].as_str().expect("an id");
            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{id}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.body["body"], "# Fern\n");

            let written = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({
                        "type": "plant",
                        "title": "Ivy",
                        "body": "\nClimbed the wall.\n"
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(written.status, StatusCode::CREATED, "{:?}", written.body);
            assert_eq!(written.body["body"], "\nClimbed the wall.\n");

            let whitespace = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "Moss", "body": "  \n\t" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                whitespace.status,
                StatusCode::CREATED,
                "{:?}",
                whitespace.body
            );
            assert_eq!(whitespace.body["body"], "# Moss\n");
        });
    }

    #[test]
    fn duplicating_an_object_copies_it_and_leaves_the_source_alone() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("duplicate@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}/objects", garden.space);
            let source = format!("{base}/{}", garden.plant);

            let before = server.call("GET", &source, None, Some(&cookie)).await;
            assert_eq!(before.status, StatusCode::OK);
            let history_before = server
                .call("GET", &format!("{source}/history"), None, Some(&cookie))
                .await;

            let duplicated = server
                .call(
                    "POST",
                    &format!("{source}/duplicate"),
                    Some(json!({})),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                duplicated.status,
                StatusCode::CREATED,
                "{:?}",
                duplicated.body
            );
            let copy = duplicated.body["id"].as_str().expect("an id");
            assert_ne!(copy, garden.plant);
            assert_eq!(duplicated.body["type"], "plant");
            assert_eq!(duplicated.body["rev"], 1);
            assert_eq!(duplicated.body["title"], "Monstera in the study (copy)");
            assert_eq!(duplicated.body["properties"]["room"]["value"], "kitchen");
            assert_eq!(duplicated.body["body"], "\nWatered.\n");

            let history = server
                .call(
                    "GET",
                    &format!("{base}/{copy}/history"),
                    None,
                    Some(&cookie),
                )
                .await;
            let lines = history.body.as_array().expect("a list");
            assert_eq!(lines.len(), 1);
            assert_eq!(lines[0]["action"], "create");
            assert_eq!(lines[0]["rev"], 1);

            let after = server.call("GET", &source, None, Some(&cookie)).await;
            assert_eq!(after.body, before.body, "the source changed");
            let history_after = server
                .call("GET", &format!("{source}/history"), None, Some(&cookie))
                .await;
            assert_eq!(history_after.body, history_before.body);

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.body["total"], 2);
        });
    }

    #[test]
    fn a_duplicate_takes_an_optional_title_and_refuses_a_bad_one() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("duplicate-title@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let source = format!(
                "/api/spaces/{}/objects/{}/duplicate",
                garden.space, garden.plant
            );

            let named = server
                .call(
                    "POST",
                    &source,
                    Some(json!({ "title": "  Patio Monstera  " })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(named.status, StatusCode::CREATED, "{:?}", named.body);
            assert_eq!(named.body["title"], "Patio Monstera");

            let overlong = server
                .call(
                    "POST",
                    &source,
                    Some(json!({ "title": "a".repeat(MAX_TITLE_LEN + 1) })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(overlong.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(overlong.field(), "title");

            let unknown = server
                .call(
                    "POST",
                    &source,
                    Some(json!({ "name": "Patio" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unknown.field(), "body");
        });
    }

    #[test]
    fn a_duplicate_keeps_every_schedule_value() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server
                .register("duplicate-schedule@example.com", None)
                .await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}/objects");

            let created = server
                .call(
                    "POST",
                    &base,
                    Some(json!({
                        "type": "chore",
                        "title": "Water the monstera",
                        "properties": {
                            "due_date": day(-1),
                            "recurrence": { "kind": "days", "every": 3 },
                            "last_completed_at": "2026-10-19T08:00:00Z"
                        }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            let id = created.body["id"].as_str().expect("an id");

            let duplicated = server
                .call(
                    "POST",
                    &format!("{base}/{id}/duplicate"),
                    Some(json!({})),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                duplicated.status,
                StatusCode::CREATED,
                "{:?}",
                duplicated.body
            );
            for key in ["due_date", "recurrence", "last_completed_at"] {
                assert_eq!(
                    duplicated.body["properties"][key], created.body["properties"][key],
                    "{key} changed in the copy"
                );
            }
            assert_eq!(duplicated.body["schedule"], created.body["schedule"]);
        });
    }

    #[test]
    fn a_trashed_source_cannot_be_duplicated_and_a_viewer_may_not_duplicate() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("duplicate-trash@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}/objects", garden.space);
            let source = format!("{base}/{}", garden.plant);

            let trashed = server.call("DELETE", &source, None, Some(&cookie)).await;
            assert_eq!(trashed.status, StatusCode::OK);
            let missing = server
                .call(
                    "POST",
                    &format!("{source}/duplicate"),
                    Some(json!({})),
                    Some(&cookie),
                )
                .await;
            assert_eq!(missing.status, StatusCode::NOT_FOUND);

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code");
            let viewer = server
                .register("duplicate-viewer@example.com", Some(code))
                .await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let refused = server
                .call(
                    "POST",
                    &format!("{base}/{}/duplicate", garden.plant),
                    Some(json!({})),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);
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

    /// A calendar day relative to now, in the `YYYY-MM-DD` the API takes.
    fn day(offset: i64) -> String {
        (time::OffsetDateTime::now_utc() + time::Duration::days(offset))
            .date()
            .to_string()
    }

    /// A space whose `Chore` type is scheduled, in UTC.
    async fn chore_space(server: &Server, cookie: &str) -> String {
        let space = server
            .call(
                "POST",
                "/api/spaces",
                Some(json!({ "name": "Chores", "timezone": "UTC" })),
                Some(cookie),
            )
            .await;
        assert_eq!(space.status, StatusCode::CREATED, "{:?}", space.body);
        let space = space.body["id"].as_str().expect("an id").to_owned();
        let created = server
            .call(
                "POST",
                &format!("/api/spaces/{space}/types"),
                Some(json!({ "name": "Chore", "schedule": true })),
                Some(cookie),
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
        space
    }

    #[test]
    fn completing_a_scheduled_record_advances_and_records_it() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("complete@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");
            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&space).expect("an id"))
                .expect("a loaded space");

            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Water the monstera",
                        "properties": {
                            "due_date": day(-1),
                            "recurrence": { "kind": "days", "every": 3 }
                        }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            let id = created.body["id"].as_str().expect("an id").to_owned();

            let mut events = handle.events.subscribe();
            let completed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.body);
            assert_eq!(completed.body["rev"], 2);
            assert_eq!(completed.body["title"], "Water the monstera");
            assert_eq!(
                completed.body["properties"]["due_date"]["value"],
                day(3),
                "a late completion re-phases from today"
            );
            assert_eq!(completed.body["schedule"]["status"], "upcoming");
            assert_eq!(completed.body["schedule"]["days_until_due"], 3);
            assert!(completed.body["schedule"]["completed_at"].is_string());

            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.completed");
            assert_eq!(event.payload["id"], id.as_str());
            assert_eq!(event.payload["type"], "chore");
            assert_eq!(event.payload["rev"], 2);
            assert_eq!(event.payload["due_date"], day(3));

            let stale = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stale.status, StatusCode::CONFLICT);
            assert_eq!(stale.code(), "conflict");
            assert_eq!(stale.body["error"]["details"]["current_rev"], 2);

            let history = server
                .call(
                    "GET",
                    &format!("{base}/objects/{id}/history"),
                    None,
                    Some(&cookie),
                )
                .await;
            let last = history
                .body
                .as_array()
                .expect("a list")
                .last()
                .expect("a line");
            assert_eq!(last["action"], "complete");
            assert!(
                last["changed"]
                    .as_array()
                    .expect("changed")
                    .contains(&json!("due_date"))
            );
            assert!(
                last["changed"]
                    .as_array()
                    .expect("changed")
                    .contains(&json!("last_completed_at"))
            );
            assert!(last.get("body").is_none(), "complete never records a body");
        });
    }

    #[test]
    fn a_one_off_completion_clears_the_due_date() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("oneoff@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");

            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Clear the desk",
                        "properties": { "due_date": day(0) }
                    })),
                    Some(&cookie),
                )
                .await;
            let id = created.body["id"].as_str().expect("an id").to_owned();
            let completed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.body);
            assert!(completed.body["properties"].get("due_date").is_none());
            assert_eq!(completed.body["schedule"]["status"], "done");
            assert!(completed.body["schedule"].get("days_until_due").is_none());

            let agenda = server
                .call("GET", &format!("{base}/agenda"), None, Some(&cookie))
                .await;
            assert_eq!(agenda.status, StatusCode::OK);
            assert_eq!(agenda.body["overdue"], json!([]));
            assert_eq!(agenda.body["due_today"], json!([]));
            assert_eq!(agenda.body["upcoming"], json!([]));
            assert_eq!(agenda.body["later_count"], 0);
        });
    }

    #[test]
    fn completing_an_unscheduled_or_trashed_record_is_refused() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("refuse@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let base = format!("/api/spaces/{space}");
            server
                .call(
                    "POST",
                    &format!("{base}/types"),
                    Some(json!({ "name": "Plant" })),
                    Some(&cookie),
                )
                .await;
            let plant = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({ "type": "plant", "title": "Monstera" })),
                    Some(&cookie),
                )
                .await;
            let plant_id = plant.body["id"].as_str().expect("an id").to_owned();
            let unscheduled = server
                .call(
                    "POST",
                    &format!("{base}/objects/{plant_id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unscheduled.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unscheduled.field(), "schedule");

            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");
            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({ "type": "chore", "title": "Sweep" })),
                    Some(&cookie),
                )
                .await;
            let id = created.body["id"].as_str().expect("an id").to_owned();
            server
                .call(
                    "DELETE",
                    &format!("{base}/objects/{id}"),
                    None,
                    Some(&cookie),
                )
                .await;
            let trashed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(trashed.status, StatusCode::NOT_FOUND);
            assert_eq!(trashed.code(), "not_found");
        });
    }

    #[test]
    fn the_agenda_buckets_by_calendar_day_and_horizon() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("agenda@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");
            for (title, properties) in [
                (
                    "Overdue",
                    json!({ "due_date": day(-1), "recurrence": { "kind": "days", "every": 3 } }),
                ),
                ("Today", json!({ "due_date": day(0) })),
                ("Tomorrow", json!({ "due_date": day(1) })),
                ("Later", json!({ "due_date": day(20) })),
                (
                    "Done",
                    json!({ "last_completed_at": "2026-10-21T07:12:00Z" }),
                ),
            ] {
                let created = server
                    .call(
                        "POST",
                        &format!("{base}/objects"),
                        Some(json!({
                            "type": "chore",
                            "title": title,
                            "properties": properties,
                        })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            }

            let agenda = server
                .call(
                    "GET",
                    &format!("{base}/agenda?days=14"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(agenda.status, StatusCode::OK, "{:?}", agenda.body);
            assert_eq!(agenda.body["today"], day(0));
            assert_eq!(agenda.body["timezone"], "UTC");
            assert_eq!(agenda.body["overdue"][0]["title"], "Overdue");
            assert_eq!(agenda.body["overdue"][0]["status"], "overdue");
            assert_eq!(agenda.body["overdue"][0]["days_until_due"], -1);
            assert_eq!(agenda.body["overdue"][0]["recurrence"], "Every 3 days");
            assert_eq!(agenda.body["overdue"][0]["type_name"], "Chore");
            assert_eq!(agenda.body["due_today"][0]["title"], "Today");
            assert_eq!(agenda.body["upcoming"][0]["title"], "Tomorrow");
            assert_eq!(agenda.body["later_count"], 1);
            let titles: Vec<&str> = agenda.body["overdue"]
                .as_array()
                .expect("overdue")
                .iter()
                .chain(agenda.body["due_today"].as_array().expect("today"))
                .chain(agenda.body["upcoming"].as_array().expect("upcoming"))
                .map(|row| row["title"].as_str().expect("a title"))
                .collect();
            assert_eq!(titles, vec!["Overdue", "Today", "Tomorrow"]);

            let invalid = server
                .call("GET", &format!("{base}/agenda?days=0"), None, Some(&cookie))
                .await;
            assert_eq!(invalid.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(invalid.field(), "days");
        });
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

    /// One view of a type detail, by key.
    fn view<'a>(detail: &'a Value, key: &str) -> &'a Value {
        detail["views"]
            .as_array()
            .expect("views")
            .iter()
            .find(|view| view["key"] == key)
            .expect("the named view")
    }

    #[test]
    fn view_routes_mint_keys_rename_and_promote_the_default() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("views@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}/types/plant", garden.space);
            let views = format!("{base}/views");

            let board = server
                .call(
                    "POST",
                    &views,
                    Some(json!({ "name": "By room", "kind": "board", "group_by": "room" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(board.status, StatusCode::CREATED, "{:?}", board.body);
            assert_eq!(board.body["default_view"], "all");
            let by_room = view(&board.body, "by_room");
            assert_eq!(by_room["kind"], "board");
            assert_eq!(by_room["group_by"], "room");
            assert_eq!(by_room["columns"], json!(["title"]));

            let duplicate = server
                .call(
                    "POST",
                    &views,
                    Some(json!({ "name": "By room", "kind": "gallery", "cover": "room" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(duplicate.status, StatusCode::CONFLICT);
            assert_eq!(duplicate.code(), "conflict");

            let gallery = server
                .call(
                    "POST",
                    &views,
                    Some(json!({
                        "name": "Gallery",
                        "kind": "gallery",
                        "cover": "room",
                        "columns": ["title", "room"]
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(gallery.status, StatusCode::CREATED, "{:?}", gallery.body);
            assert_eq!(view(&gallery.body, "gallery")["cover"], "room");

            let renamed = server
                .call(
                    "PATCH",
                    &format!("{views}/by_room"),
                    Some(json!({ "name": "Rooms" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(renamed.status, StatusCode::OK, "{:?}", renamed.body);
            assert_eq!(view(&renamed.body, "by_room")["name"], "Rooms");
            assert_eq!(view(&renamed.body, "by_room")["kind"], "board");

            let kind = server
                .call(
                    "PATCH",
                    &format!("{views}/by_room"),
                    Some(json!({ "kind": "table" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(kind.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(kind.field(), "body");

            let chosen = server
                .call(
                    "POST",
                    &format!("{views}/by_room/default"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(chosen.status, StatusCode::OK, "{:?}", chosen.body);
            assert_eq!(chosen.body["default_view"], "by_room");

            // The file order is all, by_room, gallery: deleting the default
            // promotes the view that followed it.
            let removed = server
                .call("DELETE", &format!("{views}/by_room"), None, Some(&cookie))
                .await;
            assert_eq!(removed.status, StatusCode::OK, "{:?}", removed.body);
            assert_eq!(removed.body["default_view"], "gallery");

            let only = create_space(&server, &cookie, "Only").await;
            server
                .call(
                    "POST",
                    &format!("/api/spaces/{only}/types"),
                    Some(json!({ "name": "Plant" })),
                    Some(&cookie),
                )
                .await;
            let last = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{only}/types/plant/views/all"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(last.status, StatusCode::CONFLICT);
            assert_eq!(
                last.body["error"]["details"]["reason"],
                "a type needs at least one view"
            );
        });
    }

    #[test]
    fn a_view_must_name_a_property_its_kind_can_use() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("viewrules@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let views = format!("/api/spaces/{}/types/plant/views", garden.space);

            for (body, field) in [
                (
                    json!({ "name": "No lane", "kind": "board" }),
                    "views.no_lane.group_by",
                ),
                (
                    json!({ "name": "Wrong lane", "kind": "board", "group_by": "title" }),
                    "views.wrong_lane.group_by",
                ),
                (
                    json!({ "name": "No date", "kind": "calendar" }),
                    "views.no_date.date_property",
                ),
                (
                    json!({ "name": "Title cover", "kind": "gallery", "cover": "title" }),
                    "views.title_cover.cover",
                ),
            ] {
                let refused = server.call("POST", &views, Some(body), Some(&cookie)).await;
                assert_eq!(
                    refused.status,
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "{:?}",
                    refused.body
                );
                assert_eq!(refused.field(), field, "{:?}", refused.body);
            }
        });
    }

    #[test]
    fn member_removal_property_deletion_and_schedule_disable_respect_views() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("deps@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}/types/plant", garden.space);
            let views = format!("{base}/views");

            server
                .call(
                    "PATCH",
                    &format!("{views}/all"),
                    Some(json!({ "columns": ["title", "room"] })),
                    Some(&cookie),
                )
                .await;
            server
                .call(
                    "POST",
                    &views,
                    Some(json!({ "name": "By room", "kind": "board", "group_by": "room" })),
                    Some(&cookie),
                )
                .await;
            server
                .call(
                    "POST",
                    &views,
                    Some(json!({
                        "name": "Gallery",
                        "kind": "gallery",
                        "cover": "room",
                        "columns": ["title", "room"]
                    })),
                    Some(&cookie),
                )
                .await;

            let refused = server
                .call(
                    "PATCH",
                    &base,
                    Some(json!({ "properties": [] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(refused.field(), "views.by_room.group_by");

            let guarded = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{}/properties/room?force=true", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(guarded.status, StatusCode::CONFLICT);
            assert_eq!(
                guarded.body["error"]["details"]["views"][0]["type"],
                "plant"
            );
            assert_eq!(
                guarded.body["error"]["details"]["views"][0]["view"],
                "by_room"
            );
            assert_eq!(
                guarded.body["error"]["details"]["views"][0]["field"],
                "group_by"
            );

            let renamed = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/properties/room/rename", garden.space),
                    Some(json!({ "key": "area" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(renamed.status, StatusCode::OK, "{:?}", renamed.body);
            let detail = server.call("GET", &base, None, Some(&cookie)).await;
            assert_eq!(
                view(&detail.body, "all")["columns"],
                json!(["title", "area"])
            );
            assert_eq!(view(&detail.body, "by_room")["group_by"], "area");
            assert_eq!(view(&detail.body, "gallery")["cover"], "area");
            assert_eq!(
                view(&detail.body, "gallery")["columns"],
                json!(["title", "area"])
            );

            for key in ["by_room", "gallery"] {
                let removed = server
                    .call("DELETE", &format!("{views}/{key}"), None, Some(&cookie))
                    .await;
                assert_eq!(removed.status, StatusCode::OK, "{:?}", removed.body);
            }
            let stripped = server
                .call(
                    "PATCH",
                    &base,
                    Some(json!({ "properties": [] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stripped.status, StatusCode::OK, "{:?}", stripped.body);
            assert_eq!(view(&stripped.body, "all")["columns"], json!(["title"]));

            let chores = chore_space(&server, &cookie).await;
            let calendar = server
                .call(
                    "POST",
                    &format!("/api/spaces/{chores}/types/chore/views"),
                    Some(json!({
                        "name": "Calendar",
                        "kind": "calendar",
                        "date_property": "due_date"
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(calendar.status, StatusCode::CREATED, "{:?}", calendar.body);
            assert_eq!(view(&calendar.body, "calendar")["columns"], json!([]));

            let blocked = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{chores}/types/chore"),
                    Some(json!({ "schedule": false })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(blocked.status, StatusCode::CONFLICT);
            assert_eq!(
                blocked.body["error"]["details"]["views"],
                json!(["calendar"])
            );

            let removed = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{chores}/types/chore/views/calendar"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(removed.status, StatusCode::OK, "{:?}", removed.body);
            let disabled = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{chores}/types/chore"),
                    Some(json!({ "schedule": false })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(disabled.status, StatusCode::OK, "{:?}", disabled.body);
            assert_eq!(disabled.body["views"][0]["columns"], json!(["title"]));
        });
    }

    #[test]
    fn an_object_list_resolves_a_view_and_projects_its_fields() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("lists@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let base = format!("/api/spaces/{space}");
            let types = format!("{base}/types");
            let views = format!("{types}/plant/views");
            let objects = format!("{base}/objects");

            server
                .call(
                    "POST",
                    &format!("{base}/properties"),
                    Some(json!({
                        "name": "Room",
                        "format": "select",
                        "options": [{ "name": "Kitchen" }, { "name": "Study" }]
                    })),
                    Some(&cookie),
                )
                .await;
            server
                .call(
                    "POST",
                    &format!("{base}/properties"),
                    Some(json!({ "name": "Planted on", "format": "date" })),
                    Some(&cookie),
                )
                .await;
            server
                .call(
                    "POST",
                    &types,
                    Some(json!({ "name": "Plant" })),
                    Some(&cookie),
                )
                .await;
            server
                .call(
                    "PATCH",
                    &format!("{types}/plant"),
                    Some(json!({
                        "properties": [{ "key": "room" }, { "key": "planted_on" }]
                    })),
                    Some(&cookie),
                )
                .await;
            for (title, properties) in [
                (
                    "Monstera",
                    json!({ "room": "kitchen", "planted_on": "2026-10-20" }),
                ),
                ("Fern", json!({ "room": "study" })),
            ] {
                let created = server
                    .call(
                        "POST",
                        &objects,
                        Some(json!({
                            "type": "plant",
                            "title": title,
                            "properties": properties
                        })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            }
            for body in [
                json!({
                    "name": "By room",
                    "kind": "board",
                    "group_by": "room",
                    "columns": ["title", "planted_on"]
                }),
                json!({
                    "name": "Gallery",
                    "kind": "gallery",
                    "cover": "room",
                    "columns": ["title"]
                }),
                json!({
                    "name": "Calendar",
                    "kind": "calendar",
                    "date_property": "planted_on"
                }),
            ] {
                let created = server.call("POST", &views, Some(body), Some(&cookie)).await;
                assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            }
            server
                .call(
                    "POST",
                    &format!("{views}/calendar/default"),
                    None,
                    Some(&cookie),
                )
                .await;

            let board = server
                .call(
                    "GET",
                    &format!("{objects}?type=plant&view=by_room"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(board.status, StatusCode::OK, "{:?}", board.body);
            assert_eq!(board.body["view"], "by_room");
            assert_eq!(board.body["total"], 2);
            let monstera = board.body["objects"]
                .as_array()
                .expect("rows")
                .iter()
                .find(|row| row["title"] == "Monstera")
                .expect("Monstera");
            assert!(monstera["values"].get("room").is_some());
            assert!(monstera["values"].get("planted_on").is_some());

            let gallery = server
                .call(
                    "GET",
                    &format!("{objects}?type=plant&view=gallery"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(gallery.body["view"], "gallery");
            let monstera = gallery.body["objects"]
                .as_array()
                .expect("rows")
                .iter()
                .find(|row| row["title"] == "Monstera")
                .expect("Monstera");
            assert!(
                monstera["values"].get("room").is_some(),
                "the cover property travels even when it is not a column"
            );
            assert!(monstera["values"].get("planted_on").is_none());

            let calendar = server
                .call(
                    "GET",
                    &format!("{objects}?type=plant&view=calendar"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(calendar.body["view"], "calendar");
            let monstera = calendar.body["objects"]
                .as_array()
                .expect("rows")
                .iter()
                .find(|row| row["title"] == "Monstera")
                .expect("Monstera");
            assert!(
                monstera["values"].get("planted_on").is_some(),
                "a calendar's date property travels though its columns are empty"
            );

            let unknown = server
                .call(
                    "GET",
                    &format!("{objects}?type=plant&view=nope"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unknown.field(), "view");

            // No `view`: the default is the calendar, and a relation picker
            // still gets the id, title and type it reads.
            let default = server
                .call("GET", &format!("{objects}?type=plant"), None, Some(&cookie))
                .await;
            assert_eq!(default.status, StatusCode::OK, "{:?}", default.body);
            assert_eq!(default.body["view"], "calendar");
            let first = &default.body["objects"][0];
            assert!(first.get("id").is_some());
            assert!(first.get("title").is_some());
            assert_eq!(first["type"], "plant");

            let filtered = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=gallery&filter={}",
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
            assert_eq!(filtered.status, StatusCode::OK, "{:?}", filtered.body);
            assert_eq!(filtered.body["total"], 1);

            let sorted = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=gallery&sorts={}",
                        url_encoded(
                            &json!([{ "property": "title", "direction": "asc" }]).to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(sorted.status, StatusCode::OK, "{:?}", sorted.body);
            assert_eq!(sorted.body["objects"][0]["title"], "Fern");
        });
    }
}
