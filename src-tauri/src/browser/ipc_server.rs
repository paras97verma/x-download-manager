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
use crate::engine::{
    DownloadEngine, DownloadItem, DownloadRedirect, DuplicateDownloadNotice, NewDownloadRequest,
};

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
    pub original_url: Option<String>,
    pub final_url: Option<String>,
    pub redirects: Option<Vec<DownloadRedirect>>,
    pub filename: Option<String>,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub method: Option<String>,
    pub body_base64: Option<String>,
    pub request_replayable: Option<bool>,
    pub request_unavailable_reason: Option<String>,
    pub response_headers: Option<HashMap<String, String>>,
    pub response_status: Option<u16>,
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
        if download.status == crate::engine::DownloadStatus::Failed {
            return None;
        }
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

fn redacted_duplicate_request(mut request: NewDownloadRequest) -> NewDownloadRequest {
    if request.source_browser.is_none() {
        return request;
    }
    request.cookies = None;
    request.referer = None;
    request.auth_username = None;
    request.auth_password = None;
    request.request_body = None;
    if let Some(headers) = request.custom_headers.as_mut() {
        headers.retain(|name, _| {
            let lower = name.to_ascii_lowercase();
            !(lower == "cookie"
                || lower == "authorization"
                || lower == "proxy-authorization"
                || lower.starts_with("x-auth")
                || lower.starts_with("x-api-")
                || lower.contains("token")
                || lower.contains("secret")
                || lower.contains("key")
                || lower.contains("session")
                || lower.contains("csrf")
                || lower.contains("signature")
                || lower.contains("credential")
                || lower.contains("password")
                || lower.contains("ticket")
                || lower.starts_with("x-xdm-ftp-"))
        });
    }
    redact_url_for_notice(&mut request.url);
    if let Some(url) = request.final_url.as_mut() {
        redact_url_for_notice(url);
    }
    for redirect in &mut request.redirect_chain {
        redact_url_for_notice(&mut redirect.from_url);
        redact_url_for_notice(&mut redirect.to_url);
    }
    request
}

fn redact_url_for_notice(value: &mut String) {
    if let Ok(mut parsed) = url::Url::parse(value) {
        if !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some()
        {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            *value = parsed.to_string();
        }
    }
}

pub async fn start_browser_ipc_server(
    engine: Arc<DownloadEngine>,
    port: u16,
    app_handle: tauri::AppHandle,
) {
    let _ = UPDATE_APP_HANDLE.set(app_handle);
    let app = Router::new()
        .route(
            "/api/v1/status",
            get(handle_status).layer(CorsLayer::permissive()),
        )
        .route("/api/v1/intercept", post(handle_intercept))
        .route("/api/v1/prepare-update", post(handle_prepare_update))
        .route(
            "/api/v1/update-status",
            get(handle_update_status).layer(CorsLayer::permissive()),
        )
        .route("/api/v1/downloads", get(handle_list_downloads))
        .route(
            "/api/v1/stream/:id",
            get(crate::streaming::stream_media_handler).layer(CorsLayer::permissive()),
        )
        .route(
            "/stream/:id",
            get(crate::streaming::stream_media_handler).layer(CorsLayer::permissive()),
        )
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
    match crate::engine::update_lifecycle::prepare_for_update(&engine, None).await {
        Ok(summary) => {
            if let Some(app) = UPDATE_APP_HANDLE.get() {
                let app = app.clone();
                tokio::spawn(async move {
                    // Give the installer request time to receive its response before quitting.
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    app.exit(0);
                });
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "accepted": true,
                    "summary": summary
                })),
            )
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "accepted": false, "reason": error })),
        ),
    }
}

async fn handle_update_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "is_preparing_update": crate::engine::update_lifecycle::is_preparing_update()
    }))
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
    headers: HeaderMap,
    Json(payload): Json<BrowserInterceptPayload>,
) -> Json<serde_json::Value> {
    // Browser extensions use the Native Messaging host, which makes a direct
    // web page unable to submit credentials to this loopback endpoint.
    if headers.contains_key(axum::http::header::ORIGIN) {
        return Json(serde_json::json!({
            "accepted": false,
            "reason": "Use the ByteX browser extension Native Messaging channel"
        }));
    }
    if crate::engine::update_lifecycle::is_preparing_update() {
        return Json(serde_json::json!({
            "accepted": false,
            "reason": "app_preparing_update",
            "message": "ByteX is preparing for an update. Downloads are temporarily blocked to preserve data."
        }));
    }
    if !engine.settings.read().browser.intercept_all_downloads {
        return Json(
            serde_json::json!({ "accepted": false, "reason": "Download interception is disabled" }),
        );
    }
    if payload.request_replayable == Some(false) {
        return Json(serde_json::json!({
            "accepted": false,
            "reason": payload.request_unavailable_reason.unwrap_or_else(|| "The browser did not expose the original request body".to_string())
        }));
    }
    let method = payload.method.unwrap_or_else(|| "GET".to_string());
    if reqwest::Method::from_bytes(method.as_bytes()).is_err() {
        return Json(serde_json::json!({ "accepted": false, "reason": "Unsupported HTTP method" }));
    }
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && payload.body_base64.is_none() {
        return Json(serde_json::json!({
            "accepted": false,
            "reason": "The browser did not expose the complete request body, so ByteX left the browser download in control"
        }));
    }
    if let Some(encoded) = payload.body_base64.as_deref() {
        use base64::Engine as _;
        if base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map(|body| body.len() > 1024 * 1024)
            .unwrap_or(true)
        {
            return Json(serde_json::json!({
                "accepted": false,
                "reason": "The captured request body is invalid or exceeds the 1 MiB replay limit"
            }));
        }
    }
    let final_url = payload
        .final_url
        .clone()
        .unwrap_or_else(|| payload.url.clone());
    let Ok(parsed_final_url) = url::Url::parse(&final_url) else {
        return Json(serde_json::json!({ "accepted": false, "reason": "Invalid download URL" }));
    };
    if !matches!(parsed_final_url.scheme(), "http" | "https" | "ftp") {
        return Json(
            serde_json::json!({ "accepted": false, "reason": "ByteX can safely hand off HTTP, HTTPS, and FTP downloads; this protocol remains in the browser" }),
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
        url: payload.original_url.unwrap_or_else(|| payload.url.clone()),
        final_url: payload.final_url.or(Some(final_url)),
        redirect_chain: payload.redirects.unwrap_or_default(),
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
        request_method: method,
        request_body: payload.body_base64,
        browser_intercepted: true,
        auth_username: payload.auth_username,
        auth_password: payload.auth_password,
        sequential_torrent: if is_torrent { Some(true) } else { None },
        torrent_file_data: None,
        torrent_selected_files: None,
        scheduled_start: None,
        scheduled_stop: None,
    };

    if let Some(existing) = find_duplicate_download(&engine, &req.url) {
        emit_duplicate_notice(DuplicateDownloadNotice {
            kind: "existing_download".to_string(),
            existing_download_id: Some(existing.id.clone()),
            existing_filename: existing.filename.clone(),
            existing_status: Some(existing.status.clone()),
            existing_path: existing.save_path.clone(),
            request: redacted_duplicate_request(req.clone()),
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
            request: redacted_duplicate_request(req.clone()),
        });
        focus_main_window();
        return Json(serde_json::json!({
            "accepted": false,
            "duplicate": true,
            "reason": "A file with that name already exists"
        }));
    }

    let created = engine.add_download(req.clone());
    let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
    let started = engine
        .start_download_execution_with_ack(created, &req, ack_tx)
        .await;
    let handoff = tokio::time::timeout(std::time::Duration::from_secs(20), ack_rx).await;
    match handoff {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(reason))) => {
            discard_unaccepted_download(&engine, &started.id).await;
            return Json(serde_json::json!({ "accepted": false, "reason": reason }));
        }
        Ok(Err(_)) => {
            discard_unaccepted_download(&engine, &started.id).await;
            return Json(
                serde_json::json!({ "accepted": false, "reason": "ByteX could not confirm the transfer" }),
            );
        }
        Err(_) => {
            discard_unaccepted_download(&engine, &started.id).await;
            return Json(
                serde_json::json!({ "accepted": false, "reason": "ByteX did not receive a valid response in time" }),
            );
        }
    }
    focus_main_window();
    Json(serde_json::json!({
        "accepted": true,
        "download_id": started.id,
        "filename": started.filename
    }))
}

async fn discard_unaccepted_download(engine: &DownloadEngine, id: &str) {
    if let Some(cancel) = engine.active_cancellations.write().remove(id) {
        let _ = cancel.send(true);
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let path = engine
        .downloads
        .read()
        .iter()
        .find(|item| item.id == id)
        .map(|item| crate::config::resolve_path(&item.save_path));
    if let Some(path) = path {
        let _ = std::fs::remove_file(path);
    }
    engine.downloads.write().retain(|item| item.id != id);
    let _ = engine.persist_downloads();
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
