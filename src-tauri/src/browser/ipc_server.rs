//! Local IPC HTTP & WebSocket Server (`http://127.0.0.1:45678`)
//! Receives intercepted downloads, streaming video/audio URLs, cookies, referers, and auth headers
//! from X Download Manager's Chrome, Firefox, and Safari browser extensions.

use axum::{
    extract::{Json, Query, State},
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tower_http::cors::CorsLayer;

use crate::engine::{DownloadEngine, NewDownloadRequest};

static LAST_BROWSER_HEARTBEATS: OnceLock<RwLock<HashMap<String, Instant>>> = OnceLock::new();

fn get_heartbeat_map() -> &'static RwLock<HashMap<String, Instant>> {
    LAST_BROWSER_HEARTBEATS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn record_browser_heartbeat(browser: &str) {
    let b = browser.trim().to_lowercase();
    if !b.is_empty() {
        get_heartbeat_map().write().insert(b, Instant::now());
    }
}

pub fn is_browser_connected(browser_id: &str, display_name: &str) -> bool {
    let map = get_heartbeat_map().read();
    let b_id = browser_id.to_lowercase();
    let d_name = display_name.to_lowercase();
    for (k, instant) in map.iter() {
        if instant.elapsed().as_secs() < 90
            && (k == &b_id
                || k.contains(&b_id)
                || b_id.contains(k)
                || k.contains(&d_name)
                || d_name.contains(k))
        {
            return true;
        }
    }
    false
}

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
    pub auth_username: Option<String>,
    pub auth_password: Option<String>,
    pub is_torrent: Option<bool>,
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

async fn handle_status(
    State(engine): State<Arc<DownloadEngine>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<IpcStatusResponse> {
    if let Some(browser) = params.get("browser") {
        record_browser_heartbeat(browser);
    }
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
    record_browser_heartbeat(&payload.browser);
    let is_torrent = payload.is_torrent.unwrap_or(false)
        || payload
            .url
            .split('?')
            .next()
            .unwrap_or("")
            .to_lowercase()
            .ends_with(".torrent");

    let category = if is_torrent {
        Some("Torrents".to_string())
    } else {
        None
    };

    let req = NewDownloadRequest {
        url: payload.url,
        filename: payload.filename,
        category,
        save_path: None,
        threads_count: None,
        queue_id: Some("main-queue".to_string()),
        start_immediately: true,
        source_browser: Some(payload.browser),
        referer: payload.referer,
        cookies: payload.cookies,
        user_agent: payload.user_agent,
        custom_headers: payload.headers,
        auth_username: payload.auth_username,
        auth_password: payload.auth_password,
        sequential_torrent: if is_torrent { Some(true) } else { None },
    };

    let created = engine.add_download(req.clone());
    let started = engine.start_download_execution(created, &req).await;
    Json(serde_json::json!({
        "accepted": true,
        "download_id": started.id,
        "filename": started.filename
    }))
}

async fn handle_list_downloads(
    State(engine): State<Arc<DownloadEngine>>,
) -> Json<serde_json::Value> {
    let list = engine.downloads.read().clone();
    Json(serde_json::json!({ "downloads": list }))
}
