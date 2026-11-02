pub mod browser;
pub mod config;
pub mod engine;
pub mod menu;
pub mod scheduler;

use std::sync::Arc;
use tauri::{Emitter, Manager, State};

use crate::browser::{
    auto_register_all_detected_browsers, configure_browser_integration, detect_browsers,
    BrowserStatus,
};
use crate::config::AppSettings;
use crate::engine::{
    ftp_auth::{resolve_usersdrive_or_filehost, ResolvedAuthDownload},
    DownloadEngine, DownloadItem, DownloadStatus, DuplicateDownloadNotice, NewDownloadRequest,
};

#[tauri::command]
fn get_downloads(engine: State<'_, Arc<DownloadEngine>>) -> Vec<DownloadItem> {
    engine.downloads.read().clone()
}

#[tauri::command]
async fn add_download_task(
    mut req: NewDownloadRequest,
    keep_both: Option<bool>,
    engine: State<'_, Arc<DownloadEngine>>,
    app: tauri::AppHandle,
) -> Result<DownloadItem, String> {
    if keep_both.unwrap_or(false) {
        req = unique_copy_request(engine.inner(), req);
    } else {
        if let Some(existing) = find_download_by_url(engine.inner(), &req.url) {
            let notice = DuplicateDownloadNotice {
                kind: "existing_download".to_string(),
                existing_download_id: Some(existing.id.clone()),
                existing_filename: existing.filename.clone(),
                existing_status: Some(existing.status.clone()),
                existing_path: existing.save_path.clone(),
                request: req,
            };
            let _ = app.emit("duplicate-download-detected", notice);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            return Err("Duplicate download detected. Choose an action in ByteX.".to_string());
        }
        let destination = engine.destination_path(&req);
        let existing = find_download_at_path(engine.inner(), &destination);
        if destination.exists() || existing.is_some() {
            let notice = DuplicateDownloadNotice {
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
            };
            let _ = app.emit("duplicate-download-detected", notice);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            return Err("Duplicate file detected. Choose an action in ByteX.".to_string());
        }
    }
    let item = engine.add_download(req.clone());
    let started = engine.inner().start_download_execution(item, &req).await;
    Ok(started)
}

fn find_download_at_path(engine: &DownloadEngine, path: &std::path::Path) -> Option<DownloadItem> {
    engine
        .downloads
        .read()
        .iter()
        .find(|item| crate::config::resolve_path(&item.save_path) == path && path.exists())
        .cloned()
}

fn normalize_download_url(value: &str) -> String {
    match url::Url::parse(value.trim()) {
        Ok(mut parsed) => {
            parsed.set_fragment(None);
            parsed.to_string()
        }
        Err(_) => value.trim().to_string(),
    }
}

fn find_download_by_url(engine: &DownloadEngine, url: &str) -> Option<DownloadItem> {
    let candidate = normalize_download_url(url);
    engine.downloads.read().iter().find_map(|item| {
        let actively_managed = matches!(
            item.status,
            DownloadStatus::Queued
                | DownloadStatus::Connecting
                | DownloadStatus::Authenticating
                | DownloadStatus::Downloading
                | DownloadStatus::Merging
                | DownloadStatus::Seeding
        );
        let output_still_exists = crate::config::resolve_path(&item.save_path).exists();
        // A stale active record must not block a fresh download after the user
        // deleted its partial output. Keep protecting zero-byte queued/starting
        // requests, which may not have created their destination yet.
        let active_without_output = actively_managed && item.downloaded_bytes == 0;
        if !output_still_exists && !active_without_output {
            return None;
        }
        let same_url = std::iter::once(item.url.as_str())
            .chain(item.resolved_url.as_deref())
            .any(|existing| normalize_download_url(existing) == candidate);
        same_url.then(|| item.clone())
    })
}

fn unique_copy_request(engine: &DownloadEngine, mut req: NewDownloadRequest) -> NewDownloadRequest {
    let original = engine.destination_path(&req);
    let parent = original
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let stem = original
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let extension = original
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 2u32.. {
        let filename = match &extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(&filename);
        if !candidate.exists() && find_download_at_path(engine, &candidate).is_none() {
            req.filename = Some(filename);
            req.save_path = Some(parent.to_string_lossy().to_string());
            return req;
        }
    }
    req
}

#[tauri::command]
async fn update_download_url(
    id: String,
    url: String,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<DownloadItem, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Download URL cannot be empty".to_string());
    }
    let protocol = DownloadEngine::detect_protocol(&url);
    let supported_url = if protocol == crate::engine::DownloadProtocol::Magnet {
        url.to_lowercase().starts_with("magnet:?")
    } else {
        url::Url::parse(&url)
            .map(|parsed| matches!(parsed.scheme(), "http" | "https" | "ftp" | "ftps" | "sftp"))
            .unwrap_or(false)
    };
    if !supported_url {
        return Err("Unsupported download URL".to_string());
    }

    let (save_path, old_torrent_path, current_status, downloaded_bytes) = engine
        .downloads
        .read()
        .iter()
        .find(|download| download.id == id)
        .map(|download| {
            (
                download.save_path.clone(),
                download.torrent_file_path.clone(),
                download.status.clone(),
                download.downloaded_bytes,
            )
        })
        .ok_or_else(|| "Download not found".to_string())?;
    if current_status == DownloadStatus::Completed {
        return Err("A completed download cannot have its source URL changed".to_string());
    }

    let cancel = { engine.active_cancellations.write().remove(&id) };
    if let Some(cancel) = cancel {
        let _ = cancel.send(true);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    if downloaded_bytes > 0 {
        let resolved_path = crate::config::resolve_path(&save_path);
        match std::fs::symlink_metadata(&resolved_path) {
            Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&resolved_path)
                .map_err(|e| format!("Could not clear partial download: {e}"))?,
            Ok(_) => std::fs::remove_file(&resolved_path)
                .map_err(|e| format!("Could not clear partial download: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not access partial download: {e}")),
        }
    }
    if let Some(path) = old_torrent_path {
        let _ = std::fs::remove_file(crate::config::resolve_path(&path));
    }

    let updated = {
        let mut downloads = engine.downloads.write();
        let download = downloads
            .iter_mut()
            .find(|download| download.id == id)
            .ok_or_else(|| "Download not found".to_string())?;
        download.url = url;
        download.resolved_url = None;
        download.protocol = protocol;
        download.total_bytes = 0;
        download.downloaded_bytes = 0;
        download.speed_bps = 0;
        download.upload_speed_bps = 0;
        download.eta_seconds = None;
        download.status = DownloadStatus::Paused;
        download.segments.clear();
        download.torrent_meta = None;
        download.torrent_file_path = None;
        download.torrent_selected_files = None;
        download.completed_at = None;
        download.error_message = None;
        download
            .transfer_log
            .push("Source URL changed; restarting from the new source.".to_string());
        download.clone()
    };
    let req = NewDownloadRequest {
        url: updated.url.clone(),
        filename: Some(updated.filename.clone()),
        category: Some(updated.category.clone()),
        save_path: Some(updated.save_path.clone()),
        threads_count: Some(updated.threads_count),
        queue_id: Some(updated.queue_id.clone()),
        start_immediately: true,
        source_browser: updated.source_browser.clone(),
        referer: updated.referer.clone(),
        cookies: updated.cookies.clone(),
        user_agent: updated.custom_headers.get("User-Agent").cloned(),
        custom_headers: Some(updated.custom_headers.clone()),
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
    };
    Ok(engine.inner().start_download_execution(updated, &req).await)
}

#[tauri::command]
fn pause_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
        let _ = tx.send(true);
    }
    let mut dls = engine.downloads.write();
    if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
        d.status = DownloadStatus::Paused;
        d.speed_bps = 0;
        for seg in &mut d.segments {
            seg.speed_bps = 0;
            if seg.status == "receiving" {
                seg.status = "paused".to_string();
            }
        }
        d.transfer_log.push("Download paused by user.".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn resume_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
    engine.inner().start_download_by_id(&id).await
}

#[tauri::command]
async fn delete_download(
    id: String,
    delete_file: bool,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<(), String> {
    let cancel_tx = { engine.active_cancellations.write().remove(&id) };
    if let Some(tx) = cancel_tx {
        let _ = tx.send(true);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    let (save_path, torrent_file_path) = engine
        .downloads
        .read()
        .iter()
        .find(|d| d.id == id)
        .map(|d| (Some(d.save_path.clone()), d.torrent_file_path.clone()))
        .unwrap_or((None, None));
    if delete_file {
        if let Some(path) = save_path {
            let resolved = crate::config::resolve_path(&path);
            match std::fs::symlink_metadata(&resolved) {
                Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&resolved)
                    .map_err(|e| format!("Could not remove {}: {}", resolved.display(), e))?,
                Ok(_) => std::fs::remove_file(&resolved)
                    .map_err(|e| format!("Could not remove {}: {}", resolved.display(), e))?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Could not access {}: {}", resolved.display(), e)),
            }
        }
    }
    if let Some(path) = torrent_file_path {
        let _ = std::fs::remove_file(crate::config::resolve_path(&path));
    }
    engine.downloads.write().retain(|d| d.id != id);
    Ok(())
}

#[tauri::command]
fn get_settings(engine: State<'_, Arc<DownloadEngine>>) -> AppSettings {
    engine.settings.read().clone()
}

#[tauri::command]
fn update_settings(
    new_settings: AppSettings,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<AppSettings, String> {
    crate::config::ensure_directories_exist(&new_settings);
    engine.config_manager.save(&new_settings)?;
    *engine.settings.write() = new_settings.clone();
    Ok(new_settings)
}

#[tauri::command]
fn get_browser_statuses(engine: State<'_, Arc<DownloadEngine>>) -> Vec<BrowserStatus> {
    let st = engine.settings.read();
    detect_browsers(&st)
}

#[tauri::command]
fn toggle_browser_extension(
    browser_id: String,
    enable: bool,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<BrowserStatus, String> {
    let mut st = engine.settings.write();
    let status = configure_browser_integration(&browser_id, enable, &mut st)?;
    let _ = engine.config_manager.save(&st);
    Ok(status)
}

#[tauri::command]
async fn resolve_authenticated_link(
    url: String,
    cookies: Option<String>,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<ResolvedAuthDownload, String> {
    let st = engine.settings.read().clone();
    resolve_usersdrive_or_filehost(&url, &st, cookies).await
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    let resolved = crate::config::resolve_path(&path);
    if !resolved.exists() {
        return Err(format!("File does not exist: {}", resolved.display()));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &resolved.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    let resolved = crate::config::resolve_path(&path);
    #[cfg(target_os = "macos")]
    {
        if resolved.exists() {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&resolved)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else if let Some(parent) = resolved.parent() {
            std::process::Command::new("open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if resolved.exists() {
            std::process::Command::new("explorer")
                .arg(format!("/select,\"{}\"", resolved.display()))
                .spawn()
                .map_err(|e| e.to_string())?;
        } else if let Some(parent) = resolved.parent() {
            std::process::Command::new("explorer")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = resolved.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_browser_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    let ver = app.package_info().version.to_string();
    if !ver.is_empty() {
        ver
    } else {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[tauri::command]
fn open_extension_folder(family: String) -> Result<String, String> {
    let dir = crate::browser::get_or_create_extension_dir(&family)?;
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dir).spawn();
        if family.eq_ignore_ascii_case("safari") {
            let _ = std::process::Command::new("open")
                .arg("-a")
                .arg("Safari")
                .spawn();
        }
        // Copy directory path to macOS pasteboard so user can easily paste into Safari "Add Temporary Extension..." dialog (⌘⇧G)
        if let Ok(mut child) = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            use std::io::Write;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(dir.to_string_lossy().as_bytes());
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn restart_download(
    id: String,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<(), String> {
    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
        let _ = tx.send(true);
    }
    let save_path = {
        let mut dls = engine.downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
            d.downloaded_bytes = 0;
            d.speed_bps = 0;
            d.eta_seconds = None;
            d.status = DownloadStatus::Downloading;
            for seg in &mut d.segments {
                seg.downloaded_bytes = 0;
                seg.speed_bps = 0;
                seg.status = "waiting".to_string();
            }
            d.transfer_log
                .push("Restarting download from 0 bytes...".to_string());
            Some(d.save_path.clone())
        } else {
            None
        }
    };

    if let Some(path) = save_path {
        let resolved = crate::config::resolve_path(&path);
        let _ = std::fs::remove_file(&resolved);
        let part_file = resolved.with_extension(format!(
            "{}.part",
            resolved.extension().and_then(|s| s.to_str()).unwrap_or("")
        ));
        let _ = std::fs::remove_file(&part_file);
    }

    engine.inner().start_download_by_id(&id).await
}

#[tauri::command]
async fn verify_file_checksum(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let resolved = crate::config::resolve_path(&path);
    if !resolved.exists() {
        return Err(format!("File does not exist: {}", resolved.display()));
    }

    let mut file = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = format!("{:x}", hasher.finalize());
    Ok(hash)
}

#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(enable: bool, app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    if enable {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;
    let perm = app
        .notification()
        .request_permission()
        .map_err(|e| e.to_string())?;
    Ok(perm == tauri_plugin_notification::PermissionState::Granted)
}

#[tauri::command]
fn show_notification(title: String, body: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn parse_torrent_file(
    file_path: Option<String>,
    base64_data: Option<String>,
) -> Result<crate::engine::TorrentMetadata, String> {
    use base64::Engine;
    let bytes = if let Some(path) = file_path {
        let resolved = crate::config::resolve_path(&path);
        std::fs::read(&resolved).map_err(|e| format!("Failed to read torrent file: {}", e))?
    } else if let Some(b64) = base64_data {
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Invalid base64 payload: {}", e))?
    } else {
        return Err("No torrent path or data provided".into());
    };

    crate::engine::torrent::parse_torrent_bytes(&bytes, true)
}

#[tauri::command]
async fn move_to_queue(
    id: String,
    queue_id: String,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<(), String> {
    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
        let _ = tx.send(true);
    }
    {
        let mut dls = engine.downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
            if matches!(
                d.status,
                DownloadStatus::Connecting
                    | DownloadStatus::Downloading
                    | DownloadStatus::Authenticating
                    | DownloadStatus::Merging
                    | DownloadStatus::Seeding
            ) {
                d.status = DownloadStatus::Queued;
                d.speed_bps = 0;
            }
            d.queue_id = queue_id.clone();
            d.transfer_log.push(format!("Moved to queue: {}", queue_id));
        }
    }
    engine
        .inner()
        .start_queued_downloads(Some(queue_id))
        .await?;
    Ok(())
}

#[tauri::command]
async fn start_queue_now(
    queue_id: String,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<usize, String> {
    engine.inner().start_queued_downloads(Some(queue_id)).await
}

/// Format bytes-per-second into a human-readable speed string shown in the tray.
fn format_speed_bps(bps: u64) -> String {
    if bps >= 1_000_000 {
        format!("{:.1} MB/s", bps as f64 / 1_000_000.0)
    } else if bps >= 1_000 {
        format!("{:.0} KB/s", bps as f64 / 1_000.0)
    } else {
        format!("{} B/s", bps)
    }
}

fn compact_speed_bps(bps: u64) -> String {
    if bps >= 10_000_000_000 {
        format!("{:.0}G", bps as f64 / 1_000_000_000.0)
    } else if bps >= 1_000_000_000 {
        format!("{:.1}G", bps as f64 / 1_000_000_000.0)
    } else if bps >= 10_000_000 {
        format!("{:.0}M", bps as f64 / 1_000_000.0)
    } else if bps >= 1_000_000 {
        format!("{:.1}M", bps as f64 / 1_000_000.0)
    } else if bps >= 1_000 {
        format!("{:.0}K", bps as f64 / 1_000.0)
    } else {
        bps.to_string()
    }
}

fn build_speed_tray_icon(download_bps: u64, upload_bps: u64) -> tauri::image::Image<'static> {
    const SIZE: usize = 32;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.copy_from_slice(&[0, 0, 0, 0]);
    }

    fn paint(rgba: &mut [u8], x: usize, y: usize, color: [u8; 4]) {
        if x < 32 && y < 32 {
            let offset = (y * 32 + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&color);
        }
    }

    fn draw_text(rgba: &mut [u8], text: &str, y: usize, color: [u8; 4]) {
        let characters: Vec<char> = text.chars().take(5).collect();
        let left = (32usize.saturating_sub(characters.len() * 4)) / 2;
        for (index, character) in characters.into_iter().enumerate() {
            let rows: [u8; 5] = match character {
                '0' => [7, 5, 5, 5, 7],
                '1' => [2, 6, 2, 2, 7],
                '2' => [7, 1, 7, 4, 7],
                '3' => [7, 1, 7, 1, 7],
                '4' => [5, 5, 7, 1, 1],
                '5' => [7, 4, 7, 1, 7],
                '6' => [7, 4, 7, 5, 7],
                '7' => [7, 1, 2, 2, 2],
                '8' => [7, 5, 7, 5, 7],
                '9' => [7, 5, 7, 1, 7],
                'D' => [6, 5, 5, 5, 6],
                'U' => [5, 5, 5, 5, 7],
                'K' => [5, 5, 6, 5, 5],
                'M' => [5, 7, 7, 5, 5],
                'G' => [7, 4, 5, 5, 7],
                '.' => [0, 0, 0, 0, 2],
                _ => [0; 5],
            };
            for (row, bits) in rows.iter().enumerate() {
                for col in 0..3 {
                    if bits & (1 << (2 - col)) != 0 {
                        paint(rgba, left + index * 4 + col, y + row, color);
                    }
                }
            }
        }
    }

    for x in 9..23 {
        paint(&mut rgba, x, 15, [90, 107, 127, 255]);
    }
    draw_text(
        &mut rgba,
        &format!("D{}", compact_speed_bps(download_bps)),
        4,
        [75, 224, 216, 255],
    );
    draw_text(
        &mut rgba,
        &format!("U{}", compact_speed_bps(upload_bps)),
        22,
        [102, 231, 166, 255],
    );
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

pub fn run_app() {
    let engine = Arc::new(DownloadEngine::new());

    // Refresh the user-facing extension folders on every app start so manual
    // installs receive the current scripts, manifests, icons, and Safari wrapper.
    for family in ["chromium", "firefox", "safari"] {
        if let Err(error) = browser::get_or_create_extension_dir(family) {
            tracing::warn!(%family, %error, "Could not refresh browser extension files");
        }
    }

    {
        let mut st = engine.settings.write();
        if st.browser.auto_install_extensions_on_startup {
            let _ = auto_register_all_detected_browsers(&mut st);
        }
    }

    let ipc_engine = Arc::clone(&engine);
    let ipc_port = engine.settings.read().browser.ipc_port;

    let sched_engine = Arc::clone(&engine);
    let shutdown_engine = Arc::clone(&engine);
    let completion_engine = Arc::clone(&engine);
    let start_on_boot_setting = engine.settings.read().start_on_boot;

    let app_result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(engine)
        .setup(move |app| {
            use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
            let autolaunch = app.autolaunch();
            let autostart_result = if start_on_boot_setting {
                autolaunch.enable()
            } else {
                autolaunch.disable()
            };
            if let Err(error) = autostart_result {
                tracing::warn!(%error, "Could not synchronize OS startup registration with settings");
            }

            // Setup Native System Application Menu (macOS system menu bar / Windows & Linux native menu)
            if let Ok(native_menu) = menu::create_native_app_menu(app.handle()) {
                if let Err(error) = app.set_menu(native_menu) {
                    tracing::warn!(%error, "Could not install the native application menu");
                }
            }

            // Create a status item on macOS and a system tray icon on Windows/Linux.
            {
                // Setup Tray Icon & Context Menu
                if let Ok(show_i) = tauri::menu::MenuItem::with_id(
                    app,
                    "show",
                    "Show ByteX Download Manager",
                    true,
                    None::<&str>,
                ) {
                    if let Ok(quit_i) = tauri::menu::MenuItem::with_id(
                        app,
                        "quit",
                        "Quit ByteX",
                        true,
                        None::<&str>,
                    ) {
                        if let Ok(menu) = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i]) {
                            let mut builder = tauri::tray::TrayIconBuilder::with_id("speed-indicator")
                                .menu(&menu)
                                .title("")
                                .show_menu_on_left_click(false)
                                .on_menu_event(|app, event| match event.id.as_ref() {
                                    "quit" => {
                                        app.exit(0);
                                    }
                                    "show" => {
                                        use tauri::Manager;
                                        if let Some(window) = app.get_webview_window("main") {
                                            let _ = window.show();
                                            let _ = window.unminimize();
                                            let _ = window.set_focus();
                                        }
                                    }
                                    _ => {}
                                })
                                .on_tray_icon_event(|tray, event| {
                                    if let tauri::tray::TrayIconEvent::Click {
                                        button: tauri::tray::MouseButton::Left,
                                        button_state: tauri::tray::MouseButtonState::Up,
                                        ..
                                    } = event
                                    {
                                        let app = tray.app_handle();
                                        use tauri::Manager;
                                        if let Some(window) = app.get_webview_window("main") {
                                            let _ = window.show();
                                            let _ = window.unminimize();
                                            let _ = window.set_focus();
                                        }
                                    }
                                });

                            if let Some(icon) = app.default_window_icon() {
                                builder = builder.icon(icon.clone());
                            }

                            if let Err(error) = builder.build(app) {
                                tracing::warn!(%error, "Could not create the system tray icon");
                            }
                        }
                    }
                }
            }

            // Observe completions in the native process so notifications still work while
            // the window is hidden or the webview is background-throttled.
            {
                use tauri_plugin_notification::NotificationExt;
                let app_handle = app.handle().clone();
                let completion_ids = completion_engine
                    .downloads
                    .read()
                    .iter()
                    .filter(|download| download.status == crate::engine::DownloadStatus::Completed)
                    .map(|download| download.id.clone())
                    .collect::<std::collections::HashSet<_>>();
                tauri::async_runtime::spawn(async move {
                    let mut already_notified = completion_ids;
                    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(500));
                    loop {
                        ticker.tick().await;
                        let completed = completion_engine
                            .downloads
                            .read()
                            .iter()
                            .filter(|download| download.status == crate::engine::DownloadStatus::Completed)
                            .map(|download| (download.id.clone(), download.filename.clone()))
                            .collect::<Vec<_>>();
                        if !completion_engine.settings.read().show_completion_dialog {
                            already_notified.extend(completed.into_iter().map(|(id, _)| id));
                            continue;
                        }
                        for (id, filename) in completed {
                            if !already_notified.insert(id) {
                                continue;
                            }
                            if let Err(error) = app_handle
                                .notification()
                                .builder()
                                .title("Download Complete")
                                .body(format!("{filename} has finished downloading successfully."))
                                .show()
                            {
                                tracing::warn!(%error, "Could not show download completion notification");
                            }
                        }
                    }
                });
            }

            // ---------------------------------------------------------------
            // Tray speed updater: every second, compute total download speed
            // across all active downloads and update the tray tooltip/title.
            // ---------------------------------------------------------------
            {
                use tauri::Manager;
                let tray_engine = app
                    .try_state::<Arc<DownloadEngine>>()
                    .map(|s| Arc::clone(&s))
                    .expect("DownloadEngine state not found");
                let app_handle = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
                    loop {
                        ticker.tick().await;

                        let (active_count, total_down_bps, total_torrent_up_bps): (
                            usize,
                            u64,
                            u64,
                        ) = {
                            let dls = tray_engine.downloads.read();
                            let active: Vec<_> = dls
                                .iter()
                                .filter(|d| {
                                    matches!(
                                        d.status,
                                        crate::engine::DownloadStatus::Connecting
                                            | crate::engine::DownloadStatus::Authenticating
                                            | crate::engine::DownloadStatus::Downloading
                                            | crate::engine::DownloadStatus::Merging
                                            | crate::engine::DownloadStatus::Seeding
                                    )
                                })
                                .collect();
                            let down = active
                                .iter()
                                .filter(|d| d.status != crate::engine::DownloadStatus::Seeding)
                                .map(|d| d.speed_bps)
                                .sum();
                            let up = active
                                .iter()
                                .filter(|d| {
                                    matches!(
                                        d.protocol,
                                        crate::engine::DownloadProtocol::BitTorrent
                                            | crate::engine::DownloadProtocol::Magnet
                                    )
                                })
                                .map(|d| d.upload_speed_bps)
                                .sum();
                            (active.len(), down, up)
                        };

                        let tooltip = if active_count > 0 {
                            format!(
                                "ByteX Download Manager — {} active — ↓ {} — ↑ {} torrent",
                                active_count,
                                format_speed_bps(total_down_bps),
                                format_speed_bps(total_torrent_up_bps)
                            )
                        } else {
                            "ByteX Download Manager — Idle".to_string()
                        };

                        // Update the status item/tray icon and its live rates on every OS.
                        if let Some(tray) = app_handle.tray_by_id("speed-indicator") {
                            let _ = tray.set_tooltip(Some(&tooltip));
                            let _ = tray.set_title(Some(""));
                            let _ = tray.set_icon(Some(build_speed_tray_icon(
                                total_down_bps,
                                total_torrent_up_bps,
                            )));
                        }
                        #[cfg(target_os = "macos")]
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let badge = (active_count > 0).then(|| {
                                format!(
                                    "↓{} ↑{}",
                                    compact_speed_bps(total_down_bps),
                                    compact_speed_bps(total_torrent_up_bps)
                                )
                            });
                            let _ = window.set_badge_label(badge);
                        }
                    }
                });
            }

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                browser::ipc_server::start_browser_ipc_server(ipc_engine, ipc_port, update_handle)
                    .await;
            });
            tauri::async_runtime::spawn(async move {
                scheduler::run_scheduler_loop(sched_engine).await;
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => {
                    app.exit(0);
                }
                "show" => {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                _ => {
                    use tauri::Emitter;
                    let _ = app.emit("menu-action", id);
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                let app = window.app_handle();
                if let Some(engine) = app.try_state::<Arc<crate::engine::DownloadEngine>>() {
                    if engine.settings.read().minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads,
            add_download_task,
            update_download_url,
            pause_download,
            resume_download,
            delete_download,
            get_settings,
            update_settings,
            get_browser_statuses,
            toggle_browser_extension,
            resolve_authenticated_link,
            open_file,
            show_in_folder,
            open_browser_url,
            open_extension_folder,
            restart_download,
            verify_file_checksum,
            move_to_queue,
            start_queue_now,
            pick_directory,
            set_autostart,
            is_autostart_enabled,
            request_notification_permission,
            show_notification,
            parse_torrent_file,
            get_app_version,
        ])
        .build(tauri::generate_context!());
    match app_result {
        Ok(app) => app.run(|_app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                use tauri::Manager;
                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            tauri::RunEvent::Exit => scheduler::update_sleep_prevention(false, false),
            _ => {}
        }),
        Err(error) => tracing::error!(%error, "Could not start ByteX Download Manager"),
    }
    if let Err(error) = shutdown_engine.persist_downloads() {
        tracing::error!(%error, "Could not persist download history during shutdown");
    }
}

#[cfg(test)]
mod tray_speed_tests {
    use super::{build_speed_tray_icon, compact_speed_bps};

    #[test]
    fn formats_rates_for_the_compact_tray_icon() {
        assert_eq!(compact_speed_bps(0), "0");
        assert_eq!(compact_speed_bps(320_000), "320K");
        assert_eq!(compact_speed_bps(1_500_000), "1.5M");
        assert_eq!(compact_speed_bps(2_400_000_000), "2.4G");
        assert_eq!(compact_speed_bps(12_000_000_000), "12G");
    }

    #[test]
    fn tray_speed_indicator_uses_a_compact_icon() {
        let icon = build_speed_tray_icon(320_000, 12_000);
        assert_eq!(icon.width(), 32);
        assert_eq!(icon.height(), 32);
    }
}
