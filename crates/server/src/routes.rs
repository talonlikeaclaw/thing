//! The HTTP surface: health, the API's JSON 404, and the SPA fallback.

use axum::http::{Method, StatusCode, Uri};
use axum::routing::{any, get};
use axum::{Json, Router};
use serde_json::{Value, json};
use thing_core::error::CoreError;
use thing_core::index::Problems;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::error::ApiError;

pub fn router(config: &Config) -> Router {
    // The API's catch-all is a route, not a fallback, so a mistyped `/api/...`
    // path is JSON here and never the SPA's `index.html`; the paths that exist
    // are registered above it and win over the catch-all.
    let app = Router::new()
        .route("/api/health", get(health))
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
    app.layer(TraceLayer::new_for_http())
}

/// `GET /api/health` — the only route that exists before auth does.
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
