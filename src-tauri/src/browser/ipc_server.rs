//! Local IPC HTTP & WebSocket Server (`http://127.0.0.1:45678`)
//! Receives intercepted downloads, streaming video/audio URLs, cookies, referers, and auth headers
//! from X Download Manager's Chrome, Firefox, and Safari browser extensions.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use axum::{
    extract::{State, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

use crate::engine::{DownloadEngine, NewDownloadRequest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserInterceptPayload {
    pub url: String,
    pub filename: Option<String>,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub browser: String, // "chrome" | "firefox" | "safari" | "brave" | "edge"
    pub tab_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcStatusResponse {
    pub app: String,
    pub version: String,
    pub intercept_enabled: bool,
    pub min_file_size_kb: u64,
    pub intercepted_extensions: Vec<String>,
    pub ignored_domains: Vec<String>,
    pub bypass_key: String,
}

pub async fn start_browser_ipc_server(engine: Arc<DownloadEngine>, port: u16) {
    let app = Router::new()
        .route("/api/v1/status", get(handle_status))
        .route("/api/v1/intercept", post(handle_intercept))
        .route("/api/v1/downloads", get(handle_list_downloads))
        .layer(CorsLayer::permissive())
        .with_state(engine);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("XDM Browser IPC bridge listening on http://{}", addr);

    if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
        let _ = axum::serve(listener, app).await;
    }
}

async fn handle_status(State(engine): State<Arc<DownloadEngine>>) -> Json<IpcStatusResponse> {
    let st = engine.settings.read();
    Json(IpcStatusResponse {
        app: "X Download Manager".to_string(),
        version: "1.0.0".to_string(),
        intercept_enabled: st.browser.intercept_all_downloads,
        min_file_size_kb: st.browser.min_file_size_kb,
        intercepted_extensions: st.browser.intercepted_extensions.clone(),
        ignored_domains: st.browser.ignored_domains.clone(),
        bypass_key: st.browser.bypass_key.clone(),
    })
}

async fn handle_intercept(
    State(engine): State<Arc<DownloadEngine>>,
    Json(payload): Json<BrowserInterceptPayload>,
) -> Json<serde_json::Value> {
    let req = NewDownloadRequest {
        url: payload.url,
        filename: payload.filename,
        category: None,
        save_path: None,
        threads_count: None,
        queue_id: Some("main-queue".to_string()),
        start_immediately: true,
        source_browser: Some(payload.browser),
        referer: payload.referer,
        cookies: payload.cookies,
        user_agent: payload.user_agent,
        custom_headers: payload.headers,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
    };

    let created = engine.add_download(req);
    Json(serde_json::json!({
        "accepted": true,
        "download_id": created.id,
        "filename": created.filename
    }))
}

async fn handle_list_downloads(
    State(engine): State<Arc<DownloadEngine>>,
) -> Json<serde_json::Value> {
    let list = engine.downloads.read().clone();
    Json(serde_json::json!({ "downloads": list }))
}
