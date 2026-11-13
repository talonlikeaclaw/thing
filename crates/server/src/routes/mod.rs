//! The HTTP surface: routing, the shared request plumbing, and the SPA fallback.
//!
//! Every error leaves as the same `{"error":{code,message,details}}` envelope,
//! including a malformed body or path parameter — which is why requests are
//! extracted through [`ApiJson`] and parsed with [`uuid_param`] rather than
//! axum's own rejections.

mod auth;
mod csv;
mod files;
mod objects;
mod promote;
mod properties;
mod search;
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
        .merge(search::routes())
        .merge(files::routes())
        .merge(objects::routes())
        .merge(promote::routes())
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

/// A cover is an attachment path or nothing; `""` clears it and any other
/// spelling the space could not serve is refused.
pub fn clean_cover(cover: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(cover) = cover else {
        return Ok(None);
    };
    let cover = cover.trim();
    if cover.is_empty() {
        return Ok(None);
    }
    if !thing_core::store::is_file_path(std::path::Path::new(cover)) {
        return Err(ApiError::validation("cover", "expected a file path"));
    }
    Ok(Some(cover.to_owned()))
}

/// A cover focal point is two percentages, or nothing; `""` returns the centre
/// and any other spelling is refused by the grammar the frontmatter uses.
pub fn clean_cover_position(position: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(position) = position else {
        return Ok(None);
    };
    let position = position.trim();
    if position.is_empty() {
        return Ok(None);
    }
    let Some((x, y)) = thing_core::model::parse_cover_position(position) else {
        return Err(ApiError::validation(
            "cover_position",
            "expected two percentages, for example 50% 35%",
        ));
    };
    Ok(Some(format!("{x}% {y}%")))
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
        "missing_files": problems
            .missing_files
            .iter()
            .map(|missing| json!({
                "object": missing.object,
                "path": missing.path,
                "field": missing.field,
                "file": missing.file,
            }))
            .collect::<Vec<_>>(),
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
        "computed_problems": problems
            .computed_problems
            .iter()
            .map(|problem| json!({
                "property": problem.property_key,
                "type": problem.type_key,
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
    use thing_core::store::SpaceStore;
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
    fn an_owner_sets_the_shared_accent_and_a_non_owner_cannot() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let garden = create_space(&server, &owner_cookie, "Garden").await;
            let work = create_space(&server, &owner_cookie, "Work").await;

            let set = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "accent": "cyan" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(set.status, StatusCode::OK, "{:?}", set.body);
            assert_eq!(set.body["accent"], "cyan");

            let written = std::fs::read_to_string(
                server
                    ._root
                    .path()
                    .join("spaces")
                    .join(&garden)
                    .join("space.yml"),
            )
            .expect("space.yml");
            assert!(written.starts_with("schema: 8\n"), "{written}");
            assert!(written.contains("accent: cyan\n"), "{written}");

            // A second space has its own appearance.
            let other = server
                .call(
                    "GET",
                    &format!("/api/spaces/{work}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(other.body["accent"], Value::Null);

            // An uppercase name is normalized rather than refused.
            let upper = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "accent": "CYAN" })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(upper.status, StatusCode::OK);
            assert_eq!(upper.body["accent"], "cyan");

            // `null` returns the space to Lichen and drops the key.
            let cleared = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "accent": null })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(cleared.status, StatusCode::OK);
            assert_eq!(cleared.body["accent"], Value::Null);
            let written = std::fs::read_to_string(
                server
                    ._root
                    .path()
                    .join("spaces")
                    .join(&garden)
                    .join("space.yml"),
            )
            .expect("space.yml");
            assert!(!written.contains("accent:"), "{written}");

            for raw in [json!("chartreuse"), json!("#c8d96b")] {
                let refused = server
                    .call(
                        "PATCH",
                        &format!("/api/spaces/{garden}"),
                        Some(json!({ "accent": raw })),
                        Some(&owner_cookie),
                    )
                    .await;
                assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
                assert_eq!(refused.field(), "accent");
            }

            // A viewer cannot change the shared appearance.
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
            let forbidden = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{garden}"),
                    Some(json!({ "accent": "green" })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(forbidden.status, StatusCode::FORBIDDEN);
            assert_eq!(forbidden.code(), "forbidden");
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
    fn the_activity_feed_names_the_newest_writes_and_what_they_changed() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("activity@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let second = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "Fern by the window" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(second.status, StatusCode::CREATED, "{:?}", second.body);
            let second_id = second.body["id"].as_str().expect("an id").to_owned();

            // Writes are ordered by their own timestamps, so let the clock move.
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({ "rev": 1, "properties": { "room": "study" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let feed = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/activity", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(feed.status, StatusCode::OK, "{:?}", feed.body);
            let entries = feed.body["entries"].as_array().expect("entries");
            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0]["id"], garden.plant.as_str());
            assert_eq!(entries[0]["action"], "update");
            assert_eq!(entries[0]["rev"], 2);
            assert_eq!(entries[0]["changed"], json!(["room"]));
            assert_eq!(entries[0]["type"], "plant");
            assert_eq!(entries[1]["id"], second_id.as_str());
            assert_eq!(entries[1]["action"], "create");

            let one = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/activity?limit=1", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(one.body["entries"].as_array().expect("entries").len(), 1);
        });
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
            assert!(raw.text().starts_with("---\nschema: 8\n"));

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
    fn search_reads_titles_and_bodies_and_refuses_bad_parameters() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("search@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}", garden.space);

            let chore_type = server
                .call(
                    "POST",
                    &format!("{base}/types"),
                    Some(json!({ "name": "Chore" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                chore_type.status,
                StatusCode::CREATED,
                "{:?}",
                chore_type.body
            );
            let chore = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Water the ficus",
                        "body": "\nThe soil stays moist near the roots.\n",
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(chore.status, StatusCode::CREATED, "{:?}", chore.body);

            let moist = server
                .call(
                    "GET",
                    &format!("{base}/search?q=moist"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(moist.status, StatusCode::OK, "{:?}", moist.body);
            assert_eq!(moist.body["query"], "moist");
            assert_eq!(moist.body["total"], 1);
            assert_eq!(moist.body["results"][0]["type"], "chore");
            assert_eq!(moist.body["results"][0]["type_name"], "Chore");
            assert_eq!(moist.body["results"][0]["title"], "Water the ficus");
            assert!(
                moist.body["results"][0]["snippet"]
                    .as_str()
                    .is_some_and(|text| text.contains("moist")),
                "{:?}",
                moist.body
            );

            let watered = server
                .call(
                    "GET",
                    &format!("{base}/search?q=watered"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(watered.body["total"], 1);
            assert_eq!(watered.body["results"][0]["type"], "plant");

            let both = server
                .call(
                    "GET",
                    &format!("{base}/search?q={}", url_encoded("water ficus")),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(both.body["total"], 1);
            assert_eq!(both.body["results"][0]["type"], "chore");

            let ranked = server
                .call(
                    "GET",
                    &format!("{base}/search?q=water"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(ranked.body["total"], 2);
            assert_eq!(
                ranked.body["results"][0]["type"], "chore",
                "a title phrase ranks above a body hit"
            );

            let filtered = server
                .call(
                    "GET",
                    &format!("{base}/search?q=water&type=plant"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(filtered.status, StatusCode::OK, "{:?}", filtered.body);
            assert_eq!(filtered.body["total"], 1);
            assert_eq!(filtered.body["results"][0]["type"], "plant");

            let paged = server
                .call(
                    "GET",
                    &format!("{base}/search?q=water&limit=1"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(paged.body["total"], 2);
            assert_eq!(paged.body["results"].as_array().map(Vec::len), Some(1));

            for (uri, field) in [
                (format!("{base}/search"), "q"),
                (format!("{base}/search?q="), "q"),
                (format!("{base}/search?q=%20%20"), "q"),
                (format!("{base}/search?q=water&limit=0"), "limit"),
                (format!("{base}/search?q=water&limit=51"), "limit"),
                (format!("{base}/search?q=water&limit=nope"), "limit"),
                (format!("{base}/search?q=water&type=ghost"), "type"),
                (format!("{base}/search?q=water&nonsense=1"), "nonsense"),
            ] {
                let refused = server.call("GET", &uri, None, Some(&cookie)).await;
                assert_eq!(
                    refused.status,
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "{uri}: {:?}",
                    refused.body
                );
                assert_eq!(refused.field(), field, "{uri}");
            }
            let long = "a".repeat(201);
            let refused = server
                .call(
                    "GET",
                    &format!("{base}/search?q={}", url_encoded(&long)),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(refused.field(), "q");

            let invite = server
                .call(
                    "POST",
                    &format!("{base}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(invite.status, StatusCode::CREATED, "{:?}", invite.body);
            let code = invite.body["code"].as_str().expect("an invite").to_owned();
            let viewer = server
                .register("search-viewer@example.com", Some(&code))
                .await;
            assert_eq!(viewer.status, StatusCode::CREATED, "{:?}", viewer.body);
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let viewed = server
                .call(
                    "GET",
                    &format!("{base}/search?q=moist"),
                    None,
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(viewed.status, StatusCode::OK, "{:?}", viewed.body);

            let work = create_space(&server, &cookie, "Work").await;
            let work_invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{work}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                work_invite.status,
                StatusCode::CREATED,
                "{:?}",
                work_invite.body
            );
            let work_code = work_invite.body["code"]
                .as_str()
                .expect("a work invite")
                .to_owned();
            let stranger = server
                .register("search-stranger@example.com", Some(&work_code))
                .await;
            assert_eq!(stranger.status, StatusCode::CREATED, "{:?}", stranger.body);
            let stranger_cookie = cookie_of(&stranger).to_owned();
            let foreign = server
                .call(
                    "GET",
                    &format!("{base}/search?q=moist"),
                    None,
                    Some(&stranger_cookie),
                )
                .await;
            assert_eq!(foreign.status, StatusCode::NOT_FOUND);

            let trashed = server
                .call(
                    "DELETE",
                    &format!("{base}/objects/{}", garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);
            let gone = server
                .call(
                    "GET",
                    &format!("{base}/search?q=watered"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(gone.body["total"], 0, "trash leaves the index");
        });
    }

    #[test]
    fn a_record_read_returns_links_and_both_kinds_of_backlink() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("links@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}", garden.space);

            let related = server
                .call(
                    "POST",
                    &format!("{base}/properties"),
                    Some(json!({
                        "name": "Related plant",
                        "format": "relation",
                        "target_type": "plant",
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(related.status, StatusCode::CREATED, "{:?}", related.body);
            let related_key = related.body["key"].as_str().expect("a key").to_owned();

            let chore_type = server
                .call(
                    "POST",
                    &format!("{base}/types"),
                    Some(json!({ "name": "Chore" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                chore_type.status,
                StatusCode::CREATED,
                "{:?}",
                chore_type.body
            );
            let patched = server
                .call(
                    "PATCH",
                    &format!("{base}/types/chore"),
                    Some(json!({ "properties": [{ "key": related_key }] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            for _ in 0..2 {
                let twin = server
                    .call(
                        "POST",
                        &format!("{base}/objects"),
                        Some(json!({ "type": "plant", "title": "Twin" })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(twin.status, StatusCode::CREATED, "{:?}", twin.body);
            }

            let body = "Linked to [[plant/Monstera in the study]].\n\n\
                        Unknown [[plant/Ghost fern]].\n\n\
                        Ambiguous [[plant/Twin]].\n\n\
                        ```\n[[plant/Monstera in the study]]\n```\n\n\
                        Inline `[[plant/Monstera in the study]]`.";
            let mut properties = serde_json::Map::new();
            properties.insert(related_key.clone(), json!(garden.plant));
            let chore = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Read the notes",
                        "properties": Value::Object(properties),
                        "body": body,
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(chore.status, StatusCode::CREATED, "{:?}", chore.body);
            let chore_id = chore.body["id"].as_str().expect("an id").to_owned();

            let read = server
                .call(
                    "GET",
                    &format!("{base}/objects/{chore_id}?with=links,backlinks"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
            let links = read.body["links"].as_array().expect("links");
            assert_eq!(links.len(), 3, "{links:?}");
            let found = links
                .iter()
                .find(|row| row["title"] == "Monstera in the study")
                .expect("the resolved link");
            assert_eq!(found["status"], "ok");
            assert_eq!(found["id"].as_str(), Some(garden.plant.as_str()));
            assert_eq!(found["type"], "plant");
            let unknown = links
                .iter()
                .find(|row| row["title"] == "Ghost fern")
                .expect("the unknown link");
            assert_eq!(unknown["status"], "unknown");
            assert!(unknown.get("id").is_none(), "an unknown link has no id");
            let ambiguous = links
                .iter()
                .find(|row| row["title"] == "Twin")
                .expect("the ambiguous link");
            assert_eq!(ambiguous["status"], "ambiguous");
            assert!(ambiguous.get("id").is_none());

            let links_to = read.body["links_to"].as_array().expect("links_to");
            assert_eq!(links_to.len(), 2, "{links_to:?}");
            assert_eq!(links_to[0]["kind"], "relation");
            assert_eq!(links_to[0]["id"], garden.plant);
            assert_eq!(links_to[0]["type"], "plant");
            assert_eq!(links_to[0]["title"], "Monstera in the study");
            assert_eq!(links_to[0]["property"], related_key);
            assert_eq!(links_to[0]["property_name"], "Related plant");
            assert_eq!(links_to[1]["kind"], "mention");
            assert_eq!(links_to[1]["id"], garden.plant);
            assert!(links_to[1].get("property").is_none());
            assert!(
                !links_to
                    .iter()
                    .any(|row| row["title"] == "Ghost fern" || row["title"] == "Twin"),
                "unknown and ambiguous links are not targets"
            );

            let plant = server
                .call(
                    "GET",
                    &format!("{base}/objects/{}?with=backlinks", garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert!(
                plant.body.get("links_to").is_none(),
                "links_to belongs to with=links only"
            );
            let backlinks = plant.body["backlinks"].as_array().expect("backlinks");
            assert_eq!(backlinks.len(), 2, "{backlinks:?}");
            let relation = backlinks
                .iter()
                .find(|row| row["kind"] == "relation")
                .expect("the relation backlink");
            assert_eq!(relation["id"], chore_id);
            assert_eq!(relation["property"], related_key);
            assert_eq!(relation["property_name"], "Related plant");
            let mention = backlinks
                .iter()
                .find(|row| row["kind"] == "mention")
                .expect("the mention backlink");
            assert_eq!(mention["id"], chore_id);
            assert_eq!(mention["count"], 1, "code and inline code do not count");
            assert!(
                mention["snippet"]
                    .as_str()
                    .is_some_and(|text| text.contains("Monstera")),
                "{:?}",
                mention["snippet"]
            );

            let graph = server
                .call("GET", &format!("{base}/graph"), None, Some(&cookie))
                .await;
            assert_eq!(graph.status, StatusCode::OK, "{:?}", graph.body);
            let graph_nodes = graph.body["nodes"].as_array().expect("graph nodes");
            assert!(graph_nodes.iter().any(|node| node["id"] == chore_id));
            let edge = graph.body["edges"]
                .as_array()
                .expect("graph edges")
                .iter()
                .find(|edge| edge["source"] == chore_id && edge["target"] == garden.plant)
                .expect("the relation and mention share one edge");
            assert_eq!(edge["kind"], "relation");
            assert_eq!(edge["mention"], true, "the body link is not lost");

            let trashed = server
                .call(
                    "DELETE",
                    &format!("{base}/objects/{chore_id}"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);
            let after = server
                .call(
                    "GET",
                    &format!("{base}/objects/{}?with=backlinks", garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                after.body["backlinks"].as_array().map(Vec::len),
                Some(0),
                "a trashed source leaves both groups"
            );
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
            assert!(raw.text().starts_with("---\nschema: 8\n"), "{}", raw.text());
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
    fn a_display_round_trips_and_a_format_refuses_what_it_cannot_show() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("display@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let properties = format!("/api/spaces/{}/properties", garden.space);
            let amount = format!("{properties}/amount");

            let created = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({
                        "name": "Amount",
                        "format": "number",
                        "display": { "currency": "USD" },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            assert_eq!(created.body["display"], json!({ "currency": "USD" }));

            // The block is stored, not just echoed: a read agrees.
            let reread = server.call("GET", &amount, None, Some(&cookie)).await;
            assert_eq!(reread.body["display"], json!({ "currency": "USD" }));

            let full = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({
                        "display": {
                            "align": "right",
                            "currency": "USD",
                            "decimals": 2,
                            "grouping": false,
                        },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(full.status, StatusCode::OK, "{:?}", full.body);
            assert_eq!(
                full.body["display"],
                json!({
                    "align": "right",
                    "currency": "USD",
                    "decimals": 2,
                    "grouping": false,
                })
            );

            // `auto` is the absent spelling, so it is stored as nothing.
            let auto = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({ "display": { "align": "auto", "decimals": 1 } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(auto.status, StatusCode::OK, "{:?}", auto.body);
            assert_eq!(auto.body["display"], json!({ "decimals": 1 }));

            // `null` clears the block; leaving it out leaves it alone.
            let kept = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({ "name": "Cost" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(kept.body["display"], json!({ "decimals": 1 }));
            let cleared = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({ "display": null })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(cleared.status, StatusCode::OK, "{:?}", cleared.body);
            assert_eq!(cleared.body.get("display"), None);

            // A text property cannot carry a number's display, on either writer.
            let on_text = server
                .call(
                    "PATCH",
                    &format!("{properties}/room"),
                    Some(json!({ "display": { "currency": "USD" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(on_text.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(on_text.field(), "display.currency");
            assert_eq!(
                on_text.body["error"]["message"],
                "belongs to number properties only"
            );
            let stored_text = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({
                        "name": "Rate",
                        "format": "text",
                        "display": { "decimals": 2 },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stored_text.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(stored_text.field(), "display.decimals");

            let too_many = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({ "display": { "decimals": 5 } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(too_many.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(too_many.field(), "display.decimals");
            assert_eq!(too_many.body["error"]["message"], "must be 0 to 4");

            let malformed = server
                .call(
                    "PATCH",
                    &amount,
                    Some(json!({ "display": { "currency": "usd" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(malformed.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(malformed.field(), "display.currency");
        });
    }

    #[test]
    fn a_cover_patches_clears_and_reaches_every_projection() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("cover@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let objects = format!("/api/spaces/{}/objects", garden.space);
            let hash = "a".repeat(64);
            let cover = format!("files/{hash}/monstera-photo.png");
            let health_path = format!("/api/spaces/{}/health", garden.space);

            let created = server
                .call(
                    "POST",
                    &objects,
                    Some(json!({
                        "type": "plant",
                        "title": "Fern",
                        "cover": cover,
                        "cover_position": "61% 38%",
                        "properties": { "room": "study" },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            assert_eq!(created.body["cover"], cover.as_str());
            assert_eq!(created.body["cover_position"], "61% 38%");
            let fern = created.body["id"].as_str().expect("an id").to_owned();
            let fern_path = format!("/api/spaces/{}/objects/{fern}", garden.space);

            // A patch that omits the cover keeps it; leaving it out is not a clear.
            let retitled = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 1, "title": "Boston fern" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(retitled.status, StatusCode::OK, "{:?}", retitled.body);
            assert_eq!(retitled.body["cover"], cover.as_str());
            assert_eq!(retitled.body["cover_position"], "61% 38%");

            let malformed_position = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 2, "cover_position": "left" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                malformed_position.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                malformed_position.body
            );
            assert_eq!(malformed_position.field(), "cover_position");

            let repositioned = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 2, "cover_position": "10% 90%" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                repositioned.status,
                StatusCode::OK,
                "{:?}",
                repositioned.body
            );
            assert_eq!(repositioned.body["cover_position"], "10% 90%");

            let malformed = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 2, "cover": "../../etc/passwd" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                malformed.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                malformed.body
            );
            assert_eq!(malformed.field(), "cover");

            let cleared = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 3, "cover": null })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(cleared.status, StatusCode::OK, "{:?}", cleared.body);
            assert!(
                cleared.body.get("cover").is_none(),
                "null clears the key: {:?}",
                cleared.body
            );
            assert!(
                cleared.body.get("cover_position").is_none(),
                "clearing the cover clears its framing: {:?}",
                cleared.body
            );

            let no_cover_position = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 4, "cover_position": "20% 20%" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(no_cover_position.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(no_cover_position.field(), "cover_position");

            let reset = server
                .call(
                    "PATCH",
                    &fern_path,
                    Some(json!({ "rev": 4, "cover": cover, "cover_position": "61% 38%" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(reset.body["rev"], 5);
            assert_eq!(reset.body["cover_position"], "61% 38%");

            let list = server
                .call("GET", &format!("{objects}?type=plant"), None, Some(&cookie))
                .await;
            let row = list.body["objects"]
                .as_array()
                .expect("rows")
                .iter()
                .find(|row| row["title"] == "Boston fern")
                .expect("the renamed row");
            assert_eq!(row["cover"], cover.as_str());
            assert_eq!(row["cover_position"], "61% 38%");

            let raw = server
                .call_raw("GET", &format!("{fern_path}/raw"), None, &[], Some(&cookie))
                .await;
            assert!(
                raw.text().contains(&format!("\ncover: {cover}\n")),
                "{}",
                raw.text()
            );
            assert!(
                raw.text().contains("\ncover_position: 61% 38%\n"),
                "{}",
                raw.text()
            );

            let history = server
                .call("GET", &format!("{fern_path}/history"), None, Some(&cookie))
                .await;
            let lines = history.body.as_array().expect("lines");
            assert_eq!(lines.len(), 5);
            assert_eq!(lines[0]["snapshot"]["cover"], cover.as_str());
            assert_eq!(lines[0]["snapshot"]["cover_position"], "61% 38%");
            assert!(
                lines[1]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .all(|key| key != "cover"),
                "a title write does not report the cover: {:?}",
                lines[1]
            );
            assert!(
                lines[2]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .any(|key| key == "cover_position")
            );
            assert!(
                lines[3]["changed"]
                    .as_array()
                    .expect("changed")
                    .iter()
                    .any(|key| key == "cover")
                    && lines[3]["changed"]
                        .as_array()
                        .expect("changed")
                        .iter()
                        .any(|key| key == "cover_position")
            );

            // The bytes are not in the space: the write stands and health says so.
            let health = server.call("GET", &health_path, None, Some(&cookie)).await;
            let missing = health.body["missing_files"].as_array().expect("missing");
            assert!(
                missing.iter().any(|item| item["object"] == fern.as_str()
                    && item["field"] == "cover"
                    && item["file"] == cover.as_str()),
                "{:?}",
                health.body
            );

            // A duplicate shares the same path; no bytes were copied.
            let copy = server
                .call(
                    "POST",
                    &format!("{fern_path}/duplicate"),
                    Some(json!({})),
                    Some(&cookie),
                )
                .await;
            assert_eq!(copy.status, StatusCode::CREATED, "{:?}", copy.body);
            assert_eq!(copy.body["cover"], cover.as_str());
            assert_eq!(copy.body["cover_position"], "61% 38%");

            // `cover` is a frontmatter key, so a property may not take it.
            let reserved = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/properties", garden.space),
                    Some(json!({ "name": "Cover", "format": "text" })),
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
    fn a_rename_moves_computed_references_and_a_holder_refuses_removal() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed-rename@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let world = computed_garden(&server, &cookie).await;
            let space = world.space.clone();

            let renamed = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/properties/room/rename"),
                    Some(json!({ "key": "space" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(renamed.status, StatusCode::OK, "{:?}", renamed.body);

            // The formula names the new key, so the label still concatenates.
            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/objects?type=plant&view=all"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.status, StatusCode::OK, "{:?}", list.body);
            let row = row_for(&list.body, &world.monstera);
            assert_eq!(
                row["values"]["label"]["label"],
                "Monstera in the study / kitchen"
            );
            assert_eq!(row["values"]["space"]["value"], "kitchen");

            // A definition that names the key cannot be stripped by `force`.
            let refused = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{space}/properties/space?force=true"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
            assert_eq!(
                refused.body["error"]["details"]["reason"],
                "computed properties use property"
            );
            assert_eq!(
                refused.body["error"]["details"]["properties"],
                json!(["label"])
            );

            // The relation is held by both rollups and keeps its definition.
            let related = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{space}/properties/related?force=true"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(related.status, StatusCode::CONFLICT);
            assert_eq!(
                related.body["error"]["details"]["properties"],
                json!(["related_count", "related_titles"])
            );
            let kept = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/properties/space"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(kept.status, StatusCode::OK, "{:?}", kept.body);
        });
    }

    #[test]
    fn csv_carries_computed_columns_and_refuses_a_hand_written_cell() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed-csv@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let world = computed_garden(&server, &cookie).await;
            let space = world.space.clone();

            let exported = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/types/plant/export"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(exported.status, StatusCode::OK);
            let text = exported.text();
            let lines: Vec<&str> = text
                .trim_start_matches('\u{feff}')
                .split("\r\n")
                .filter(|line| !line.is_empty())
                .collect();
            assert!(lines[0].contains("label"), "{:?}", lines[0]);
            assert!(lines[0].contains("related_count"), "{:?}", lines[0]);
            assert!(lines[0].contains("related_titles"), "{:?}", lines[0]);
            assert!(
                text.contains("Monstera in the study / kitchen"),
                "the formula column is a cell: {text}"
            );
            assert!(
                text.contains(r#""[""Fern by the window"",""Ivy on the shelf""]""#),
                "the list rollup travels as a JSON array of labels: {text}"
            );
            let monstera = lines
                .iter()
                .find(|line| line.starts_with("Monstera in the study,"))
                .expect("the Monstera row");
            assert!(monstera.contains(",2,"), "the count rollup: {monstera}");

            // A stored value on a computed key is a hand-edit: the export
            // drops it instead of showing it beside the computed column.
            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&space).expect("a space id"))
                .expect("the space is loaded");
            use thing_core::store::{SpaceFileKind, SpaceStore};
            let (path, mut doc, fingerprint) = handle
                .store
                .list_files()
                .expect("the space's files")
                .into_iter()
                .filter(|file| file.kind == SpaceFileKind::Object)
                .find_map(|file| {
                    let (doc, fingerprint) = handle.store.load_object(&file.path).ok()?;
                    (doc.id.to_string() == world.monstera).then_some((file.path, doc, fingerprint))
                })
                .expect("the Monstera file");
            doc.properties.insert(
                "label".to_owned(),
                thing_core::model::Value::Text("hand".to_owned()),
            );
            handle
                .store
                .save_object(&path, &doc, Some(fingerprint))
                .expect("a hand-edited object");
            handle
                .with_index_mut(|index| -> Result<(), thing_core::error::CoreError> {
                    *index = thing_core::index::SpaceIndex::rebuild_from_disk(&handle.store)?;
                    Ok(())
                })
                .expect("a rebuilt index");
            let again = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/types/plant/export"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(again.status, StatusCode::OK);
            assert!(
                !again.text().contains("hand"),
                "a stored computed value was exported: {}",
                again.text()
            );

            // A computed header is accepted; a non-empty cell is a row problem.
            let body = b"title,room,label\nWritten,study,hand typed\nEmpty,study,\n";
            let url = format!("/api/spaces/{space}/types/plant/import");
            let dry = server
                .call_raw(
                    "POST",
                    &format!("{url}?dry_run=true"),
                    Some("text/csv"),
                    body,
                    Some(&cookie),
                )
                .await;
            assert_eq!(dry.status, StatusCode::OK, "{:?}", dry.body);
            assert_eq!(dry.body["rows"], 2);
            assert_eq!(dry.body["valid"], false);
            assert_eq!(
                dry.body["errors"][0],
                json!({ "row": 1, "field": "label", "message": "is calculated and read-only" })
            );
            assert_eq!(dry.body["preview"][0]["title"], "Empty");

            let refused = server
                .call_raw("POST", &url, Some("text/csv"), body, Some(&cookie))
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);

            let committed = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    b"title,room,label\nEmpty,study,\n",
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                committed.status,
                StatusCode::CREATED,
                "{:?}",
                committed.body
            );
            assert_eq!(committed.body["count"], 1);
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
            assert_eq!(created.body["body"], "");

            let id = created.body["id"].as_str().expect("an id");
            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{id}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.body["body"], "");

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
            assert_eq!(whitespace.body["body"], "");
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
            assert_eq!(agenda.body["rows"], json!([]));
            assert_eq!(agenda.body["later_count"], 0);
        });
    }

    #[test]
    fn snoozing_a_scheduled_record_moves_only_its_due_day() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("snooze@example.com", None).await;
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
                            "due_date": day(-5),
                            "recurrence": { "kind": "days", "every": 3 }
                        }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            let id = created.body["id"].as_str().expect("an id").to_owned();

            let mut events = handle.events.subscribe();
            let snoozed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 1, "days": 2 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(snoozed.status, StatusCode::OK, "{:?}", snoozed.body);
            assert_eq!(snoozed.body["rev"], 2);
            assert_eq!(
                snoozed.body["properties"]["due_date"]["value"],
                day(2),
                "an overdue record counts from today"
            );
            assert_eq!(snoozed.body["schedule"]["status"], "upcoming");
            assert_eq!(snoozed.body["schedule"]["days_until_due"], 2);
            assert_eq!(
                snoozed.body["properties"]["recurrence"]["value"],
                json!({ "kind": "days", "every": 3 })
            );
            assert!(
                snoozed.body["properties"]
                    .get("last_completed_at")
                    .is_none(),
                "a snooze is not a completion"
            );

            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.updated");
            assert_eq!(event.payload["id"], id.as_str());
            assert_eq!(event.payload["rev"], 2);

            let stale = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 1, "days": 2 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stale.status, StatusCode::CONFLICT);
            assert_eq!(stale.code(), "conflict");

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
            assert_eq!(last["action"], "update");
            // A revision snapshot stores raw values, not the read shape.
            assert_eq!(last["snapshot"]["properties"]["due_date"], day(2));
        });
    }

    #[test]
    fn a_snooze_past_the_horizon_counts_as_later_and_undo_restores_it() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("later@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");

            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Sweep the porch",
                        "properties": { "due_date": day(0) }
                    })),
                    Some(&cookie),
                )
                .await;
            let id = created.body["id"].as_str().expect("an id").to_owned();

            let snoozed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 1, "days": 30 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(snoozed.status, StatusCode::OK, "{:?}", snoozed.body);
            assert_eq!(snoozed.body["properties"]["due_date"]["value"], day(30));

            let agenda = server
                .call("GET", &format!("{base}/agenda"), None, Some(&cookie))
                .await;
            assert_eq!(agenda.body["rows"], json!([]));
            assert_eq!(agenda.body["later_count"], 1);

            // The toast's Undo: write the previous due day back at the new rev.
            let undone = server
                .call(
                    "PATCH",
                    &format!("{base}/objects/{id}"),
                    Some(json!({
                        "rev": 2,
                        "properties": { "due_date": day(0) }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(undone.status, StatusCode::OK, "{:?}", undone.body);
            assert_eq!(undone.body["rev"], 3);
            assert_eq!(undone.body["schedule"]["status"], "today");

            let agenda = server
                .call("GET", &format!("{base}/agenda"), None, Some(&cookie))
                .await;
            assert_eq!(agenda.body["rows"].as_array().expect("rows").len(), 1);
            assert_eq!(agenda.body["later_count"], 0);
        });
    }

    #[test]
    fn a_snooze_refuses_bad_counts_and_missing_due_dates() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("bounds@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");

            let created = server
                .call(
                    "POST",
                    &format!("{base}/objects"),
                    Some(json!({
                        "type": "chore",
                        "title": "Rake",
                        "properties": { "due_date": day(0) }
                    })),
                    Some(&cookie),
                )
                .await;
            let id = created.body["id"].as_str().expect("an id").to_owned();

            for days in [0, 91, -2] {
                let refused = server
                    .call(
                        "POST",
                        &format!("{base}/objects/{id}/snooze"),
                        Some(json!({ "rev": 1, "days": days })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(
                    refused.status,
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "{days}: {:?}",
                    refused.body
                );
                assert_eq!(refused.field(), "days", "{days}");
            }

            let wrong_type = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 1, "days": "two" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(wrong_type.status, StatusCode::UNPROCESSABLE_ENTITY);

            let missing = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(missing.status, StatusCode::UNPROCESSABLE_ENTITY);

            // A done one-off has no due date left to move.
            let completed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/complete"),
                    Some(json!({ "rev": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.body);
            let done = server
                .call(
                    "POST",
                    &format!("{base}/objects/{id}/snooze"),
                    Some(json!({ "rev": 2, "days": 2 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(done.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(done.field(), "due_date");

            // A type that is not scheduled has nothing to snooze.
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
                    Some(json!({ "type": "plant", "title": "Fern" })),
                    Some(&cookie),
                )
                .await;
            let plant_id = plant.body["id"].as_str().expect("an id").to_owned();
            let unscheduled = server
                .call(
                    "POST",
                    &format!("{base}/objects/{plant_id}/snooze"),
                    Some(json!({ "rev": 1, "days": 2 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unscheduled.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(unscheduled.field(), "schedule");
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

    /// The titles of an agenda reply's rows, in the order the server sent them.
    fn agenda_titles(body: &Value) -> Vec<&str> {
        body["rows"]
            .as_array()
            .expect("rows")
            .iter()
            .map(|row| row["title"].as_str().expect("a title"))
            .collect()
    }

    #[test]
    fn the_agenda_lists_outstanding_rows_within_the_window() {
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
            assert_eq!(
                agenda_titles(&agenda.body),
                vec!["Overdue", "Today", "Tomorrow"]
            );
            let overdue = &agenda.body["rows"][0];
            assert_eq!(overdue["status"], "overdue");
            assert_eq!(overdue["days_until_due"], -1);
            assert_eq!(overdue["recurrence"], "Every 3 days");
            assert_eq!(overdue["type_name"], "Chore");
            assert_eq!(agenda.body["rows"][1]["status"], "today");
            assert_eq!(agenda.body["later_count"], 1);
            assert!(agenda.body.get("from").is_none());

            let invalid = server
                .call("GET", &format!("{base}/agenda?days=0"), None, Some(&cookie))
                .await;
            assert_eq!(invalid.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(invalid.field(), "days");
        });
    }

    #[test]
    fn the_agenda_reads_an_inclusive_range_and_filters_by_type() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("range@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = chore_space(&server, &cookie).await;
            let base = format!("/api/spaces/{space}");
            let plant = server
                .call(
                    "POST",
                    &format!("{base}/types"),
                    Some(json!({ "name": "Plant", "schedule": true })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(plant.status, StatusCode::CREATED, "{:?}", plant.body);
            let mut saved = std::collections::BTreeMap::new();
            for (title, kind, due) in [
                ("Before", "chore", -3),
                ("From edge", "chore", -2),
                ("Middle", "plant", 0),
                ("To edge", "chore", 2),
                ("After", "chore", 3),
            ] {
                let created = server
                    .call(
                        "POST",
                        &format!("{base}/objects"),
                        Some(json!({
                            "type": kind,
                            "title": title,
                            "properties": { "due_date": day(due) },
                        })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
                saved.insert(
                    title,
                    (
                        created.body["id"].as_str().expect("an id").to_owned(),
                        created.body["rev"].as_u64().expect("a rev"),
                    ),
                );
            }

            let range = format!("{base}/agenda?from={}&to={}", day(-2), day(2));
            let read = server.call("GET", &range, None, Some(&cookie)).await;
            assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
            assert_eq!(read.body["from"], day(-2));
            assert_eq!(read.body["to"], day(2));
            assert!(read.body.get("later_count").is_none());
            assert_eq!(
                agenda_titles(&read.body),
                vec!["From edge", "Middle", "To edge"],
                "an overdue row before from is outside the range"
            );

            let plants = server
                .call("GET", &format!("{range}&types=plant"), None, Some(&cookie))
                .await;
            assert_eq!(plants.status, StatusCode::OK, "{:?}", plants.body);
            assert_eq!(agenda_titles(&plants.body), vec!["Middle"]);

            let plant_row = &plants.body["rows"][0];
            assert_eq!(plant_row["type"], "plant");
            assert_eq!(plant_row["type_name"], "Plant");

            let window = server
                .call("GET", &format!("{base}/agenda?days=2"), None, Some(&cookie))
                .await;
            assert_eq!(window.status, StatusCode::OK, "{:?}", window.body);
            assert_eq!(
                agenda_titles(&window.body),
                vec!["Before", "From edge", "Middle", "To edge"],
                "overdue rows stay inside every window"
            );
            assert_eq!(window.body["later_count"], 1);

            let chores = server
                .call(
                    "GET",
                    &format!("{base}/agenda?days=2&types=chore,%20chore"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(chores.status, StatusCode::OK, "{:?}", chores.body);
            assert_eq!(
                agenda_titles(&chores.body),
                vec!["Before", "From edge", "To edge"],
                "a duplicate key collapses and the filter precedes the window"
            );
            assert_eq!(chores.body["later_count"], 1);

            let only_plants = server
                .call(
                    "GET",
                    &format!("{base}/agenda?days=2&types=plant"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(agenda_titles(&only_plants.body), vec!["Middle"]);
            assert_eq!(only_plants.body["later_count"], 0);

            let (from_edge, from_edge_rev) = &saved["From edge"];
            let completed = server
                .call(
                    "POST",
                    &format!("{base}/objects/{from_edge}/complete"),
                    Some(json!({ "rev": from_edge_rev })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(completed.status, StatusCode::OK, "{:?}", completed.body);
            let after = server.call("GET", &range, None, Some(&cookie)).await;
            assert_eq!(agenda_titles(&after.body), vec!["Middle", "To edge"]);

            for (uri, field) in [
                (format!("{base}/agenda?from={}", day(-1)), "to"),
                (format!("{base}/agenda?to={}", day(1)), "from"),
                (
                    format!("{base}/agenda?from=2026-13-01&to={}", day(1)),
                    "from",
                ),
                (format!("{base}/agenda?from={}&to={}", day(2), day(1)), "to"),
                (
                    format!("{base}/agenda?from={}&to={}", day(0), day(63)),
                    "to",
                ),
                (
                    format!("{base}/agenda?days=14&from={}&to={}", day(0), day(1)),
                    "days",
                ),
                (format!("{base}/agenda?types=nope"), "type"),
            ] {
                let invalid = server.call("GET", &uri, None, Some(&cookie)).await;
                assert_eq!(
                    invalid.status,
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "{uri}: {:?}",
                    invalid.body
                );
                assert_eq!(invalid.field(), field, "{uri}");
            }
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

    /// The type detail's view keys in file order.
    fn view_keys(detail: &Value) -> Vec<&str> {
        detail["views"]
            .as_array()
            .expect("views")
            .iter()
            .map(|view| view["key"].as_str().expect("a view key"))
            .collect()
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
            // Naming a default also moves it to the front of the list.
            assert_eq!(view_keys(&chosen.body), ["by_room", "all", "gallery"]);

            // Deleting the first view promotes whatever is now first.
            let removed = server
                .call("DELETE", &format!("{views}/by_room"), None, Some(&cookie))
                .await;
            assert_eq!(removed.status, StatusCode::OK, "{:?}", removed.body);
            assert_eq!(removed.body["default_view"], "all");
            assert_eq!(view_keys(&removed.body), ["all", "gallery"]);

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
    fn a_table_view_keeps_its_footer_switches_and_another_kind_refuses_them() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("footer@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let base = format!("/api/spaces/{}/types/plant", garden.space);

            let set = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({
                        "columns": ["title", "room"],
                        "footer": false,
                        "footer_hidden": ["room"],
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(set.status, StatusCode::OK, "{:?}", set.body);
            assert_eq!(view(&set.body, "all")["footer"], json!(false));
            assert_eq!(view(&set.body, "all")["footer_hidden"], json!(["room"]));

            let measures = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({
                        "footer_summary": { "title": "rows", "room": "distinct" },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(measures.status, StatusCode::OK, "{:?}", measures.body);
            assert_eq!(
                view(&measures.body, "all")["footer_summary"],
                json!({ "title": "rows", "room": "distinct" })
            );

            let wrong_measure = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({ "footer_summary": { "room": "highest" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(wrong_measure.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(wrong_measure.field(), "views.all.footer_summary.room");

            let ghost_measure = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({ "footer_summary": { "ghost": "distinct" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(ghost_measure.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(ghost_measure.field(), "views.all.footer_summary.ghost");

            // The two switches are edited apart: clearing one keeps the other.
            let shown = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({ "footer": null })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(shown.status, StatusCode::OK, "{:?}", shown.body);
            assert_eq!(view(&shown.body, "all")["footer"], Value::Null);
            assert_eq!(view(&shown.body, "all")["footer_hidden"], json!(["room"]));

            let emptied = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({ "footer_hidden": [] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(view(&emptied.body, "all")["footer_hidden"], Value::Null);

            // A denylist entry has to be a column of the view carrying it.
            let ghost = server
                .call(
                    "PATCH",
                    &format!("{base}/views/all"),
                    Some(json!({ "footer_hidden": ["ghost"] })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(ghost.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(ghost.field(), "views.all.footer_hidden.ghost");

            // The band is a table's, so a board refuses either switch.
            let board = server
                .call(
                    "POST",
                    &format!("{base}/views"),
                    Some(json!({ "name": "By room", "kind": "board", "group_by": "room" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(board.status, StatusCode::CREATED, "{:?}", board.body);
            let refused = server
                .call(
                    "PATCH",
                    &format!("{base}/views/by_room"),
                    Some(json!({ "footer": false })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(refused.field(), "views.by_room.footer");
            assert_eq!(
                refused.body["error"]["message"],
                "belongs to table views only"
            );
            let refused_measures = server
                .call(
                    "PATCH",
                    &format!("{base}/views/by_room"),
                    Some(json!({ "footer_summary": { "title": "rows" } })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused_measures.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(refused_measures.field(), "views.by_room.footer_summary");
        });
    }

    #[test]
    fn a_hand_edited_footer_denylist_shows_in_health_without_taking_the_type_offline() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("hand-edited@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            // Written past the API, the way a hand edit arrives.
            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&garden.space).expect("a space id"))
                .expect("the space is loaded");
            let mut def =
                handle.with_index(|index| index.type_def("plant").expect("the type").clone());
            def.views[0].footer_hidden = vec!["ghost".to_owned()];
            let path = thing_core::store::type_path(&def.key);
            let expected = handle.with_index(|index| index.fingerprint(&path));
            handle.store.save_type(&def, expected).expect("a hand edit");
            handle
                .with_index_mut(|index| index.reload_file(&handle.store, &path))
                .expect("the index reloads");

            let health = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/health", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(health.status, StatusCode::OK);
            assert_eq!(
                health.body["view_problems"],
                json!([{
                    "type": "plant",
                    "view": "all",
                    "field": "views.all.footer_hidden.ghost",
                    "message": "is not a column of this view",
                }])
            );

            // The problem is reported, not fatal: the type still reads.
            let read = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/types/plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(read.status, StatusCode::OK);
            assert_eq!(view(&read.body, "all")["footer_hidden"], json!(["ghost"]));
        });
    }

    #[test]
    fn a_view_moves_between_slots_but_the_default_keeps_the_first() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("move-views@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let views = format!("/api/spaces/{}/types/plant/views", garden.space);

            for (name, kind, extra) in [
                ("By room", "board", json!({ "group_by": "room" })),
                ("Gallery", "gallery", json!({ "cover": "room" })),
            ] {
                let mut body = json!({ "name": name, "kind": kind });
                for (key, value) in extra.as_object().expect("fields") {
                    body[key] = value.clone();
                }
                let created = server.call("POST", &views, Some(body), Some(&cookie)).await;
                assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
            }

            // The default owns slot 0, so it cannot move and nothing may take
            // its place.
            let before = server
                .call(
                    "POST",
                    &format!("{views}/gallery/move"),
                    Some(json!({ "position": 0 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(before.status, StatusCode::CONFLICT, "{:?}", before.body);
            assert_eq!(
                before.body["error"]["details"]["reason"],
                "the default view stays first"
            );

            let off = server
                .call(
                    "POST",
                    &format!("{views}/all/move"),
                    Some(json!({ "position": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(off.status, StatusCode::CONFLICT, "{:?}", off.body);

            let stayed = server
                .call(
                    "POST",
                    &format!("{views}/all/move"),
                    Some(json!({ "position": 0 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(stayed.status, StatusCode::OK, "{:?}", stayed.body);
            assert_eq!(view_keys(&stayed.body), ["all", "by_room", "gallery"]);

            let moved = server
                .call(
                    "POST",
                    &format!("{views}/gallery/move"),
                    Some(json!({ "position": 1 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(moved.status, StatusCode::OK, "{:?}", moved.body);
            assert_eq!(view_keys(&moved.body), ["all", "gallery", "by_room"]);
            assert_eq!(moved.body["default_view"], "all");

            let past = server
                .call(
                    "POST",
                    &format!("{views}/gallery/move"),
                    Some(json!({ "position": 3 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(past.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(past.field(), "position");

            // Naming another view the default moves it to the front.
            let promoted = server
                .call(
                    "POST",
                    &format!("{views}/by_room/default"),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(promoted.status, StatusCode::OK, "{:?}", promoted.body);
            assert_eq!(view_keys(&promoted.body), ["by_room", "all", "gallery"]);
            assert_eq!(promoted.body["default_view"], "by_room");

            let unknown = server
                .call(
                    "POST",
                    &format!("{views}/missing/move"),
                    Some(json!({ "position": 0 })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(unknown.status, StatusCode::NOT_FOUND);
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
    /// A real 1 × 1 PNG: the magic bytes, a valid IHDR, one red pixel and IEND.
    const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
        0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    /// A Garden whose Plant type carries a text formula, a count rollup and a
    /// list rollup, with Monstera related to Fern and Ivy.
    struct ComputedGarden {
        space: String,
        monstera: String,
        fern: String,
    }

    async fn computed_garden(server: &Server, cookie: &str) -> ComputedGarden {
        let garden = garden(server, cookie).await;
        let space = garden.space.clone();
        for body in [
            json!({
                "name": "Related",
                "format": "relation",
                "target_type": "plant",
                "multi": true,
            }),
            json!({
                "name": "Label",
                "format": "text",
                "compute": {
                    "kind": "formula",
                    "expression": "title + \" / \" + room",
                },
            }),
            json!({
                "name": "Related count",
                "format": "number",
                "compute": {
                    "kind": "rollup",
                    "relation": "related",
                    "aggregate": "count",
                },
            }),
            json!({
                "name": "Related titles",
                "format": "list",
                "compute": {
                    "kind": "rollup",
                    "relation": "related",
                    "property": "title",
                    "aggregate": "list",
                },
            }),
        ] {
            let created = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/properties"),
                    Some(body.clone()),
                    Some(cookie),
                )
                .await;
            assert_eq!(
                created.status,
                StatusCode::CREATED,
                "{body:?}: {:?}",
                created.body
            );
        }

        let typed = server
            .call(
                "PATCH",
                &format!("/api/spaces/{space}/types/plant"),
                Some(json!({
                    "properties": [
                        { "key": "room" },
                        { "key": "related" },
                        { "key": "label" },
                        { "key": "related_count" },
                        { "key": "related_titles" }
                    ]
                })),
                Some(cookie),
            )
            .await;
        assert_eq!(typed.status, StatusCode::OK, "{:?}", typed.body);

        let view = server
            .call(
                "PATCH",
                &format!("/api/spaces/{space}/types/plant/views/all"),
                Some(json!({
                    "columns": ["title", "room", "label", "related_count", "related_titles"]
                })),
                Some(cookie),
            )
            .await;
        assert_eq!(view.status, StatusCode::OK, "{:?}", view.body);

        let mut created = Vec::new();
        for (title, room) in [
            ("Fern by the window", "study"),
            ("Ivy on the shelf", "study"),
        ] {
            let reply = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/objects"),
                    Some(json!({
                        "type": "plant",
                        "title": title,
                        "properties": { "room": room },
                    })),
                    Some(cookie),
                )
                .await;
            assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
            created.push((
                reply.body["id"].as_str().expect("an id").to_owned(),
                reply.body["rev"].as_u64().expect("a rev"),
            ));
        }
        let (fern, _) = created[0].clone();
        let (ivy, _) = created[1].clone();
        let patched = server
            .call(
                "PATCH",
                &format!("/api/spaces/{space}/objects/{}", garden.plant),
                Some(json!({
                    "rev": 1,
                    "properties": { "related": [fern.clone(), ivy.clone()] }
                })),
                Some(cookie),
            )
            .await;
        assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

        ComputedGarden {
            space,
            monstera: garden.plant,
            fern,
        }
    }

    fn row_for<'a>(body: &'a Value, id: &str) -> &'a Value {
        body["objects"]
            .as_array()
            .expect("rows")
            .iter()
            .find(|row| row["id"] == id)
            .unwrap_or_else(|| panic!("row {id} missing from {body}"))
    }

    /// The stored attachment count, so a repeat upload can prove it wrote nothing.
    fn attachment_count(server: &Server, space: &str) -> usize {
        use thing_core::store::{SpaceFileKind, SpaceStore};
        let handle = server
            .state
            .registry
            .get(Uuid::parse_str(space).expect("a space id"))
            .expect("the space is loaded");
        handle
            .store
            .list_files()
            .expect("the space lists")
            .into_iter()
            .filter(|file| file.kind == SpaceFileKind::Attachment)
            .count()
    }

    /// A PNG of the given size: RGB when opaque, RGBA with a transparent corner.
    fn encoded_png(width: u32, height: u32, alpha: bool) -> Vec<u8> {
        use image::{DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
        use std::io::Cursor;
        let image = if alpha {
            DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
                Rgba([
                    (x % 256) as u8,
                    (y % 256) as u8,
                    90,
                    if x == 0 && y == 0 { 0 } else { 255 },
                ])
            }))
        } else {
            DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
                Rgb([(x % 256) as u8, (y % 256) as u8, 90])
            }))
        };
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .expect("a PNG");
        bytes
    }

    /// A JPEG whose EXIF orientation tag is `orientation`, inserted after SOI.
    fn jpeg_with_orientation(width: u32, height: u32, orientation: u16) -> Vec<u8> {
        use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
        use std::io::Cursor;
        let image = DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
            Rgb([(x % 256) as u8, (y % 256) as u8, 90])
        }));
        let mut jpeg = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg)
            .expect("a JPEG");

        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II\x2a\x00");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&u32::from(orientation).to_le_bytes());
        tiff.extend_from_slice(&0u32.to_le_bytes());

        let mut payload = b"Exif\x00\x00".to_vec();
        payload.extend_from_slice(&tiff);
        let mut app1 = vec![0xff, 0xe1];
        app1.extend_from_slice(
            &u16::try_from(payload.len() + 2)
                .expect("an APP1 length")
                .to_be_bytes(),
        );
        app1.extend_from_slice(&payload);

        let mut out = jpeg[..2].to_vec();
        out.extend_from_slice(&app1);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    /// Every cached thumbnail path in the space, sorted.
    fn thumbnail_paths(server: &Server, space: &str) -> Vec<String> {
        use thing_core::store::{SpaceFileKind, SpaceStore};
        let handle = server
            .state
            .registry
            .get(Uuid::parse_str(space).expect("a space id"))
            .expect("the space is loaded");
        handle
            .store
            .list_files()
            .expect("the space lists")
            .into_iter()
            .filter(|file| file.kind == SpaceFileKind::Thumbnail)
            .map(|file| file.path.display().to_string())
            .collect()
    }

    /// Uploads `bytes` under `name` and returns `(hash, path)`.
    async fn upload_file(
        server: &Server,
        space: &str,
        cookie: &str,
        name: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> (String, String) {
        let upload = server
            .call_raw(
                "POST",
                &format!("/api/spaces/{space}/files?name={name}"),
                Some(content_type),
                bytes,
                Some(cookie),
            )
            .await;
        assert_eq!(upload.status, StatusCode::CREATED, "{:?}", upload.body);
        (
            upload.body["hash"].as_str().expect("a hash").to_owned(),
            upload.body["path"].as_str().expect("a path").to_owned(),
        )
    }

    #[test]
    fn an_editor_uploads_a_png_and_a_member_reads_it_with_the_file_headers() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("files-owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &owner_cookie, "Garden").await;

            let upload = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=Garden-Photo.PNG"),
                    Some("image/png"),
                    PNG_1X1,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(upload.status, StatusCode::CREATED, "{:?}", upload.body);
            let path = upload.body["path"].as_str().expect("a path").to_owned();
            let hash = upload.body["hash"].as_str().expect("a hash");
            assert_eq!(hash.len(), 64);
            assert_eq!(path, format!("files/{hash}/garden-photo.png"));
            assert_eq!(upload.body["name"], "garden-photo.png");
            assert_eq!(upload.body["mime"], "image/png");
            assert_eq!(upload.body["size"], PNG_1X1.len());
            assert_eq!(attachment_count(&server, &space), 1);

            let read = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}"),
                    None,
                    &[],
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(read.status, StatusCode::OK);
            assert_eq!(read.bytes, PNG_1X1);
            assert_eq!(read.headers.get("content-type").unwrap(), "image/png");
            assert_eq!(read.headers.get("etag").unwrap(), &format!("\"{hash}\""));
            assert_eq!(read.headers.get("content-disposition").unwrap(), "inline");
            assert_eq!(
                read.headers.get("cache-control").unwrap(),
                "private, max-age=31536000, immutable"
            );
            assert_eq!(
                read.headers.get("content-length").unwrap(),
                &PNG_1X1.len().to_string()
            );

            // A viewer may read and may not write.
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server
                .register("files-viewer@example.com", Some(&code))
                .await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let viewed = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}"),
                    None,
                    &[],
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(viewed.status, StatusCode::OK);
            let refused = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=copy.png"),
                    Some("image/png"),
                    PNG_1X1,
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);
            assert_eq!(refused.code(), "forbidden");

            // A member of another space cannot tell this file exists.
            let work = create_space(&server, &owner_cookie, "Work").await;
            let work_invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{work}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            let work_code = work_invite.body["code"]
                .as_str()
                .expect("a code")
                .to_owned();
            let stranger = server
                .register("files-stranger@example.com", Some(&work_code))
                .await;
            let stranger_cookie = cookie_of(&stranger).to_owned();
            let leaked = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}"),
                    None,
                    &[],
                    Some(&stranger_cookie),
                )
                .await;
            assert_eq!(leaked.status, StatusCode::NOT_FOUND);
            assert_eq!(leaked.code(), "not_found");
            assert!(!leaked.text().contains(hash));
        });
    }

    #[test]
    fn an_upload_is_idempotent_and_refuses_a_path_a_lie_and_an_oversize_body() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("repeat-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let url = format!("/api/spaces/{space}/files?name=monstera.png");

            let first = server
                .call_raw("POST", &url, Some("image/png"), PNG_1X1, Some(&cookie))
                .await;
            assert_eq!(first.status, StatusCode::CREATED);
            let second = server
                .call_raw("POST", &url, Some("image/png"), PNG_1X1, Some(&cookie))
                .await;
            assert_eq!(second.status, StatusCode::OK, "{:?}", second.body);
            assert_eq!(second.body["path"], first.body["path"]);
            assert_eq!(attachment_count(&server, &space), 1);

            // A name is a name, never a directory to climb out of.
            for name in ["../escape.png", "sub/dir.png", "..", "a\\b.png"] {
                let refused = server
                    .call_raw(
                        "POST",
                        &format!("/api/spaces/{space}/files?name={name}"),
                        Some("image/png"),
                        PNG_1X1,
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(refused.status, StatusCode::BAD_REQUEST, "{name}");
                assert_eq!(refused.code(), "bad_request");
                assert_eq!(refused.field(), "name");
            }

            // The body, not the header, decides what the bytes are.
            let lie = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=not-a-photo.png"),
                    Some("image/png"),
                    b"this is text, not an image",
                    Some(&cookie),
                )
                .await;
            assert_eq!(lie.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
            assert_eq!(lie.code(), "unsupported_media_type");

            let svg = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=mark.svg"),
                    Some("image/svg+xml"),
                    b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
                    Some(&cookie),
                )
                .await;
            assert_eq!(svg.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);

            // A generic file keeps its extension and downloads.
            let document = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=Field%20Notes.PDF"),
                    Some("application/pdf"),
                    b"%PDF-1.4\nnot really a pdf",
                    Some(&cookie),
                )
                .await;
            assert_eq!(document.status, StatusCode::CREATED, "{:?}", document.body);
            assert_eq!(document.body["name"], "field-notes.pdf");
            assert_eq!(document.body["mime"], "application/octet-stream");
            let stored = document.body["path"].as_str().expect("a path");
            let download = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{stored}"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(download.status, StatusCode::OK);
            assert_eq!(
                download.headers.get("content-type").unwrap(),
                "application/octet-stream"
            );
            assert_eq!(
                download.headers.get("content-disposition").unwrap(),
                "attachment; filename=\"field-notes.pdf\""
            );

            // 10 MiB + 1 is refused by the server with the app's sentence.
            let oversized = vec![0u8; 10 * 1024 * 1024 + 1];
            let refused = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files?name=big.bin"),
                    Some("application/octet-stream"),
                    &oversized,
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::PAYLOAD_TOO_LARGE);
            assert_eq!(refused.code(), "payload_too_large");
            assert!(refused.text().contains("10 MiB"));
            assert_eq!(attachment_count(&server, &space), 2);

            // Without a name there is no file, and a non-canonical pair is not
            // a path the store will read.
            let nameless = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{space}/files"),
                    Some("image/png"),
                    PNG_1X1,
                    Some(&cookie),
                )
                .await;
            assert_eq!(nameless.status, StatusCode::BAD_REQUEST);
            let hash = first.body["hash"].as_str().expect("a hash");
            for uri in [
                format!("/api/spaces/{space}/files/not-a-hash/monstera.png"),
                format!("/api/spaces/{space}/files/{hash}/missing.png"),
            ] {
                let absent = server.call_raw("GET", &uri, None, &[], Some(&cookie)).await;
                assert_eq!(absent.status, StatusCode::NOT_FOUND, "{uri}");
            }
        });
    }

    #[test]
    fn a_thumbnail_is_generated_once_and_served_from_the_cache_after() {
        use std::os::unix::fs::MetadataExt;
        use thing_core::store::{SpaceStore, thumb_path};

        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("thumb-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let photo = encoded_png(300, 120, false);
            let (hash, path) = upload_file(
                &server,
                &space,
                &cookie,
                "Phone%20Photo.png",
                "image/png",
                &photo,
            )
            .await;

            let first = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);
            assert_eq!(first.headers.get("content-type").unwrap(), "image/jpeg");
            assert_eq!(
                first.headers.get("etag").unwrap(),
                &format!("\"{hash}-256\"")
            );
            assert_eq!(first.headers.get("content-disposition").unwrap(), "inline");
            let thumbnail = image::load_from_memory(&first.bytes).expect("a JPEG thumbnail");
            assert_eq!(thumbnail.width(), 256);
            assert_eq!(thumbnail.height(), 102);
            assert_eq!(
                thumbnail_paths(&server, &space),
                vec![format!("files/.thumbs/{hash}-256.jpg")]
            );

            // The second read serves the cache; it does not rewrite it.
            let handle = server
                .state
                .registry
                .get(Uuid::parse_str(&space).expect("a space id"))
                .expect("the space is loaded");
            let cache = handle.store.space_dir().join(thumb_path(&hash, 256, "jpg"));
            let inode = std::fs::metadata(&cache).expect("a cache file").ino();
            let second = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(second.status, StatusCode::OK);
            assert_eq!(second.bytes, first.bytes);
            assert_eq!(
                std::fs::metadata(&cache).expect("a cache file").ino(),
                inode
            );
            assert_eq!(thumbnail_paths(&server, &space).len(), 1);

            // A thumbnail never upscales: a 2 px image is served as it is.
            let tiny = encoded_png(2, 2, false);
            let (tiny_hash, tiny_path) =
                upload_file(&server, &space, &cookie, "tiny.png", "image/png", &tiny).await;
            let upscale = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{tiny_path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(upscale.status, StatusCode::OK);
            assert_eq!(upscale.bytes, tiny);
            assert_eq!(
                upscale.headers.get("etag").unwrap(),
                &format!("\"{tiny_hash}\"")
            );
            assert_eq!(upscale.headers.get("content-type").unwrap(), "image/png");

            // A width that is not 256 or 512 is not a thumbnail request.
            let other = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}?w=999"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(other.status, StatusCode::OK);
            assert_eq!(other.bytes, photo);
            assert_eq!(other.headers.get("etag").unwrap(), &format!("\"{hash}\""));
            assert_eq!(thumbnail_paths(&server, &space).len(), 1);

            // Bytes that only carry a PNG signature cannot be decoded: the
            // original is served, with the original ETag, and nothing is cached.
            let broken = b"\x89PNG\r\n\x1a\nnot really a png".to_vec();
            let (broken_hash, broken_path) =
                upload_file(&server, &space, &cookie, "broken.png", "image/png", &broken).await;
            let fallback = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{broken_path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(fallback.status, StatusCode::OK);
            assert_eq!(fallback.bytes, broken);
            assert_eq!(
                fallback.headers.get("etag").unwrap(),
                &format!("\"{broken_hash}\"")
            );
            assert_eq!(thumbnail_paths(&server, &space).len(), 1);

            // A non-image ignores `w` entirely.
            let (document_hash, document_path) = upload_file(
                &server,
                &space,
                &cookie,
                "notes.pdf",
                "application/pdf",
                b"%PDF-1.4\nnot really a pdf",
            )
            .await;
            let document = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{document_path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(document.status, StatusCode::OK);
            assert_eq!(
                document.headers.get("content-type").unwrap(),
                "application/octet-stream"
            );
            assert_eq!(
                document.headers.get("etag").unwrap(),
                &format!("\"{document_hash}\"")
            );
        });
    }

    #[test]
    fn an_exif_orientation_is_applied_before_the_thumbnail_is_scaled() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("exif-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let photo = jpeg_with_orientation(600, 300, 6);
            let (_, path) = upload_file(
                &server,
                &space,
                &cookie,
                "portrait.jpg",
                "image/jpeg",
                &photo,
            )
            .await;

            let read = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}?w=256"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
            assert_eq!(read.headers.get("content-type").unwrap(), "image/jpeg");
            let thumbnail = image::load_from_memory(&read.bytes).expect("a JPEG thumbnail");
            // 600 × 300 rotated 90° is 300 × 600, so the 256 px width implies 512 px.
            assert_eq!(thumbnail.width(), 256);
            assert_eq!(thumbnail.height(), 512);
        });
    }

    #[test]
    fn a_transparent_image_caches_a_png_thumbnail_that_keeps_its_alpha() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("alpha-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &cookie, "Garden").await;
            let photo = encoded_png(600, 200, true);
            let (hash, path) =
                upload_file(&server, &space, &cookie, "alpha.png", "image/png", &photo).await;

            let read = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{space}/{path}?w=512"),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(read.status, StatusCode::OK, "{:?}", read.body);
            assert_eq!(read.headers.get("content-type").unwrap(), "image/png");
            assert_eq!(
                read.headers.get("etag").unwrap(),
                &format!("\"{hash}-512\"")
            );
            assert_eq!(
                thumbnail_paths(&server, &space),
                vec![format!("files/.thumbs/{hash}-512.png")]
            );

            let thumbnail = image::load_from_memory(&read.bytes).expect("a PNG thumbnail");
            assert_eq!(thumbnail.width(), 512);
            assert!(thumbnail.color().has_alpha());
            let rgba = thumbnail.to_rgba8();
            assert!(
                rgba.pixels().any(|pixel| pixel[3] < 255),
                "a transparent source keeps a transparent pixel"
            );
        });
    }

    #[test]
    fn collecting_unreferenced_files_requires_the_owner_and_keeps_referenced_bytes() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("gc-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let gc = format!("/api/spaces/{}/files/gc", garden.space);
            let photo = encoded_png(600, 200, false);
            let (_, path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "orphan.png",
                "image/png",
                &photo,
            )
            .await;
            // A cached thumbnail is derived bytes too, and goes with its source.
            server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/{path}?w=256", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(attachment_count(&server, &garden.space), 1);
            assert_eq!(thumbnail_paths(&server, &garden.space).len(), 1);

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "editor" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let editor = server.register("gc-editor@example.com", Some(&code)).await;
            let editor_cookie = cookie_of(&editor).to_owned();
            let refused = server.call("POST", &gc, None, Some(&editor_cookie)).await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);
            assert_eq!(refused.code(), "forbidden");
            assert_eq!(attachment_count(&server, &garden.space), 1);

            let collected = server.call("POST", &gc, None, Some(&cookie)).await;
            assert_eq!(collected.status, StatusCode::OK, "{:?}", collected.body);
            assert_eq!(collected.body["removed"], 1);
            assert!(
                collected.body["freed_bytes"].as_u64().expect("bytes") > photo.len() as u64,
                "the thumbnail's bytes are counted too: {:?}",
                collected.body
            );
            assert_eq!(attachment_count(&server, &garden.space), 0);
            assert!(thumbnail_paths(&server, &garden.space).is_empty());

            // The same bytes upload again: the collection removed them, not the source.
            let (_, path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "orphan.png",
                "image/png",
                &photo,
            )
            .await;
            let covered = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({ "rev": 1, "cover": path })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(covered.status, StatusCode::OK, "{:?}", covered.body);

            let kept = server.call("POST", &gc, None, Some(&cookie)).await;
            assert_eq!(kept.status, StatusCode::OK);
            assert_eq!(kept.body["removed"], 0);
            assert_eq!(attachment_count(&server, &garden.space), 1);

            // Clearing the value is an ordinary write; only the collection removes
            // the bytes a record no longer names.
            let cleared = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({ "rev": 2, "cover": null })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(cleared.status, StatusCode::OK, "{:?}", cleared.body);
            assert_eq!(attachment_count(&server, &garden.space), 1);
            let swept = server.call("POST", &gc, None, Some(&cookie)).await;
            assert_eq!(swept.body["removed"], 1);
            assert_eq!(attachment_count(&server, &garden.space), 0);
        });
    }

    #[test]
    fn purging_a_record_keeps_bytes_another_record_still_names() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("purge-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let photo = encoded_png(600, 200, false);
            let (_, path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "cover.png",
                "image/png",
                &photo,
            )
            .await;
            server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/{path}?w=256", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;

            let second = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/objects", garden.space),
                    Some(json!({ "type": "plant", "title": "Fern" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(second.status, StatusCode::CREATED, "{:?}", second.body);
            let fern = second.body["id"].as_str().expect("an id").to_owned();

            // Duplicating would share this path too; here two records are given
            // the same cover explicitly.
            for id in [&garden.plant, &fern] {
                let patched = server
                    .call(
                        "PATCH",
                        &format!("/api/spaces/{}/objects/{id}", garden.space),
                        Some(json!({ "rev": 1, "cover": path })),
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);
            }
            for id in [&garden.plant, &fern] {
                let trashed = server
                    .call(
                        "DELETE",
                        &format!("/api/spaces/{}/objects/{id}", garden.space),
                        None,
                        Some(&cookie),
                    )
                    .await;
                assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);
            }
            // A trashed record still owns its bytes.
            assert_eq!(attachment_count(&server, &garden.space), 1);

            let first_purge = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{}/trash/{}", garden.space, garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(first_purge.status, StatusCode::NO_CONTENT);
            assert_eq!(
                attachment_count(&server, &garden.space),
                1,
                "the other record still names the file"
            );
            assert_eq!(thumbnail_paths(&server, &garden.space).len(), 1);

            let last_purge = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{}/trash/{fern}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(last_purge.status, StatusCode::NO_CONTENT);
            assert_eq!(attachment_count(&server, &garden.space), 0);
            assert!(
                thumbnail_paths(&server, &garden.space).is_empty(),
                "the last reference takes the derived bytes with it"
            );
        });
    }

    #[test]
    fn a_csv_file_column_travels_by_path_and_refuses_a_missing_one() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("csv-files@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;

            let property = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/properties", garden.space),
                    Some(json!({ "name": "Photo", "format": "image" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(property.status, StatusCode::CREATED, "{:?}", property.body);
            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/types/plant", garden.space),
                    Some(json!({
                        "properties": [{ "key": "room" }, { "key": "photo" }]
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let photo = encoded_png(300, 120, false);
            let (_, path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "fern.png",
                "image/png",
                &photo,
            )
            .await;
            let url = format!("/api/spaces/{}/types/plant/import", garden.space);
            let csv = format!("title,room,photo\nFern by the door,kitchen,{path}\n");

            let dry = server
                .call_raw(
                    "POST",
                    &format!("{url}?dry_run=true"),
                    Some("text/csv"),
                    csv.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(dry.status, StatusCode::OK, "{:?}", dry.body);
            assert_eq!(dry.body["valid"], true, "{:?}", dry.body);
            assert_eq!(dry.body["preview"][0]["values"]["photo"], path.as_str());

            let commit = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    csv.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(commit.status, StatusCode::CREATED, "{:?}", commit.body);
            let id = commit.body["created"][0]["id"]
                .as_str()
                .expect("an id")
                .to_owned();
            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects/{id}", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.status, StatusCode::OK, "{:?}", detail.body);
            assert_eq!(detail.body["properties"]["photo"]["value"], path.as_str());
            assert_eq!(detail.body["properties"]["photo"]["label"], "fern.png");

            // Export writes the path, not the bytes.
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
            assert!(
                export.text().contains(&format!(",{path},")),
                "{}",
                export.text()
            );

            // CSV carries no bytes: a path the space cannot serve is a row error.
            let absent = format!("files/{}/ghost.png", "b".repeat(64));
            let missing = format!("title,room,photo\nMoss,kitchen,{absent}\n");
            let refused = server
                .call_raw(
                    "POST",
                    &url,
                    Some("text/csv"),
                    missing.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            let problem = &refused.body["error"]["details"]["errors"][0];
            assert_eq!(problem["row"], 1);
            assert_eq!(problem["field"], "photo");
            assert!(
                problem["message"]
                    .as_str()
                    .expect("a message")
                    .contains(&absent)
            );

            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.body["total"], 2, "the refused row wrote nothing");
        });
    }

    /// Adds an `attachments` property named Photos to the Garden's plant type.
    async fn photos_property(server: &Server, cookie: &str, space: &str) {
        let created = server
            .call(
                "POST",
                &format!("/api/spaces/{space}/properties"),
                Some(json!({ "name": "Photos", "format": "attachments" })),
                Some(cookie),
            )
            .await;
        assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
        assert_eq!(created.body["format"], "attachments");
        let patched = server
            .call(
                "PATCH",
                &format!("/api/spaces/{space}/types/plant"),
                Some(json!({ "properties": [{ "key": "room" }, { "key": "photos" }] })),
                Some(cookie),
            )
            .await;
        assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);
    }

    #[test]
    fn the_library_lists_each_path_once_with_its_records_and_totals() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("library-owner@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            photos_property(&server, &cookie, &garden.space).await;

            let photo = encoded_png(300, 120, false);
            let (_, photo_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "monstera.png",
                "image/png",
                &photo,
            )
            .await;
            let guide = b"%PDF-1.4\nnot really a pdf";
            let (_, guide_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "Notes.PDF",
                "application/pdf",
                guide,
            )
            .await;
            assert!(guide_path.ends_with("/notes.pdf"), "{guide_path}");

            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({
                        "rev": 1,
                        "cover": photo_path,
                        "properties": { "photos": [photo_path, guide_path] },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let library = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/files", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(library.status, StatusCode::OK, "{:?}", library.body);
            let items = library.body["items"].as_array().expect("items");
            assert_eq!(items.len(), 2);

            assert_eq!(items[0]["name"], "monstera.png");
            assert_eq!(items[0]["path"], photo_path.as_str());
            assert_eq!(items[0]["kind"], "image");
            assert_eq!(items[0]["size"], photo.len());
            // The cover and the list name the same bytes; the cover wins the chip.
            let records = items[0]["records"].as_array().expect("records");
            assert_eq!(records.len(), 1);
            assert_eq!(records[0]["id"], garden.plant.as_str());
            assert_eq!(records[0]["rev"], 2);
            assert_eq!(records[0]["title"], "Monstera in the study");
            assert!(
                records[0]["icon"].is_null(),
                "the record carries no icon of its own"
            );
            assert_eq!(records[0]["type_key"], "plant");
            assert_eq!(records[0]["type_name"], "Plant");
            assert_eq!(records[0]["field"], "cover");
            assert_eq!(records[0]["field_name"], "Cover");
            assert_eq!(records[0]["trashed"], false);
            assert!(records[0]["updated_at"].is_string());

            assert_eq!(items[1]["name"], "notes.pdf");
            assert_eq!(items[1]["path"], guide_path.as_str());
            assert_eq!(items[1]["kind"], "file");
            assert_eq!(items[1]["size"], guide.len());
            assert_eq!(items[1]["unused"], false);
            assert_eq!(items[1]["records"][0]["field"], "photos");
            assert_eq!(items[1]["records"][0]["field_name"], "Photos");

            let total = (photo.len() + guide.len()) as u64;
            assert_eq!(library.body["total_bytes"], total);
            assert_eq!(library.body["unused_bytes"], 0);

            // An upload no record names is a card with no chips.
            let extra = encoded_png(40, 40, false);
            let (_, extra_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "extra.png",
                "image/png",
                &extra,
            )
            .await;
            let library = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/files", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            let items = library.body["items"].as_array().expect("items");
            assert_eq!(items.len(), 3);
            let orphan = items
                .iter()
                .find(|item| item["path"] == extra_path.as_str())
                .expect("the unattached upload is listed");
            assert_eq!(orphan["unused"], true);
            assert_eq!(orphan["records"], json!([]));
            assert_eq!(library.body["total_bytes"], total + extra.len() as u64);
            assert_eq!(library.body["unused_bytes"], extra.len() as u64);
        });
    }

    #[test]
    fn the_library_answers_a_viewer_and_hides_from_a_stranger() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server
                .register("library-role-owner@example.com", None)
                .await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let url = format!("/api/spaces/{}/files", garden.space);

            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", garden.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server
                .register("library-viewer@example.com", Some(&code))
                .await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let viewed = server.call("GET", &url, None, Some(&viewer_cookie)).await;
            assert_eq!(viewed.status, StatusCode::OK, "{:?}", viewed.body);
            assert_eq!(viewed.body["items"], json!([]));

            // A member of another space cannot read this one's library.
            let work = create_space(&server, &cookie, "Work").await;
            let work_invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{work}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let work_code = work_invite.body["code"]
                .as_str()
                .expect("a code")
                .to_owned();
            let stranger = server
                .register("library-stranger@example.com", Some(&work_code))
                .await;
            let stranger_cookie = cookie_of(&stranger).to_owned();
            let hidden = server.call("GET", &url, None, Some(&stranger_cookie)).await;
            assert_eq!(hidden.status, StatusCode::NOT_FOUND);
            assert_eq!(hidden.code(), "not_found");
        });
    }

    #[test]
    fn a_trashed_use_is_listed_and_keeps_its_bytes_off_the_unused_list() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server
                .register("library-trash-owner@example.com", None)
                .await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            photos_property(&server, &cookie, &garden.space).await;

            let photo = encoded_png(300, 120, false);
            let (_, photo_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "fern.png",
                "image/png",
                &photo,
            )
            .await;
            let second = encoded_png(120, 300, false);
            let (_, second_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "fern-two.png",
                "image/png",
                &second,
            )
            .await;
            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({
                        "rev": 1,
                        "properties": { "photos": [photo_path, second_path] },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let trashed = server
                .call(
                    "DELETE",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(trashed.status, StatusCode::OK, "{:?}", trashed.body);

            let library = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/files", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(library.status, StatusCode::OK, "{:?}", library.body);
            let items = library.body["items"].as_array().expect("items");
            assert_eq!(items.len(), 2);
            for item in items {
                assert_eq!(item["unused"], false);
                assert_eq!(item["records"][0]["trashed"], true);
            }
            assert_eq!(library.body["unused_bytes"], 0);

            // A trashed reference is a reference: collection keeps the bytes.
            let collected = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/files/gc", garden.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(collected.status, StatusCode::OK, "{:?}", collected.body);
            assert_eq!(collected.body["removed"], 0);
            assert_eq!(
                attachment_count(&server, &garden.space),
                2,
                "both list entries are references"
            );
        });
    }

    #[test]
    fn csv_carries_attachment_lists_and_refuses_a_missing_path() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("csv-photos@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            photos_property(&server, &cookie, &garden.space).await;

            let photo = encoded_png(300, 120, false);
            let (_, photo_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "monstera.png",
                "image/png",
                &photo,
            )
            .await;
            let guide = b"plain notes";
            let (_, guide_path) = upload_file(
                &server,
                &garden.space,
                &cookie,
                "notes.txt",
                "text/plain",
                guide,
            )
            .await;
            let patched = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/objects/{}", garden.space, garden.plant),
                    Some(json!({
                        "rev": 1,
                        "properties": { "photos": [photo_path, guide_path] },
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(patched.status, StatusCode::OK, "{:?}", patched.body);

            let exported = server
                .call_raw(
                    "GET",
                    &format!("/api/spaces/{}/types/plant/export", garden.space),
                    None,
                    &[],
                    Some(&cookie),
                )
                .await;
            assert_eq!(exported.status, StatusCode::OK);
            let text = exported.text();
            let header = text
                .trim_start_matches('\u{feff}')
                .lines()
                .next()
                .expect("a header");
            assert_eq!(header, "title,room,photos,_body");
            assert!(text.contains(&photo_path), "{text}");
            assert!(text.contains(&guide_path), "{text}");

            // Importing the same array creates another record.
            let field = format!(
                "\"{}\"",
                serde_json::to_string(&vec![photo_path.as_str(), guide_path.as_str()])
                    .expect("a JSON array")
                    .replace('"', "\"\"")
            );
            let csv = format!("title,room,photos\nFern by the door,kitchen,{field}\n");
            let imported = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{}/types/plant/import", garden.space),
                    Some("text/csv"),
                    csv.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(imported.status, StatusCode::CREATED, "{:?}", imported.body);

            // A path the space cannot serve is a row error naming the field.
            let absent = format!("files/{}/ghost.png", "b".repeat(64));
            let field = format!(
                "\"{}\"",
                serde_json::to_string(&vec![absent.as_str()])
                    .expect("a JSON array")
                    .replace('"', "\"\"")
            );
            let missing = format!("title,room,photos\nMoss,kitchen,{field}\n");
            let refused = server
                .call_raw(
                    "POST",
                    &format!("/api/spaces/{}/types/plant/import", garden.space),
                    Some("text/csv"),
                    missing.as_bytes(),
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
            let problem = &refused.body["error"]["details"]["errors"][0];
            assert_eq!(problem["row"], 1);
            assert_eq!(problem["field"], "photos");
            assert!(
                problem["message"]
                    .as_str()
                    .expect("a message")
                    .contains(&absent)
            );
        });
    }
    #[test]
    fn a_promotion_plan_is_read_by_an_editor_and_targets_is_idempotent() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &owner_cookie, "Records").await;

            for (method, path, body) in [
                (
                    "POST",
                    format!("/api/spaces/{space}/types"),
                    json!({ "name": "Album" }),
                ),
                (
                    "POST",
                    format!("/api/spaces/{space}/properties"),
                    json!({ "name": "Artist", "format": "text" }),
                ),
                (
                    "PATCH",
                    format!("/api/spaces/{space}/types/album"),
                    json!({ "properties": [{ "key": "artist", "featured": true }] }),
                ),
            ] {
                let reply = server
                    .call(method, &path, Some(body), Some(&owner_cookie))
                    .await;
                assert!(reply.status.is_success(), "{:?}", reply.body);
            }

            for (title, artist) in [
                ("Kind of Blue", "Miles Davis"),
                ("A Love Supreme", "John Coltrane"),
                ("Bitches Brew", "Miles Davis"),
            ] {
                let reply = server
                    .call(
                        "POST",
                        &format!("/api/spaces/{space}/objects"),
                        Some(json!({
                            "type": "album",
                            "title": title,
                            "properties": { "artist": artist },
                        })),
                        Some(&owner_cookie),
                    )
                    .await;
                assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
            }

            let promote = format!("/api/spaces/{space}/types/album/promote");
            let plan = server
                .call(
                    "POST",
                    &promote,
                    Some(json!({
                        "stage": "plan",
                        "property": "artist",
                        "target": { "name": "Artist", "name_plural": "Artists" },
                        "relation_name": "Artist",
                        "multi": false,
                    })),
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(plan.status, StatusCode::OK, "{:?}", plan.body);
            assert_eq!(plan.body["source"]["records"], 3);
            assert_eq!(plan.body["source"]["distinct"], 2);
            assert_eq!(plan.body["source"]["empty"], 0);
            assert_eq!(plan.body["target"]["key"], "artist");
            assert_eq!(plan.body["target"]["create"], true);
            assert_eq!(plan.body["target"]["create_records"], 2);
            assert_eq!(plan.body["relation"]["key"], "artist_ref");
            assert_eq!(plan.body["links"], 3);
            assert_eq!(plan.body["blocking"], json!([]));

            // A viewer may read the plan's source column but not ask for one.
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{space}/invites"),
                    Some(json!({ "role": "viewer" })),
                    Some(&owner_cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server.register("viewer@example.com", Some(&code)).await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let refused = server
                .call(
                    "POST",
                    &promote,
                    Some(json!({
                        "stage": "targets",
                        "property": "artist",
                        "target": { "name": "Artist" },
                        "relation_name": "Artist",
                        "multi": false,
                    })),
                    Some(&viewer_cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::FORBIDDEN);

            let targets = json!({
                "stage": "targets",
                "property": "artist",
                "target": { "name": "Artist", "name_plural": "Artists" },
                "relation_name": "Artist",
                "multi": false,
            });
            let first = server
                .call("POST", &promote, Some(targets.clone()), Some(&owner_cookie))
                .await;
            assert_eq!(first.status, StatusCode::OK, "{:?}", first.body);
            assert_eq!(first.body["type"], "artist");
            assert_eq!(first.body["type_created"], true);
            assert_eq!(first.body["created"], 2);
            let ids = first.body["records"].clone();
            assert_eq!(ids.as_array().expect("records").len(), 2);
            assert!(ids.as_array().expect("records").iter().all(|row| {
                row["exists"] == false && row["title"].as_str().is_some_and(|t| !t.is_empty())
            }));

            // The retry names the derived key, creates nothing and returns the
            // same ids.
            let again = server
                .call("POST", &promote, Some(targets), Some(&owner_cookie))
                .await;
            assert_eq!(again.status, StatusCode::OK, "{:?}", again.body);
            assert_eq!(again.body["type_created"], false);
            assert_eq!(again.body["created"], 0);
            let again_ids: Vec<Value> = again.body["records"]
                .as_array()
                .expect("records")
                .iter()
                .map(|row| row["id"].clone())
                .collect();
            let first_ids: Vec<Value> = ids
                .as_array()
                .expect("records")
                .iter()
                .map(|row| row["id"].clone())
                .collect();
            assert_eq!(again_ids, first_ids);

            let detail = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/types/artist"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(detail.status, StatusCode::OK);
            assert_eq!(detail.body["name"], "Artist");
            assert_eq!(detail.body["views"][0]["key"], "all");
        });
    }

    #[test]
    fn promotion_links_objects_and_finish_restores_the_source_key() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("owner@example.com", None).await;
            let owner_cookie = cookie_of(&owner).to_owned();
            let space = create_space(&server, &owner_cookie, "Records").await;

            for (method, path, body) in [
                (
                    "POST",
                    format!("/api/spaces/{space}/types"),
                    json!({ "name": "Album" }),
                ),
                (
                    "POST",
                    format!("/api/spaces/{space}/properties"),
                    json!({ "name": "Artist", "format": "text" }),
                ),
                (
                    "PATCH",
                    format!("/api/spaces/{space}/types/album"),
                    json!({ "properties": [{ "key": "artist", "featured": true }] }),
                ),
                (
                    "PATCH",
                    format!("/api/spaces/{space}/types/album/views/all"),
                    json!({
                        "columns": ["title", "artist"],
                        "sorts": [{ "property": "artist", "direction": "asc", "empty": "end" }],
                        "filter": {
                            "op": "and",
                            "conditions": [
                                { "property": "artist", "condition": "equal", "value": "Miles Davis" },
                                { "property": "artist", "condition": "is_not_empty" }
                            ]
                        }
                    }),
                ),
            ] {
                let reply = server
                    .call(method, &path, Some(body), Some(&owner_cookie))
                    .await;
                assert!(reply.status.is_success(), "{:?}", reply.body);
            }

            let mut blue = Value::Null;
            for (title, artist) in [
                ("Kind of Blue", "Miles Davis"),
                ("A Love Supreme", "John Coltrane"),
                ("Bitches Brew", "Miles Davis"),
            ] {
                let reply = server
                    .call(
                        "POST",
                        &format!("/api/spaces/{space}/objects"),
                        Some(json!({
                            "type": "album",
                            "title": title,
                            "properties": { "artist": artist },
                        })),
                        Some(&owner_cookie),
                    )
                    .await;
                assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
                if title == "Kind of Blue" {
                    blue = reply.body["id"].clone();
                }
            }
            let blue = blue.as_str().expect("an id").to_owned();

            let promote = format!("/api/spaces/{space}/types/album/promote");
            let options = json!({
                "property": "artist",
                "target": { "name": "Artist", "name_plural": "Artists" },
                "relation_name": "Artist",
                "multi": false,
            });
            let mut plan_request = options.clone();
            plan_request["stage"] = json!("plan");
            let plan = server
                .call("POST", &promote, Some(plan_request), Some(&owner_cookie))
                .await;
            assert_eq!(plan.status, StatusCode::OK, "{:?}", plan.body);
            assert_eq!(plan.body["views"][0]["sorts"], 1);
            assert_eq!(plan.body["views"][0]["filters_moved"], 1);
            assert_eq!(plan.body["views"][0]["filters_dropped"], 1);

            // Linking before the targets exist is refused and leaves nothing.
            let mut premature = options.clone();
            premature["stage"] = json!("links");
            premature["target_type"] = json!("artist");
            let refused = server
                .call("POST", &promote, Some(premature), Some(&owner_cookie))
                .await;
            assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY, "{:?}", refused.body);

            let mut targets = options.clone();
            targets["stage"] = json!("targets");
            let created = server
                .call("POST", &promote, Some(targets.clone()), Some(&owner_cookie))
                .await;
            assert_eq!(created.status, StatusCode::OK, "{:?}", created.body);
            assert_eq!(created.body["created"], 2);

            let mut links = options.clone();
            links["stage"] = json!("links");
            links["target_type"] = json!("artist");
            let linked = server
                .call("POST", &promote, Some(links.clone()), Some(&owner_cookie))
                .await;
            assert_eq!(linked.status, StatusCode::OK, "{:?}", linked.body);
            assert_eq!(linked.body["property"], "artist_ref");
            assert_eq!(linked.body["created"], true);
            assert_eq!(linked.body["links"], 3);
            assert_eq!(linked.body["filters_dropped"], 1);

            // A retry links nothing and creates nothing.
            let again = server
                .call("POST", &promote, Some(links), Some(&owner_cookie))
                .await;
            assert_eq!(again.status, StatusCode::OK, "{:?}", again.body);
            assert_eq!(again.body["created"], false);
            assert_eq!(again.body["links"], 0);

            let album = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/types/album"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(album.status, StatusCode::OK, "{:?}", album.body);
            let members: Vec<&str> = album.body["properties"]
                .as_array()
                .expect("members")
                .iter()
                .filter_map(|member| member["key"].as_str())
                .collect();
            assert!(members.contains(&"artist_ref"));
            assert_eq!(album.body["views"][0]["columns"], json!(["title", "artist_ref"]));
            assert_eq!(album.body["views"][0]["sorts"][0]["property"], "artist_ref");
            assert_eq!(album.body["views"][0]["filter"]["conditions"].as_array().expect("conditions").len(), 1);
            assert_eq!(
                album.body["views"][0]["filter"]["conditions"][0]["condition"],
                "is_not_empty"
            );

            let record = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/objects/{blue}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(record.status, StatusCode::OK, "{:?}", record.body);
            assert!(record.body["properties"]["artist_ref"]["value"].is_string());

            let mut finish = options.clone();
            finish["stage"] = json!("finish");
            finish["target_type"] = json!("artist");
            let finished = server
                .call("POST", &promote, Some(finish.clone()), Some(&owner_cookie))
                .await;
            assert_eq!(finished.status, StatusCode::OK, "{:?}", finished.body);
            assert_eq!(finished.body["key"], "artist");
            assert_eq!(finished.body["finished"], true);

            // Rerunning finish changes nothing and stays a success.
            let noop = server
                .call("POST", &promote, Some(finish), Some(&owner_cookie))
                .await;
            assert_eq!(noop.status, StatusCode::OK, "{:?}", noop.body);
            assert_eq!(noop.body["finished"], false);

            let album = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/types/album"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            let members: Vec<&str> = album.body["properties"]
                .as_array()
                .expect("members")
                .iter()
                .filter_map(|member| member["key"].as_str())
                .collect();
            assert_eq!(members, vec!["artist"]);
            assert_eq!(album.body["views"][0]["columns"], json!(["title", "artist"]));
            assert_eq!(album.body["views"][0]["sorts"][0]["property"], "artist");

            let artist = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/properties/artist"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(artist.status, StatusCode::OK, "{:?}", artist.body);
            assert_eq!(artist.body["format"], "relation");
            assert_eq!(artist.body["target_type"], "artist");
            assert_eq!(artist.body["name"], "Artist");

            let record = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/objects/{blue}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(record.status, StatusCode::OK, "{:?}", record.body);
            let target_id = record.body["properties"]["artist"]["value"]
                .as_str()
                .expect("a relation id")
                .to_owned();
            assert!(
                record.body["properties"].get("artist_ref").is_none(),
                "{:?}",
                record.body["properties"]
            );

            // The target record the link points at carries the artist title.
            let target = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/objects/{target_id}"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(target.status, StatusCode::OK, "{:?}", target.body);
            assert_eq!(target.body["title"], "Miles Davis");
            assert_eq!(target.body["type"], "artist");

            // The old text value is still readable in the record's history.
            let history = server
                .call(
                    "GET",
                    &format!("/api/spaces/{space}/objects/{blue}/history"),
                    None,
                    Some(&owner_cookie),
                )
                .await;
            assert_eq!(history.status, StatusCode::OK, "{:?}", history.body);
            assert!(
                history.body
                    .as_array()
                    .expect("revisions")
                    .iter()
                    .any(|revision| revision["snapshot"]["properties"]["artist"] == "Miles Davis"),
                "{:?}",
                history.body
            );
        });
    }

    #[test]
    fn computed_values_read_filter_and_sort_through_the_list_and_detail() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let world = computed_garden(&server, &cookie).await;
            let objects = format!("/api/spaces/{}/objects", world.space);

            let list = server
                .call("GET", &format!("{objects}?type=plant&view=all"), None, Some(&cookie))
                .await;
            assert_eq!(list.status, StatusCode::OK, "{:?}", list.body);
            let monstera = row_for(&list.body, &world.monstera);
            assert_eq!(
                monstera["values"]["label"],
                json!({
                    "value": "Monstera in the study / kitchen",
                    "label": "Monstera in the study / kitchen"
                })
            );
            assert_eq!(
                monstera["values"]["related_count"],
                json!({ "value": 2.0, "label": "2" })
            );
            assert_eq!(
                monstera["values"]["related_titles"],
                json!({ "value": ["Fern by the window", "Ivy on the shelf"], "label": "Fern by the window, Ivy on the shelf" }),
                "a list cell joins its display labels"
            );
            let fern = row_for(&list.body, &world.fern);
            assert_eq!(fern["values"]["related_count"], json!({ "value": 0.0, "label": "0" }));

            let filtered = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=all&filter={}",
                        url_encoded(
                            &json!({
                                "op": "and",
                                "conditions": [{
                                    "property": "related_count",
                                    "condition": "equal",
                                    "value": 2
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
            assert_eq!(filtered.body["objects"][0]["id"], world.monstera.as_str());

            let sorted = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=all&sorts={}",
                        url_encoded(
                            &json!([{ "property": "label", "direction": "asc" }]).to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(sorted.status, StatusCode::OK, "{:?}", sorted.body);
            assert_eq!(sorted.body["objects"][0]["id"], world.fern.as_str());
            let filtered_label = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=all&filter={}",
                        url_encoded(
                            &json!({
                                "op": "and",
                                "conditions": [{
                                    "property": "label",
                                    "condition": "contains",
                                    "value": "Fern"
                                }]
                            })
                            .to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(filtered_label.status, StatusCode::OK, "{:?}", filtered_label.body);
            assert_eq!(filtered_label.body["total"], 1);
            assert_eq!(filtered_label.body["objects"][0]["id"], world.fern.as_str());

            let sorted_count = server
                .call(
                    "GET",
                    &format!(
                        "{objects}?type=plant&view=all&sorts={}",
                        url_encoded(
                            &json!([{ "property": "related_count", "direction": "desc" }])
                                .to_string()
                        )
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(sorted_count.status, StatusCode::OK, "{:?}", sorted_count.body);
            assert_eq!(sorted_count.body["objects"][0]["id"], world.monstera.as_str());

            let detail = server
                .call(
                    "GET",
                    &format!("{objects}/{}", world.monstera),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(detail.status, StatusCode::OK, "{:?}", detail.body);
            assert_eq!(
                detail.body["properties"]["label"],
                json!({
                    "value": "Monstera in the study / kitchen",
                    "label": "Monstera in the study / kitchen"
                })
            );
            assert_eq!(
                detail.body["properties"]["related_titles"],
                json!({ "value": ["Fern by the window", "Ivy on the shelf"], "label": "Fern by the window, Ivy on the shelf" })
            );

            // A viewer reads the same derived values.
            let invite = server
                .call(
                    "POST",
                    &format!("/api/spaces/{}/invites", world.space),
                    Some(json!({ "role": "viewer" })),
                    Some(&cookie),
                )
                .await;
            let code = invite.body["code"].as_str().expect("a code").to_owned();
            let viewer = server.register("computed-viewer@example.com", Some(&code)).await;
            let viewer_cookie = cookie_of(&viewer).to_owned();
            let seen = server
                .call("GET", &format!("{objects}?type=plant&view=all"), None, Some(&viewer_cookie))
                .await;
            assert_eq!(seen.status, StatusCode::OK, "{:?}", seen.body);
            assert_eq!(
                row_for(&seen.body, &world.monstera)["values"]["related_count"]["label"],
                "2"
            );
        });
    }

    #[test]
    fn a_stored_value_on_a_computed_key_is_refused_on_create_and_update() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed-writes@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let world = computed_garden(&server, &cookie).await;
            let objects = format!("/api/spaces/{}/objects", world.space);

            let created = server
                .call(
                    "POST",
                    &objects,
                    Some(json!({
                        "type": "plant",
                        "title": "Written count",
                        "properties": { "related_count": 5 }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                created.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                created.body
            );
            assert_eq!(created.field(), "related_count");
            assert!(
                created.body["error"]["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("computed and read-only"))
            );

            let patched = server
                .call(
                    "PATCH",
                    &format!("{objects}/{}", world.monstera),
                    Some(json!({
                        "rev": 2,
                        "properties": { "related_count": 5 }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                patched.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                patched.body
            );
            assert_eq!(patched.field(), "related_count");
        });
    }

    #[test]
    fn computed_definitions_are_checked_where_they_gain_context() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed-defs@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let garden = garden(&server, &cookie).await;
            let properties = format!("/api/spaces/{}/properties", garden.space);

            let stored_list = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({ "name": "Titles", "format": "list" })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                stored_list.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                stored_list.body
            );
            assert_eq!(stored_list.field(), "format");

            let broken = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({
                        "name": "Broken",
                        "format": "number",
                        "compute": { "kind": "formula", "expression": "missing + 1" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(broken.status, StatusCode::CREATED, "{:?}", broken.body);

            let added = server
                .call(
                    "PATCH",
                    &format!("/api/spaces/{}/types/plant", garden.space),
                    Some(json!({
                        "properties": [{ "key": "room" }, { "key": "broken" }]
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                added.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                added.body
            );
            assert_eq!(added.field(), "compute.expression");
            assert!(
                added.body["error"]["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("unknown property `missing`"))
            );

            let kind = |kind: &str, aggregate: Option<&str>| {
                let mut compute = json!({ "kind": kind });
                if let Some(aggregate) = aggregate {
                    compute["relation"] = json!("room");
                    compute["aggregate"] = json!(aggregate);
                }
                compute
            };
            let formula = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({
                        "name": "Computed",
                        "format": "number",
                        "compute": kind("formula", None)
                    })),
                    Some(&cookie),
                )
                .await;
            // A formula without an expression is refused up front.
            assert_eq!(
                formula.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                formula.body
            );
            assert_eq!(formula.field(), "compute.expression");

            let valid = server
                .call(
                    "POST",
                    &properties,
                    Some(json!({
                        "name": "Age",
                        "format": "number",
                        "compute": { "kind": "formula", "expression": "1 + 1" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(valid.status, StatusCode::CREATED, "{:?}", valid.body);

            let changed_kind = server
                .call(
                    "PATCH",
                    &format!("{properties}/age"),
                    Some(json!({
                        "compute": kind("rollup", Some("count"))
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                changed_kind.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                changed_kind.body
            );
            assert_eq!(changed_kind.field(), "compute.kind");
            assert!(changed_kind.body["error"]["message"].as_str().is_some_and(
                |message| message == "the calculation kind is fixed once the property exists"
            ));

            let stored = server
                .call(
                    "PATCH",
                    &format!("{properties}/room"),
                    Some(json!({
                        "compute": { "kind": "formula", "expression": "1 + 1" }
                    })),
                    Some(&cookie),
                )
                .await;
            assert_eq!(
                stored.status,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{:?}",
                stored.body
            );
            assert_eq!(stored.field(), "compute");
            assert!(
                stored.body["error"]["message"].as_str().is_some_and(
                    |message| message.contains("stored property cannot become calculated")
                )
            );
        });
    }

    #[test]
    fn a_type_a_rollup_targets_cannot_be_deleted() {
        let server = server();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let owner = server.register("computed-delete@example.com", None).await;
            let cookie = cookie_of(&owner).to_owned();
            let world = computed_garden(&server, &cookie).await;

            let refused = server
                .call(
                    "DELETE",
                    &format!(
                        "/api/spaces/{}/types/plant?delete_objects=true",
                        world.space
                    ),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.body);
            assert_eq!(
                refused.body["error"]["details"]["reason"],
                "computed properties use type"
            );
            let holders = refused.body["error"]["details"]["properties"]
                .as_array()
                .expect("properties");
            assert!(
                holders.iter().any(|key| key == "related_count"),
                "{holders:?}"
            );

            // Nothing was trashed before the refusal.
            let list = server
                .call(
                    "GET",
                    &format!("/api/spaces/{}/objects?type=plant&view=all", world.space),
                    None,
                    Some(&cookie),
                )
                .await;
            assert_eq!(list.status, StatusCode::OK, "{:?}", list.body);
            assert_eq!(list.body["total"], 3);
        });
    }
}
