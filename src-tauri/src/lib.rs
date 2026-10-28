pub mod browser;
pub mod config;
pub mod engine;
pub mod scheduler;

use std::sync::Arc;
use tauri::State;

use crate::browser::{
    auto_register_all_detected_browsers, configure_browser_integration, detect_browsers,
    BrowserStatus,
};
use crate::config::AppSettings;
use crate::engine::{
    ftp_auth::{resolve_usersdrive_or_filehost, ResolvedAuthDownload},
    http::execute_segmented_http_download,
    DownloadEngine, DownloadItem, DownloadStatus, NewDownloadRequest,
};

#[tauri::command]
fn get_downloads(engine: State<'_, Arc<DownloadEngine>>) -> Vec<DownloadItem> {
    engine.downloads.read().clone()
}

#[tauri::command]
async fn add_download_task(
    req: NewDownloadRequest,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<DownloadItem, String> {
    let item = engine.add_download(req.clone());
    let started = engine.inner().start_download_execution(item, &req).await;
    Ok(started)
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
fn resume_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
    let (tx, rx) = tokio::sync::watch::channel(false);
    engine.active_cancellations.write().insert(id.clone(), tx);

    {
        let mut dls = engine.downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
            d.status = DownloadStatus::Downloading;
            d.transfer_log
                .push("Resuming multi-threaded segments from byte offset...".to_string());
        }
    }

    let dls_arc = Arc::clone(&engine.downloads);
    let st_arc = Arc::clone(&engine.settings);
    tauri::async_runtime::spawn(async move {
        let _ = execute_segmented_http_download(id, dls_arc, st_arc, rx).await;
    });
    Ok(())
}

#[tauri::command]
fn delete_download(
    id: String,
    delete_file: bool,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<(), String> {
    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
        let _ = tx.send(true);
    }
    let mut dls = engine.downloads.write();
    if let Some(pos) = dls.iter().position(|d| d.id == id) {
        let removed = dls.remove(pos);
        if delete_file {
            let _ = std::fs::remove_file(&removed.save_path);
        }
    }
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
fn open_extension_folder(family: String) -> Result<String, String> {
    let dir = crate::browser::get_or_create_extension_dir(&family)?;
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dir).spawn();
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

pub fn run_app() {
    let engine = Arc::new(DownloadEngine::new());

    // Auto-install browser extension Native Messaging manifests and extract bundles
    let _ = browser::get_or_create_extension_dir("chromium");
    let _ = browser::get_or_create_extension_dir("firefox");

    {
        let mut st = engine.settings.write();
        if st.browser.auto_install_extensions_on_startup {
            let _ = auto_register_all_detected_browsers(&mut st);
        }
    }

    let ipc_engine = Arc::clone(&engine);
    let ipc_port = engine.settings.read().browser.ipc_port;

    let sched_engine = Arc::clone(&engine);

    tauri::Builder::default()
        .manage(engine)
        .setup(move |_app| {
            tauri::async_runtime::spawn(async move {
                browser::ipc_server::start_browser_ipc_server(ipc_engine, ipc_port).await;
            });
            tauri::async_runtime::spawn(async move {
                scheduler::run_scheduler_loop(sched_engine).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_downloads,
            add_download_task,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running X Download Manager");
}
