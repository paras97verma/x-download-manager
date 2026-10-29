pub mod browser;
pub mod config;
pub mod engine;
pub mod menu;
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

#[tauri::command]
fn restart_download(id: String, engine: State<'_, Arc<DownloadEngine>>) -> Result<(), String> {
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

    let (tx, rx) = tokio::sync::watch::channel(false);
    engine.active_cancellations.write().insert(id.clone(), tx);
    let dls_arc = Arc::clone(&engine.downloads);
    let st_arc = Arc::clone(&engine.settings);
    tauri::async_runtime::spawn(async move {
        let _ = execute_segmented_http_download(id, dls_arc, st_arc, rx).await;
    });
    Ok(())
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
fn move_to_queue(
    id: String,
    queue_id: String,
    engine: State<'_, Arc<DownloadEngine>>,
) -> Result<(), String> {
    let mut dls = engine.downloads.write();
    if let Some(d) = dls.iter_mut().find(|d| d.id == id) {
        d.queue_id = queue_id.clone();
        d.transfer_log.push(format!("Moved to queue: {}", queue_id));
    }
    Ok(())
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(engine)
        .setup(move |app| {
            // Setup Native System Application Menu (macOS system menu bar / Windows & Linux native menu)
            if let Ok(native_menu) = menu::create_native_app_menu(app.handle()) {
                let _ = app.set_menu(native_menu);
            }

            // Setup Tray Icon & Context Menu
            if let Ok(show_i) = tauri::menu::MenuItem::with_id(
                app,
                "show",
                "Show X Download Manager",
                true,
                None::<&str>,
            ) {
                if let Ok(quit_i) =
                    tauri::menu::MenuItem::with_id(app, "quit", "Quit XDM", true, None::<&str>)
                {
                    if let Ok(menu) = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i]) {
                        let mut builder = tauri::tray::TrayIconBuilder::new()
                            .menu(&menu)
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

                        let _ = builder.build(app);
                    }
                }
            }

            tauri::async_runtime::spawn(async move {
                browser::ipc_server::start_browser_ipc_server(ipc_engine, ipc_port).await;
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
            pick_directory,
            set_autostart,
            is_autostart_enabled,
            request_notification_permission,
            show_notification,
            parse_torrent_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running X Download Manager");
}
