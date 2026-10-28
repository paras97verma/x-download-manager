pub mod browser;
pub mod config;
pub mod engine;
pub mod scheduler;

use std::sync::Arc;
use tauri::State;

use crate::browser::{auto_register_all_detected_browsers, configure_browser_integration, detect_browsers, BrowserStatus};
use crate::config::AppSettings;
use crate::engine::{
    ftp_auth::{download_via_ftp, resolve_usersdrive_or_filehost, ResolvedAuthDownload},
    http::execute_segmented_http_download,
    torrent::create_initial_torrent_metadata,
    DownloadEngine, DownloadItem, DownloadProtocol, DownloadStatus, NewDownloadRequest,
};

#[tauri::command]
pub fn get_downloads(engine: State<'_, Arc<DownloadEngine>>) -> Vec<DownloadItem> {
    engine.downloads.read().clone()
}

#[tauri::command]
pub async fn add_download_task(
    req: NewDownloadRequest,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<DownloadItem, String> {
    let mut item = engine.add_download(req.clone());

    if item.protocol == DownloadProtocol::BitTorrent || item.protocol == DownloadProtocol::Magnet {
        let default_trackers = engine.settings.read().torrent.default_trackers.clone();
        let seq = req.sequential_torrent.unwrap_or_else(|| engine.settings.read().torrent.sequential_download_default);
        let meta = create_initial_torrent_metadata(&item.url, &default_trackers, seq);
        let mut dls = engine.downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == item.id) {
            d.torrent_meta = Some(meta.clone());
            d.total_bytes = meta.files.iter().map(|f| f.size_bytes).sum();
            item = d.clone();
        }
    } else if item.protocol == DownloadProtocol::Usersdrive || item.protocol == DownloadProtocol::FileHostAuth {
        let st = engine.settings.read().clone();
        if let Ok(resolved) = resolve_usersdrive_or_filehost(&item.url, &st, item.cookies.clone()).await {
            let mut dls = engine.downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item.id) {
                d.resolved_url = Some(resolved.direct_url);
                if let Some(fname) = resolved.filename {
                    d.filename = fname;
                }
                d.transfer_log.push(resolved.resolver_note);
                item = d.clone();
            }
        }
    }

    if req.start_immediately {
        let (tx, rx) = tokio::sync::watch::channel(false);
        engine.active_cancellations.write().insert(item.id.clone(), tx);

        let dls_arc = Arc::clone(&engine.downloads);
        let st_arc = Arc::clone(&engine.settings);
        let id_clone = item.id.clone();
        let proto = item.protocol.clone();
        let url_clone = item.url.clone();
        let save_clone = item.save_path.clone();

        tokio::spawn(async move {
            if proto == DownloadProtocol::Ftp || proto == DownloadProtocol::Ftps {
                let st = st_arc.read().clone();
                let _ = download_via_ftp(&url_clone, &save_clone, 0, &st).await;
            } else if proto != DownloadProtocol::BitTorrent && proto != DownloadProtocol::Magnet {
                let _ = execute_segmented_http_download(id_clone, dls_arc, st_arc, rx).await;
            }
        });
    }

    Ok(item)
}

#[tauri::command]
pub fn pause_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
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
pub fn resume_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
    let (tx, rx) = tokio::sync::watch::channel(false);
    engine.active_cancellations.write().insert(id.clone(), tx);

    {
        let mut dls = engine.downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
            d.status = DownloadStatus::Downloading;
            d.transfer_log.push("Resuming multi-threaded segments from byte offset...".to_string());
        }
    }

    let dls_arc = Arc::clone(&engine.downloads);
    let st_arc = Arc::clone(&engine.settings);
    tokio::spawn(async move {
        let _ = execute_segmented_http_download(id, dls_arc, st_arc, rx).await;
    });
    Ok(())
}

#[tauri::command]
pub fn delete_download(id: String, delete_file: bool, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
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
pub fn get_settings(engine: State<'_, Arc<DownloadEngine>>) -> AppSettings {
    engine.settings.read().clone()
}

#[tauri::command]
pub fn update_settings(new_settings: AppSettings, engine: State<'_, Arc<DownloadEngine>>) -> Result<AppSettings, String> {
    engine.config_manager.save(&new_settings)?;
    *engine.settings.write() = new_settings.clone();
    Ok(new_settings)
}

#[tauri::command]
pub fn get_browser_statuses(engine: State<'_, Arc<DownloadEngine>>) -> Vec<BrowserStatus> {
    let st = engine.settings.read();
    detect_browsers(&st)
}

#[tauri::command]
pub fn toggle_browser_extension(
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
pub async fn resolve_authenticated_link(
    url: String,
    cookies: Option<String>,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<ResolvedAuthDownload, String> {
    let st = engine.settings.read().clone();
    resolve_usersdrive_or_filehost(&url, &st, cookies).await
}

pub fn run_app() {
    let engine = Arc::new(DownloadEngine::new());

    // Auto-install browser extension Native Messaging manifests on startup if enabled
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
            tokio::spawn(async move {
                browser::ipc_server::start_browser_ipc_server(ipc_engine, ipc_port).await;
            });
            tokio::spawn(async move {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running X Download Manager");
}
