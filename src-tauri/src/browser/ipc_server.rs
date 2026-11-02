//! Local IPC HTTP & WebSocket Server (`http://127.0.0.1:45678`)
//! Receives intercepted downloads, cookies, referers, and auth headers
//! from ByteX Download Manager's Chrome, Firefox, and Safari browser extensions.

use axum::{
    extract::{Json, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tauri::{Emitter, Manager};
use tower_http::cors::CorsLayer;

use crate::browser::{detect_browsers, BrowserStatus, SUPPORTED_BROWSERS};
use crate::engine::{DownloadEngine, DownloadItem, DuplicateDownloadNotice, NewDownloadRequest};

static LAST_BROWSER_HEARTBEATS: OnceLock<RwLock<HashMap<String, Instant>>> = OnceLock::new();
static UPDATE_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn get_heartbeat_map() -> &'static RwLock<HashMap<String, Instant>> {
    LAST_BROWSER_HEARTBEATS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn record_browser_heartbeat(browser: &str) {
    let b = browser.trim().to_lowercase();
    if !b.is_empty() {
        let mut map = get_heartbeat_map().write();
        map.insert(b.clone(), Instant::now());
    }
}

pub fn is_browser_connected(browser_id: &str, display_name: &str) -> bool {
    let map = get_heartbeat_map().read();
    let b_id = browser_id.to_lowercase();
    let d_name = display_name.to_lowercase();
    for (k, instant) in map.iter() {
        if instant.elapsed().as_secs() < 3600 && (k == &b_id || k == &d_name) {
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
    pub browser_name: Option<String>,
}

fn resolve_browser_name(hint: &str, settings: &crate::config::AppSettings) -> String {
    let matching_hint = SUPPORTED_BROWSERS
        .iter()
        .find(|(id, name, _)| id.eq_ignore_ascii_case(hint) || name.eq_ignore_ascii_case(hint));
    if let Some((id, name, family)) = matching_hint {
        // The family engine IDs (chromium, firefox, safari) identify generic
        // WebExtension builds. Resolve those to the installed browser when the
        // family is unambiguous, while preserving explicit browser names.
        if *id == *family {
            let detected: Vec<BrowserStatus> = detect_browsers(settings)
                .into_iter()
                .filter(|browser| browser.family == *family && browser.detected_installed)
                .collect();
            if let Some(name) = unique_installed_browser_name(true, &detected) {
                return name;
            }
        }
        return (*name).to_string();
    }
    hint.to_string()
}

fn unique_installed_browser_name(
    generic_engine: bool,
    installed: &[BrowserStatus],
) -> Option<String> {
    (generic_engine && installed.len() == 1).then(|| installed[0].display_name.clone())
}

fn normalized_download_url(value: &str) -> String {
    match url::Url::parse(value.trim()) {
        Ok(mut parsed) => {
            parsed.set_fragment(None);
            parsed.to_string()
        }
        Err(_) => value.trim().to_string(),
    }
}

fn find_duplicate_download(engine: &DownloadEngine, url: &str) -> Option<DownloadItem> {
    let candidate = normalized_download_url(url);
    let active_ids = engine
        .active_cancellations
        .read()
        .keys()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    engine.downloads.read().iter().find_map(|download| {
        let actively_managed = matches!(
            download.status,
            crate::engine::DownloadStatus::Queued
                | crate::engine::DownloadStatus::Connecting
                | crate::engine::DownloadStatus::Authenticating
                | crate::engine::DownloadStatus::Downloading
                | crate::engine::DownloadStatus::Merging
                | crate::engine::DownloadStatus::Seeding
        );
        let output_still_exists = crate::config::resolve_path(&download.save_path).exists();
        // A stale record with deleted partial output must not claim a browser
        // retry as a duplicate. Keep guarding active requests that have not
        // created their output yet.
        let pending_without_output = download.status == crate::engine::DownloadStatus::Queued
            || (actively_managed
                && download.downloaded_bytes == 0
                && active_ids.contains(&download.id));
        if !output_still_exists && !pending_without_output {
            return None;
        }
        let matches = std::iter::once(download.url.as_str())
            .chain(download.resolved_url.as_deref())
            .any(|existing| same_download_url(&candidate, existing));
        matches.then(|| download.clone())
    })
}

fn same_download_url(normalized_candidate: &str, existing: &str) -> bool {
    normalized_download_url(existing) == normalized_candidate
}

pub async fn start_browser_ipc_server(
    engine: Arc<DownloadEngine>,
    port: u16,
    app_handle: tauri::AppHandle,
) {
    let _ = UPDATE_APP_HANDLE.set(app_handle);
    let app = Router::new()
        .route("/api/v1/status", get(handle_status))
        .route("/api/v1/intercept", post(handle_intercept))
        .route("/api/v1/prepare-update", post(handle_prepare_update))
        .route("/api/v1/downloads", get(handle_list_downloads))
        .layer(CorsLayer::permissive())
        .with_state(engine);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("XDM Browser IPC bridge listening on http://{}", addr);

    if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
        let _ = axum::serve(listener, app).await;
    }
}

async fn handle_prepare_update(
    State(engine): State<Arc<DownloadEngine>>,
    headers: HeaderMap,
) -> (StatusCode, Json<serde_json::Value>) {
    // Only local installer/CLI requests are accepted. This prevents an arbitrary
    // website from triggering a cross-origin quit through the loopback bridge.
    if headers.contains_key(axum::http::header::ORIGIN) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "accepted": false, "reason": "origin not allowed" })),
        );
    }
    if let Some(app) = UPDATE_APP_HANDLE.get() {
        if let Err(error) = engine.persist_downloads() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "accepted": false, "reason": error })),
            );
        }
        let app = app.clone();
        tokio::spawn(async move {
            // Give the installer request time to receive its response before quitting.
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            app.exit(0);
        });
        (
            StatusCode::OK,
            Json(serde_json::json!({ "accepted": true })),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "accepted": false, "reason": "app is shutting down" })),
        )
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
    let browser_name = params
        .get("browser")
        .map(|hint| resolve_browser_name(hint, &st));
    Json(IpcStatusResponse {
        app: "ByteX Download Manager".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        intercept_enabled: st.browser.intercept_all_downloads,
        min_file_size_kb: st.browser.min_file_size_kb,
        intercepted_extensions: st.browser.intercepted_extensions.clone(),
        ignored_domains: st.browser.ignored_domains.clone(),
        bypass_key: st.browser.bypass_key.clone(),
        browser_name,
    })
}

async fn handle_intercept(
    State(engine): State<Arc<DownloadEngine>>,
    Json(payload): Json<BrowserInterceptPayload>,
) -> Json<serde_json::Value> {
    if !engine.settings.read().browser.intercept_all_downloads {
        return Json(
            serde_json::json!({ "accepted": false, "reason": "Download interception is disabled" }),
        );
    }
    let browser_name = resolve_browser_name(&payload.browser, &engine.settings.read());
    record_browser_heartbeat(&browser_name);
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
        filename: payload.filename.map(|name| {
            name.replace('\\', "/")
                .rsplit('/')
                .next()
                .unwrap_or("downloaded_file.bin")
                .to_string()
        }),
        category,
        save_path: None,
        threads_count: None,
        queue_id: Some("main-queue".to_string()),
        start_immediately: true,
        source_browser: Some(browser_name),
        referer: payload.referer,
        cookies: payload.cookies,
        user_agent: payload.user_agent,
        custom_headers: payload.headers,
        auth_username: payload.auth_username,
        auth_password: payload.auth_password,
        sequential_torrent: if is_torrent { Some(true) } else { None },
        torrent_file_data: None,
        torrent_selected_files: None,
    };

    if let Some(existing) = find_duplicate_download(&engine, &req.url) {
        emit_duplicate_notice(DuplicateDownloadNotice {
            kind: "existing_download".to_string(),
            existing_download_id: Some(existing.id.clone()),
            existing_filename: existing.filename.clone(),
            existing_status: Some(existing.status.clone()),
            existing_path: existing.save_path.clone(),
            request: req,
        });
        focus_main_window();
        return Json(serde_json::json!({
            "accepted": true,
            "duplicate": true,
            "download_id": existing.id,
            "filename": existing.filename
        }));
    }

    let destination = engine.destination_path(&req);
    if destination.exists() {
        let existing = engine
            .downloads
            .read()
            .iter()
            .find(|item| crate::config::resolve_path(&item.save_path) == destination)
            .cloned();
        emit_duplicate_notice(DuplicateDownloadNotice {
            kind: if existing.is_some() {
                "existing_download"
            } else {
                "existing_file"
            }
            .to_string(),
            existing_download_id: existing.as_ref().map(|item| item.id.clone()),
            existing_filename: existing
                .as_ref()
                .map(|item| item.filename.clone())
                .or_else(|| {
                    destination
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "Existing file".to_string()),
            existing_status: existing.as_ref().map(|item| item.status.clone()),
            existing_path: destination.to_string_lossy().to_string(),
            request: req,
        });
        focus_main_window();
        return Json(serde_json::json!({
            "accepted": false,
            "duplicate": true,
            "reason": "A file with that name already exists"
        }));
    }

    let created = engine.add_download(req.clone());
    focus_main_window();
    let started = engine.start_download_execution(created, &req).await;
    Json(serde_json::json!({
        "accepted": true,
        "download_id": started.id,
        "filename": started.filename
    }))
}

fn emit_duplicate_notice(notice: DuplicateDownloadNotice) {
    if let Some(app) = UPDATE_APP_HANDLE.get() {
        if let Err(error) = app.emit("duplicate-download-detected", notice) {
            tracing::warn!(%error, "Could not show duplicate download dialog");
        }
    }
}

fn focus_main_window() {
    if let Some(app) = UPDATE_APP_HANDLE.get() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

async fn handle_list_downloads(
    State(engine): State<Arc<DownloadEngine>>,
) -> Json<serde_json::Value> {
    let list = engine.downloads.read().clone();
    Json(serde_json::json!({ "downloads": list }))
}

#[cfg(test)]
mod tests {
    use super::{normalized_download_url, same_download_url, unique_installed_browser_name};

    #[test]
    fn normalizes_equivalent_download_urls() {
        assert_eq!(
            normalized_download_url("HTTPS://Example.com:443/file.zip#download"),
            normalized_download_url("https://example.com/file.zip")
        );
    }

    #[test]
    fn preserves_distinct_download_queries() {
        assert_ne!(
            normalized_download_url("https://example.com/file.zip?token=one"),
            normalized_download_url("https://example.com/file.zip?token=two")
        );
    }

    #[test]
    fn duplicate_capture_matches_normalized_urls() {
        let candidate = normalized_download_url("https://Example.com/file.zip#download");
        assert!(same_download_url(
            &candidate,
            "https://example.com:443/file.zip"
        ));
    }

    #[test]
    fn generic_engine_names_resolve_to_a_unique_installed_browser_in_each_family() {
        for (family, browser_name) in [
            ("chromium", "Dia Browser"),
            ("firefox", "Zen Browser"),
            ("safari", "Orion Browser"),
        ] {
            let installed = [super::BrowserStatus {
                id: "detected-browser".into(),
                display_name: browser_name.into(),
                family: family.into(),
                detected_installed: true,
                executable_path: None,
                extension_enabled: true,
                native_host_registered: true,
                is_connected: false,
                manifest_path: String::new(),
                extension_bundle_path: String::new(),
                status_message: String::new(),
            }];
            assert_eq!(
                unique_installed_browser_name(true, &installed).as_deref(),
                Some(browser_name)
            );
            assert_eq!(unique_installed_browser_name(false, &installed), None);
        }
    }
}
