pub mod ftp_auth;
pub mod http;
pub mod rate_limiter;
pub mod torrent;

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

use crate::config::{AppSettings, ConfigManager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadProtocol {
    Http,
    Https,
    BitTorrent,
    Magnet,
    Ftp,
    Ftps,
    Sftp,
    Usersdrive,
    FileHostAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Connecting,
    Authenticating,
    Downloading,
    Merging,
    Seeding,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadSegment {
    pub id: usize,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded_bytes: u64,
    pub speed_bps: u64,
    pub status: String, // "waiting" | "connecting" | "receiving" | "completed" | "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentPeerInfo {
    pub ip_port: String,
    pub client: String,
    pub flags: String,
    pub progress_pct: f64,
    pub down_speed_bps: u64,
    pub up_speed_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFileEntry {
    pub index: usize,
    pub path: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub priority: String, // "high" | "normal" | "skip"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentMetadata {
    pub info_hash: String,
    pub piece_length: u64,
    pub total_pieces: usize,
    pub completed_pieces: usize,
    pub peers_connected: usize,
    pub seeds_connected: usize,
    pub share_ratio: f64,
    pub uploaded_bytes: u64,
    pub sequential: bool,
    pub trackers: Vec<String>,
    pub peers: Vec<TorrentPeerInfo>,
    pub files: Vec<TorrentFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub resolved_url: Option<String>,
    pub protocol: DownloadProtocol,
    pub category: String,
    pub queue_id: String,
    pub save_path: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub speed_bps: u64,
    pub upload_speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub status: DownloadStatus,
    pub resumable: bool,
    pub threads_count: usize,
    pub segments: Vec<ThreadSegment>,
    pub torrent_meta: Option<TorrentMetadata>,
    pub source_browser: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub custom_headers: HashMap<String, String>,
    pub site_credential_id: Option<String>,
    pub checksum_sha256: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub transfer_log: Vec<String>,
    pub torrent_file_path: Option<String>,
    pub torrent_selected_files: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewDownloadRequest {
    pub url: String,
    pub filename: Option<String>,
    pub category: Option<String>,
    pub save_path: Option<String>,
    pub threads_count: Option<usize>,
    pub queue_id: Option<String>,
    pub start_immediately: bool,
    pub source_browser: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub auth_username: Option<String>,
    pub auth_password: Option<String>,
    pub sequential_torrent: Option<bool>,
    pub torrent_file_data: Option<String>,
    pub torrent_selected_files: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateDownloadNotice {
    pub kind: String,
    pub existing_download_id: Option<String>,
    pub existing_filename: String,
    pub existing_status: Option<DownloadStatus>,
    pub existing_path: String,
    pub request: NewDownloadRequest,
}

pub struct DownloadEngine {
    pub settings: Arc<RwLock<AppSettings>>,
    pub config_manager: ConfigManager,
    pub downloads: Arc<RwLock<Vec<DownloadItem>>>,
    pub active_cancellations: Arc<RwLock<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
    history_path: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct DownloadHistory {
    format_version: u32,
    downloads: Vec<DownloadItem>,
}

fn restore_downloads(path: &Path) -> Vec<DownloadItem> {
    let backup = path.with_extension("json.bak");
    for candidate in [path, backup.as_path()] {
        let Ok(raw) = fs::read_to_string(candidate) else {
            continue;
        };
        let Ok(history) = serde_json::from_str::<DownloadHistory>(&raw) else {
            continue;
        };
        if history.format_version != 1 {
            continue;
        }
        return normalize_restored_downloads(history.downloads);
    }
    Vec::new()
}

fn normalize_restored_downloads(mut downloads: Vec<DownloadItem>) -> Vec<DownloadItem> {
    for download in &mut downloads {
        if matches!(
            download.status,
            DownloadStatus::Connecting
                | DownloadStatus::Authenticating
                | DownloadStatus::Downloading
                | DownloadStatus::Merging
                | DownloadStatus::Seeding
        ) {
            download.status = DownloadStatus::Paused;
            download
                .transfer_log
                .push("Paused while ByteX was updated; resume is available.".to_string());
        } else if download.status == DownloadStatus::Queued {
            download.status = DownloadStatus::Paused;
            download.transfer_log.push(
                "Restored from download history; resume manually to prevent an automatic restart."
                    .to_string(),
            );
        }
        download.speed_bps = 0;
        download.upload_speed_bps = 0;
        download.eta_seconds = None;
        for segment in &mut download.segments {
            segment.speed_bps = 0;
            if matches!(segment.status.as_str(), "receiving" | "connecting") {
                segment.status = "paused".to_string();
            }
        }
        if let Some(meta) = download.torrent_meta.as_mut() {
            meta.peers.clear();
            meta.peers_connected = 0;
            meta.seeds_connected = 0;
        }
    }
    downloads
}

fn write_download_history(path: &Path, downloads: &[DownloadItem]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create download history directory: {e}"))?;

    let history = DownloadHistory {
        format_version: 1,
        downloads: downloads.to_vec(),
    };
    let bytes = serde_json::to_vec(&history).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| format!("Could not create download history snapshot: {e}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("Could not write download history snapshot: {e}"))?;
    drop(file);

    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)
            .map_err(|e| format!("Could not back up download history: {e}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("Could not replace download history: {error}"));
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

impl DownloadEngine {
    pub fn new() -> Self {
        let config_manager = ConfigManager::new();
        let settings = config_manager.load();
        let history_path = config_manager.download_history_path();
        let downloads = restore_downloads(&history_path);
        Self {
            settings: Arc::new(RwLock::new(settings)),
            config_manager,
            downloads: Arc::new(RwLock::new(downloads)),
            active_cancellations: Arc::new(RwLock::new(HashMap::new())),
            history_path,
        }
    }

    /// Save an atomic snapshot of the download list. The history file and
    /// torrent resume data are stored outside the install directory.
    pub fn persist_downloads(&self) -> Result<(), String> {
        let downloads = self.downloads.read().clone();
        write_download_history(&self.history_path, &downloads)
    }

    pub fn detect_protocol(url: &str) -> DownloadProtocol {
        let lower = url.trim().to_lowercase();
        if lower.starts_with("magnet:?") {
            DownloadProtocol::Magnet
        } else if lower.ends_with(".torrent") {
            DownloadProtocol::BitTorrent
        } else if lower.starts_with("ftps://") {
            DownloadProtocol::Ftps
        } else if lower.starts_with("ftp://") {
            DownloadProtocol::Ftp
        } else if lower.starts_with("sftp://") {
            DownloadProtocol::Sftp
        } else if lower.contains("usersdrive.com") {
            DownloadProtocol::Usersdrive
        } else if lower.contains("1fichier.com")
            || lower.contains("mediafire.com")
            || lower.contains("pixeldrain.com")
        {
            DownloadProtocol::FileHostAuth
        } else if lower.starts_with("https://") {
            DownloadProtocol::Https
        } else {
            DownloadProtocol::Http
        }
    }

    pub fn infer_category(
        filename: &str,
        protocol: &DownloadProtocol,
        settings: &AppSettings,
    ) -> String {
        if *protocol == DownloadProtocol::BitTorrent || *protocol == DownloadProtocol::Magnet {
            return "Torrents".to_string();
        }
        if let Some(ext) = filename.rsplit('.').next() {
            let ext_lower = ext.to_lowercase();
            for cat in &settings.categories {
                if cat
                    .extensions
                    .iter()
                    .any(|e| e.eq_ignore_ascii_case(&ext_lower))
                {
                    return cat.name.clone();
                }
            }
        }
        "Compressed".to_string()
    }

    fn filename_for_request(req: &NewDownloadRequest, protocol: &DownloadProtocol) -> String {
        let candidate = req.filename.clone().unwrap_or_else(|| {
            if *protocol == DownloadProtocol::Magnet {
                if let Some(dn_pos) = req.url.find("dn=") {
                    let rest = &req.url[dn_pos + 3..];
                    let end = rest.find('&').unwrap_or(rest.len());
                    return rest[..end].replace('+', " ");
                }
                return "Magnet_Download.torrent".to_string();
            }
            req.url
                .split('?')
                .next()
                .unwrap_or(&req.url)
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or("downloaded_file.bin")
                .to_string()
        });
        candidate
            .replace('\\', "/")
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or("downloaded_file.bin")
            .to_string()
    }

    /// Resolve the final output path for a new request without mutating the download list.
    pub fn destination_path(&self, req: &NewDownloadRequest) -> PathBuf {
        let settings = self.settings.read().clone();
        let protocol = Self::detect_protocol(&req.url);
        let filename = Self::filename_for_request(req, &protocol);
        let category = req
            .category
            .clone()
            .unwrap_or_else(|| Self::infer_category(&filename, &protocol, &settings));
        let directory = req
            .save_path
            .as_deref()
            .map(crate::config::resolve_path)
            .unwrap_or_else(|| {
                crate::config::resolve_path(&settings.default_download_dir).join(category)
            });
        directory.join(filename)
    }

    pub fn add_download(&self, req: NewDownloadRequest) -> DownloadItem {
        let settings = self.settings.read().clone();
        let protocol = Self::detect_protocol(&req.url);
        let id = Uuid::new_v4().to_string();

        let torrent_file_path = req.torrent_file_data.as_deref().and_then(|encoded| {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()?;
            let temp_dir =
                crate::config::resolve_path(&settings.temp_segment_dir).join("torrent-meta");
            std::fs::create_dir_all(&temp_dir).ok()?;
            let path = temp_dir.join(format!("{}.torrent", id));
            std::fs::write(&path, bytes).ok()?;
            Some(path.to_string_lossy().to_string())
        });

        let filename = Self::filename_for_request(&req, &protocol);

        let category = req
            .category
            .unwrap_or_else(|| Self::infer_category(&filename, &protocol, &settings));
        let threads_count = req
            .threads_count
            .unwrap_or(settings.default_threads_per_download)
            .clamp(1, settings.max_threads_per_download);
        let save_path = req
            .save_path
            .map(|p| {
                crate::config::resolve_path(&p)
                    .join(&filename)
                    .to_string_lossy()
                    .to_string()
            })
            .unwrap_or_else(|| {
                let base = crate::config::resolve_path(&settings.default_download_dir);
                base.join(&category)
                    .join(&filename)
                    .to_string_lossy()
                    .to_string()
            });

        let mut headers = req.custom_headers.unwrap_or_default();
        if let Some(username) = &req.auth_username {
            headers.insert("X-XDM-FTP-Username".to_string(), username.clone());
        }
        if let Some(password) = &req.auth_password {
            headers.insert("X-XDM-FTP-Password".to_string(), password.clone());
        }
        if let (Some(username), Some(password)) = (&req.auth_username, &req.auth_password) {
            headers
                .entry("Authorization".to_string())
                .or_insert_with(|| {
                    format!(
                        "Basic {}",
                        base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            format!("{}:{}", username, password)
                        )
                    )
                });
        }
        if let Some(ua) = req.user_agent {
            headers.insert("User-Agent".to_string(), ua);
        }
        let mut cookies = req.cookies;
        let site_credential_id = ftp_auth::apply_site_credential(
            &req.url,
            &settings.site_credentials,
            &mut headers,
            &mut cookies,
        );

        let item = DownloadItem {
            id: id.clone(),
            filename,
            url: req.url.clone(),
            resolved_url: None,
            protocol: protocol.clone(),
            category,
            queue_id: req.queue_id.unwrap_or_else(|| "main-queue".to_string()),
            save_path,
            total_bytes: 0,
            downloaded_bytes: 0,
            speed_bps: 0,
            upload_speed_bps: 0,
            eta_seconds: None,
            status: if req.start_immediately {
                DownloadStatus::Connecting
            } else {
                DownloadStatus::Queued
            },
            resumable: true,
            threads_count,
            segments: Vec::new(),
            torrent_meta: None,
            source_browser: req.source_browser,
            referer: req.referer,
            cookies,
            custom_headers: headers,
            site_credential_id,
            checksum_sha256: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            error_message: None,
            transfer_log: vec![format!(
                "[{}] Added download task ({:?})",
                Utc::now().format("%H:%M:%S"),
                protocol
            )],
            torrent_file_path,
            torrent_selected_files: req.torrent_selected_files,
        };

        self.downloads.write().insert(0, item.clone());
        item
    }

    pub async fn start_download_execution(
        self: &Arc<Self>,
        mut item: DownloadItem,
        req: &NewDownloadRequest,
    ) -> DownloadItem {
        if item.protocol == DownloadProtocol::BitTorrent
            || item.protocol == DownloadProtocol::Magnet
        {
            let default_trackers = self.settings.read().torrent.default_trackers.clone();
            let seq = req
                .sequential_torrent
                .unwrap_or_else(|| self.settings.read().torrent.sequential_download_default);
            let meta = torrent::create_initial_torrent_metadata(&item.url, &default_trackers, seq);
            let mut dls = self.downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item.id) {
                d.torrent_meta = Some(meta.clone());
                d.total_bytes = meta.files.iter().map(|f| f.size_bytes).sum();
                item = d.clone();
            }
        } else if item.protocol == DownloadProtocol::Usersdrive
            || item.protocol == DownloadProtocol::FileHostAuth
        {
            let st = self.settings.read().clone();
            if let Ok(resolved) =
                ftp_auth::resolve_usersdrive_or_filehost(&item.url, &st, item.cookies.clone()).await
            {
                let mut dls = self.downloads.write();
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
            let settings = self.settings.read().clone();
            let queue_limit = settings
                .queues
                .iter()
                .find(|q| q.id == item.queue_id)
                .map(|q| q.max_concurrent)
                .unwrap_or(settings.max_concurrent_downloads);
            let dls = self.downloads.read();
            let active_global = dls
                .iter()
                .filter(|d| {
                    d.id != item.id
                        && matches!(
                            d.status,
                            DownloadStatus::Connecting
                                | DownloadStatus::Authenticating
                                | DownloadStatus::Downloading
                                | DownloadStatus::Merging
                                | DownloadStatus::Seeding
                        )
                })
                .count();
            let active_queue = dls
                .iter()
                .filter(|d| {
                    d.id != item.id
                        && d.queue_id == item.queue_id
                        && matches!(
                            d.status,
                            DownloadStatus::Connecting
                                | DownloadStatus::Authenticating
                                | DownloadStatus::Downloading
                                | DownloadStatus::Merging
                                | DownloadStatus::Seeding
                        )
                })
                .count();
            drop(dls);
            if active_global >= settings.max_concurrent_downloads || active_queue >= queue_limit {
                let mut dls = self.downloads.write();
                if let Some(d) = dls.iter_mut().find(|d| d.id == item.id) {
                    d.status = DownloadStatus::Queued;
                    d.speed_bps = 0;
                    item = d.clone();
                }
                return item;
            }
            if let Some(d) = self.downloads.write().iter_mut().find(|d| d.id == item.id) {
                d.status = DownloadStatus::Connecting;
                item = d.clone();
            }
            let (tx, rx) = tokio::sync::watch::channel(false);
            self.active_cancellations
                .write()
                .insert(item.id.clone(), tx);

            let dls_arc = Arc::clone(&self.downloads);
            let st_arc = Arc::clone(&self.settings);
            let id_clone = item.id.clone();
            let proto = item.protocol.clone();

            tauri::async_runtime::spawn(async move {
                let result = if proto == DownloadProtocol::Ftp || proto == DownloadProtocol::Ftps {
                    ftp_auth::execute_ftp_download(
                        id_clone.clone(),
                        dls_arc.clone(),
                        st_arc.clone(),
                        rx,
                    )
                    .await
                    .map(|_| ())
                } else if proto == DownloadProtocol::Sftp {
                    let mut dls = dls_arc.write();
                    if let Some(d) = dls.iter_mut().find(|d| d.id == id_clone) {
                        let message = "SFTP is not supported by this build; use FTP/FTPS or HTTPS."
                            .to_string();
                        d.status = DownloadStatus::Failed;
                        d.error_message = Some(message.clone());
                        d.transfer_log.push(format!("[ERROR] {}", message));
                    }
                    return;
                } else if proto == DownloadProtocol::BitTorrent || proto == DownloadProtocol::Magnet
                {
                    torrent::execute_torrent_download(
                        id_clone.clone(),
                        dls_arc.clone(),
                        st_arc.clone(),
                        rx,
                    )
                    .await
                } else {
                    http::execute_segmented_http_download(
                        id_clone.clone(),
                        dls_arc.clone(),
                        st_arc.clone(),
                        rx,
                    )
                    .await
                };
                if let Err(error) = result {
                    let mut dls = dls_arc.write();
                    if let Some(d) = dls.iter_mut().find(|d| d.id == id_clone) {
                        if matches!(
                            d.status,
                            DownloadStatus::Connecting
                                | DownloadStatus::Authenticating
                                | DownloadStatus::Downloading
                                | DownloadStatus::Merging
                                | DownloadStatus::Seeding
                        ) {
                            d.status = DownloadStatus::Failed;
                            d.speed_bps = 0;
                            d.error_message = Some(error.clone());
                            d.transfer_log.push(format!("[ERROR] {error}"));
                        }
                    }
                }
            });
        }

        item
    }

    pub async fn start_queued_downloads(
        self: &Arc<Self>,
        queue_id: Option<String>,
    ) -> Result<usize, String> {
        let mut started = 0;
        loop {
            let candidate = {
                let settings = self.settings.read().clone();
                let global_limit = settings.max_concurrent_downloads;
                let queue_limit = queue_id
                    .as_ref()
                    .and_then(|id| settings.queues.iter().find(|q| &q.id == id))
                    .map(|q| q.max_concurrent)
                    .unwrap_or(global_limit);
                let mut dls = self.downloads.write();
                let active_global = dls
                    .iter()
                    .filter(|d| {
                        matches!(
                            d.status,
                            DownloadStatus::Connecting
                                | DownloadStatus::Authenticating
                                | DownloadStatus::Downloading
                                | DownloadStatus::Merging
                                | DownloadStatus::Seeding
                        )
                    })
                    .count();
                let active_queue = queue_id
                    .as_ref()
                    .map(|id| {
                        dls.iter()
                            .filter(|d| {
                                &d.queue_id == id
                                    && matches!(
                                        d.status,
                                        DownloadStatus::Connecting
                                            | DownloadStatus::Authenticating
                                            | DownloadStatus::Downloading
                                            | DownloadStatus::Merging
                                            | DownloadStatus::Seeding
                                    )
                            })
                            .count()
                    })
                    .unwrap_or(active_global);
                if active_global >= global_limit || active_queue >= queue_limit {
                    None
                } else if let Some(item) = dls.iter_mut().find(|d| {
                    d.status == DownloadStatus::Queued
                        && queue_id
                            .as_ref()
                            .map(|id| &d.queue_id == id)
                            .unwrap_or(true)
                }) {
                    item.status = DownloadStatus::Connecting;
                    Some(item.clone())
                } else {
                    None
                }
            };
            let Some(item) = candidate else {
                break;
            };
            let req = NewDownloadRequest {
                url: item.url.clone(),
                filename: Some(item.filename.clone()),
                category: Some(item.category.clone()),
                save_path: Some(item.save_path.clone()),
                threads_count: Some(item.threads_count),
                queue_id: Some(item.queue_id.clone()),
                start_immediately: true,
                source_browser: item.source_browser.clone(),
                referer: item.referer.clone(),
                cookies: item.cookies.clone(),
                user_agent: item.custom_headers.get("User-Agent").cloned(),
                custom_headers: Some(item.custom_headers.clone()),
                auth_username: None,
                auth_password: None,
                sequential_torrent: None,
                torrent_file_data: None,
                torrent_selected_files: item.torrent_selected_files.clone(),
            };
            self.start_download_execution(item, &req).await;
            started += 1;
        }
        Ok(started)
    }

    pub async fn start_download_by_id(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let item = self
            .downloads
            .read()
            .iter()
            .find(|d| d.id == id)
            .cloned()
            .ok_or_else(|| "Download not found".to_string())?;
        let req = NewDownloadRequest {
            url: item.url.clone(),
            filename: Some(item.filename.clone()),
            category: Some(item.category.clone()),
            save_path: Some(item.save_path.clone()),
            threads_count: Some(item.threads_count),
            queue_id: Some(item.queue_id.clone()),
            start_immediately: true,
            source_browser: item.source_browser.clone(),
            referer: item.referer.clone(),
            cookies: item.cookies.clone(),
            user_agent: item.custom_headers.get("User-Agent").cloned(),
            custom_headers: Some(item.custom_headers.clone()),
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: item.torrent_selected_files.clone(),
        };
        self.start_download_execution(item, &req).await;
        Ok(())
    }
}

impl Default for DownloadEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;

    #[test]
    fn history_restores_active_downloads_as_resumable_paused_items() {
        let engine = DownloadEngine::new();
        let mut item = engine.add_download(NewDownloadRequest {
            url: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=resume-test"
                .into(),
            filename: Some("resume-test".into()),
            category: Some("Torrents".into()),
            save_path: Some("/downloads/resume-test".into()),
            threads_count: None,
            queue_id: Some("main-queue".into()),
            start_immediately: false,
            source_browser: None,
            referer: None,
            cookies: Some("session=kept".into()),
            user_agent: None,
            custom_headers: None,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: Some(vec![0]),
        });
        item.status = DownloadStatus::Downloading;
        item.downloaded_bytes = 786_432;
        item.total_bytes = 2_000_000;
        item.torrent_file_path = Some("/config/torrent-meta/resume-test.torrent".into());
        item.torrent_meta = Some(torrent::create_initial_torrent_metadata(
            &item.url,
            &[],
            false,
        ));
        item.segments = vec![ThreadSegment {
            id: 0,
            start_byte: 0,
            end_byte: 1_000,
            downloaded_bytes: 600,
            speed_bps: 900,
            status: "receiving".into(),
        }];
        let mut queued_item = item.clone();
        queued_item.id = "queued-history-item".to_string();
        queued_item.status = DownloadStatus::Queued;
        let path = std::env::temp_dir().join(format!("bytex-history-{}.json", Uuid::new_v4()));

        write_download_history(&path, &[item, queued_item]).expect("history should save");
        let restored = restore_downloads(&path);
        let restored_item = restored.first().expect("download should restore");

        assert_eq!(restored_item.status, DownloadStatus::Paused);
        assert_eq!(restored_item.downloaded_bytes, 786_432);
        assert_eq!(restored_item.segments[0].downloaded_bytes, 600);
        assert_eq!(restored_item.segments[0].status, "paused");
        assert_eq!(restored_item.cookies.as_deref(), Some("session=kept"));
        assert_eq!(restored_item.torrent_selected_files, Some(vec![0]));
        assert_eq!(
            restored_item.torrent_file_path.as_deref(),
            Some("/config/torrent-meta/resume-test.torrent")
        );
        assert!(restored_item.torrent_meta.is_some());

        let restored_queued = restored
            .iter()
            .find(|item| item.id == "queued-history-item")
            .expect("queued item should restore");
        assert_eq!(restored_queued.status, DownloadStatus::Paused);
        assert!(restored_queued
            .transfer_log
            .iter()
            .any(|entry| entry.contains("resume manually")));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("json.bak"));
    }

    #[test]
    fn explicit_save_path_is_a_directory_and_filename_paths_are_sanitized() {
        let engine = DownloadEngine::new();
        let directory = std::env::temp_dir().join(format!("bytex-save-dir-{}", Uuid::new_v4()));
        let item = engine.add_download(NewDownloadRequest {
            url: "https://example.com/report.zip".into(),
            filename: Some("../report.zip".into()),
            category: None,
            save_path: Some(directory.to_string_lossy().to_string()),
            threads_count: None,
            queue_id: None,
            start_immediately: false,
            source_browser: None,
            referer: None,
            cookies: None,
            user_agent: None,
            custom_headers: None,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
        });

        assert_eq!(item.filename, "report.zip");
        assert_eq!(PathBuf::from(item.save_path), directory.join("report.zip"));
    }
}
