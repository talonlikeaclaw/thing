//! The HTTP surface: routing, the shared request plumbing, and the SPA fallback.
//!
//! Every error leaves as the same `{"error":{code,message,details}}` envelope,
//! including a malformed body or path parameter — which is why requests are
//! extracted through [`ApiJson`] and parsed with [`uuid_param`] rather than
//! axum's own rejections.

mod auth;
mod spaces;

use std::sync::Arc;

use axum::extract::{FromRequest, Request};
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
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
    app.layer(TraceLayer::new_for_http()).with_state(state)
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

/// A path parameter that must be a UUID; anything else is a `422` naming it.
pub fn uuid_param(value: &str, field: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::validation(field, format!("{value} is not an id")))
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
        let router = router(&config, AppState::new(config.clone(), registry, accounts));
        Server {
            _root: root,
            router,
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
}
