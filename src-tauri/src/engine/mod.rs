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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DownloadRedirect {
    pub from_url: String,
    pub to_url: String,
    pub status_code: Option<u16>,
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
    #[serde(default)]
    pub redirect_chain: Vec<DownloadRedirect>,
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
    #[serde(default)]
    pub range_advertised: bool,
    #[serde(default)]
    pub resume_validator: Option<String>,
    pub threads_count: usize,
    pub segments: Vec<ThreadSegment>,
    pub torrent_meta: Option<TorrentMetadata>,
    pub source_browser: Option<String>,
    pub referer: Option<String>,
    pub cookies: Option<String>,
    pub custom_headers: HashMap<String, String>,
    #[serde(default = "default_request_method")]
    pub request_method: String,
    #[serde(skip)]
    pub request_body: Option<String>,
    #[serde(default)]
    pub browser_intercepted: bool,
    #[serde(default)]
    pub browser_context_redacted: bool,
    pub site_credential_id: Option<String>,
    pub checksum_sha256: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub transfer_log: Vec<String>,
    pub torrent_file_path: Option<String>,
    pub torrent_selected_files: Option<Vec<usize>>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub speed_limit_bps: Option<u64>,
}

fn default_priority() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewDownloadRequest {
    pub url: String,
    #[serde(default)]
    pub final_url: Option<String>,
    #[serde(default)]
    pub redirect_chain: Vec<DownloadRedirect>,
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
    #[serde(default = "default_request_method")]
    pub request_method: String,
    #[serde(skip)]
    pub request_body: Option<String>,
    #[serde(default)]
    pub browser_intercepted: bool,
    pub auth_username: Option<String>,
    pub auth_password: Option<String>,
    pub sequential_torrent: Option<bool>,
    pub torrent_file_data: Option<String>,
    pub torrent_selected_files: Option<Vec<usize>>,
}

fn default_request_method() -> String {
    "GET".to_string()
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
    pub db: Arc<crate::db::DatabaseManager>,
    pub keyring: Arc<crate::security::KeyringStore>,
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

fn restored_output_exists(download: &DownloadItem) -> bool {
    let output = crate::config::resolve_path(&download.save_path);
    if !output.exists() {
        return false;
    }

    let Some(metadata) = download.torrent_meta.as_ref() else {
        return true;
    };
    if !matches!(
        &download.protocol,
        DownloadProtocol::BitTorrent | DownloadProtocol::Magnet
    ) {
        return true;
    }

    let selected = download.torrent_selected_files.as_ref().map(|indices| {
        indices
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
    });
    let files = metadata
        .files
        .iter()
        .filter(|file| file.priority != "skip")
        .filter(|file| {
            selected
                .as_ref()
                .is_none_or(|indices| indices.contains(&file.index))
        })
        .collect::<Vec<_>>();
    if files.is_empty() {
        return true;
    }

    if download.status == DownloadStatus::Completed {
        return files.iter().all(|file| output.join(&file.path).exists());
    }

    let progressed_files = files
        .iter()
        .filter(|file| file.downloaded_bytes > 0)
        .collect::<Vec<_>>();
    if progressed_files.is_empty() {
        files.iter().any(|file| output.join(&file.path).exists())
    } else {
        progressed_files
            .iter()
            .all(|file| output.join(&file.path).exists())
    }
}

fn normalize_restored_downloads(mut downloads: Vec<DownloadItem>) -> Vec<DownloadItem> {
    // Download history intentionally lives outside the app bundle so upgrades
    // preserve valid transfers. Drop entries whose output has since been
    // removed, otherwise a stale active record can be resumed after reinstall.
    downloads.retain(|download| {
        restored_output_exists(download)
            || (download.status == DownloadStatus::Queued && download.downloaded_bytes == 0)
    });

    for download in &mut downloads {
        if download.browser_context_redacted && download.status != DownloadStatus::Completed {
            download.status = DownloadStatus::Failed;
            download.resumable = false;
            let message = "This browser download needs session details that ByteX keeps only in memory. Start it again from the browser to continue safely.".to_string();
            download.error_message = Some(message.clone());
            download.transfer_log.push(format!("[ERROR] {message}"));
        }
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

    let downloads = downloads
        .iter()
        .cloned()
        .map(redact_download_secrets_for_history)
        .collect();
    let history = DownloadHistory {
        format_version: 1,
        downloads,
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

fn redact_download_secrets_for_history(mut download: DownloadItem) -> DownloadItem {
    if download.source_browser.is_none() {
        return download;
    }

    let mut redacted =
        download.request_body.is_some() || download.cookies.is_some() || download.referer.is_some();
    download.request_body = None;
    download.cookies = None;
    download.referer = None;

    for (name, value) in &mut download.custom_headers {
        let lower = name.to_ascii_lowercase();
        if lower == "cookie"
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
            || lower.starts_with("x-xdm-ftp-")
        {
            *value = String::new();
            redacted = true;
        }
    }
    download.custom_headers.retain(|_, value| !value.is_empty());

    redacted |= redact_url_query(&mut download.url);
    if let Some(url) = download.resolved_url.as_mut() {
        redacted |= redact_url_query(url);
    }
    for redirect in &mut download.redirect_chain {
        redacted |= redact_url_query(&mut redirect.from_url);
        redacted |= redact_url_query(&mut redirect.to_url);
    }
    download.browser_context_redacted |= redacted;
    download
}

fn redact_url_query(value: &mut String) -> bool {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return false;
    };
    if parsed.username().is_empty() && parsed.password().is_none() && parsed.query().is_none() {
        return false;
    }
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    parsed.set_query(None);
    parsed.set_fragment(None);
    *value = parsed.to_string();
    true
}

impl DownloadEngine {
    pub fn new() -> Self {
        let config_manager = ConfigManager::new();
        let settings = config_manager.load();
        let history_path = config_manager.download_history_path();
        let db_path = config_manager.database_path();
        let db = Arc::new(
            crate::db::DatabaseManager::open(&db_path).unwrap_or_else(|e| {
                tracing::warn!(
                    "Failed to open SQLite database at {:?}: {}; using memory database",
                    db_path,
                    e
                );
                crate::db::DatabaseManager::open_in_memory()
                    .expect("Failed to initialize fallback in-memory database")
            }),
        );
        let keyring = Arc::new(crate::security::KeyringStore::new());

        // Perform zero-data-loss migration from downloads.json if present and SQLite is fresh
        let _ = db.migrate_from_json_if_needed(&history_path);

        // Load downloads from SQLite, falling back to JSON if database returns empty and JSON exists
        let downloads = match db.load_downloads() {
            Ok(dls) if !dls.is_empty() => dls,
            _ => restore_downloads(&history_path),
        };

        // Populate keyring with any configured credentials
        for cred in &settings.site_credentials {
            if !cred.password_or_token.is_empty() {
                let _ =
                    keyring.set_secret(&format!("site_cred:{}", cred.id), &cred.password_or_token);
            }
        }

        Self {
            settings: Arc::new(RwLock::new(settings)),
            config_manager,
            downloads: Arc::new(RwLock::new(downloads)),
            active_cancellations: Arc::new(RwLock::new(HashMap::new())),
            history_path,
            db,
            keyring,
        }
    }

    /// Save an atomic snapshot of the download list. The history database and
    /// torrent resume data are stored outside the install directory.
    pub fn persist_downloads(&self) -> Result<(), String> {
        let downloads = self.downloads.read().clone();
        // 1. Transactional write to normalized SQLite database
        let db_res = self.db.save_downloads(&downloads);
        if let Err(ref e) = db_res {
            tracing::warn!("Failed to persist downloads to SQLite: {}", e);
        }
        // 2. Also write JSON snapshot backup
        let json_res = write_download_history(&self.history_path, &downloads);
        db_res.or(json_res)
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
        let protocol = if req.browser_intercepted {
            let transfer_url = req.final_url.as_deref().unwrap_or(&req.url);
            match url::Url::parse(transfer_url)
                .map(|url| url.scheme().to_string())
                .as_deref()
            {
                Ok("http") => DownloadProtocol::Http,
                Ok("https") => DownloadProtocol::Https,
                Ok("ftp") => DownloadProtocol::Ftp,
                Ok("ftps") => DownloadProtocol::Ftps,
                _ => Self::detect_protocol(transfer_url),
            }
        } else {
            Self::detect_protocol(&req.url)
        };
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
            resolved_url: req.final_url.clone(),
            redirect_chain: req.redirect_chain,
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
            range_advertised: false,
            resume_validator: None,
            threads_count,
            segments: Vec::new(),
            torrent_meta: None,
            source_browser: req.source_browser,
            referer: req.referer,
            cookies,
            custom_headers: headers,
            request_method: req.request_method,
            request_body: req.request_body,
            browser_intercepted: req.browser_intercepted,
            browser_context_redacted: false,
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
            priority: "normal".to_string(),
            speed_limit_bps: None,
        };

        self.downloads.write().insert(0, item.clone());
        item
    }

    pub async fn start_download_execution(
        self: &Arc<Self>,
        item: DownloadItem,
        req: &NewDownloadRequest,
    ) -> DownloadItem {
        self.start_download_execution_inner(item, req, None).await
    }

    pub async fn start_download_execution_with_ack(
        self: &Arc<Self>,
        item: DownloadItem,
        req: &NewDownloadRequest,
        startup_ack: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) -> DownloadItem {
        self.start_download_execution_inner(item, req, Some(startup_ack))
            .await
    }

    async fn start_download_execution_inner(
        self: &Arc<Self>,
        mut item: DownloadItem,
        req: &NewDownloadRequest,
        mut startup_ack: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
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
        } else if !item.browser_intercepted
            && (item.protocol == DownloadProtocol::Usersdrive
                || item.protocol == DownloadProtocol::FileHostAuth)
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
                if let Some(ack) = startup_ack.take() {
                    let _ = ack.send(Err("ByteX download queue is full".to_string()));
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
            let mut startup_ack = startup_ack.take();

            tauri::async_runtime::spawn(async move {
                let result = if proto == DownloadProtocol::Ftp || proto == DownloadProtocol::Ftps {
                    ftp_auth::execute_ftp_download_with_ack(
                        id_clone.clone(),
                        dls_arc.clone(),
                        st_arc.clone(),
                        rx,
                        &mut startup_ack,
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
                    http::execute_segmented_http_download_with_ack(
                        id_clone.clone(),
                        dls_arc.clone(),
                        st_arc.clone(),
                        rx,
                        &mut startup_ack,
                    )
                    .await
                };
                if let Some(ack) = startup_ack.take() {
                    let message = result.as_ref().err().cloned().unwrap_or_else(|| {
                        "ByteX could not verify the download response".to_string()
                    });
                    let _ = ack.send(Err(message));
                }
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
                final_url: item.resolved_url.clone(),
                redirect_chain: item.redirect_chain.clone(),
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
                request_method: item.request_method.clone(),
                request_body: item.request_body.clone(),
                browser_intercepted: item.browser_intercepted,
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
            final_url: item.resolved_url.clone(),
            redirect_chain: item.redirect_chain.clone(),
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
            request_method: item.request_method.clone(),
            request_body: item.request_body.clone(),
            browser_intercepted: item.browser_intercepted,
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
        let output_dir =
            std::env::temp_dir().join(format!("bytex-history-output-{}", Uuid::new_v4()));
        fs::create_dir_all(&output_dir).expect("output directory should be created");
        let mut item = engine.add_download(NewDownloadRequest {
            url: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=resume-test"
                .into(),
            final_url: None,
            redirect_chain: Vec::new(),
            filename: Some("resume-test".into()),
            category: Some("Torrents".into()),
            save_path: Some(output_dir.to_string_lossy().to_string()),
            threads_count: None,
            queue_id: Some("main-queue".into()),
            start_immediately: false,
            source_browser: None,
            referer: None,
            cookies: Some("session=kept".into()),
            user_agent: None,
            custom_headers: None,
            request_method: "GET".into(),
            request_body: None,
            browser_intercepted: false,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: Some(vec![0]),
        });
        item.save_path = output_dir.to_string_lossy().to_string();
        fs::write(output_dir.join("resume-test"), b"partial download")
            .expect("partial output should be present for resume");
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
        let _ = fs::remove_dir_all(output_dir);
    }

    #[test]
    fn explicit_save_path_is_a_directory_and_filename_paths_are_sanitized() {
        let engine = DownloadEngine::new();
        let directory = std::env::temp_dir().join(format!("bytex-save-dir-{}", Uuid::new_v4()));
        let item = engine.add_download(NewDownloadRequest {
            url: "https://example.com/report.zip".into(),
            final_url: None,
            redirect_chain: Vec::new(),
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
            request_method: "GET".into(),
            request_body: None,
            browser_intercepted: false,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
        });

        assert_eq!(item.filename, "report.zip");
        assert_eq!(PathBuf::from(item.save_path), directory.join("report.zip"));
    }

    #[test]
    fn browser_credentials_and_signed_urls_are_not_written_to_history() {
        let engine = DownloadEngine::new();
        let directory =
            std::env::temp_dir().join(format!("bytex-secret-history-{}", Uuid::new_v4()));
        let request = NewDownloadRequest {
            url: "https://files.example/archive.zip?token=secret-token".to_string(),
            final_url: Some("https://cdn.example/archive.zip?sig=secret-signature".to_string()),
            redirect_chain: vec![DownloadRedirect {
                from_url: "https://files.example/start?session=secret".to_string(),
                to_url: "https://cdn.example/archive.zip?sig=secret-signature".to_string(),
                status_code: Some(302),
            }],
            filename: Some("archive.zip".to_string()),
            category: None,
            save_path: Some(directory.to_string_lossy().to_string()),
            threads_count: None,
            queue_id: None,
            start_immediately: false,
            source_browser: Some("Chrome".to_string()),
            referer: Some("https://files.example/page?csrf=secret".to_string()),
            cookies: Some("session=secret-cookie".to_string()),
            user_agent: Some("Browser Test".to_string()),
            custom_headers: Some(HashMap::from([
                ("Cookie".to_string(), "session=secret-cookie".to_string()),
                (
                    "Authorization".to_string(),
                    "Bearer secret-header".to_string(),
                ),
                ("Accept".to_string(), "application/octet-stream".to_string()),
            ])),
            request_method: "POST".to_string(),
            request_body: Some("c2VjcmV0LXBvc3QtYm9keQ==".to_string()),
            browser_intercepted: true,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
        };
        let item = engine.add_download(request);
        let path =
            std::env::temp_dir().join(format!("bytex-secret-history-{}.json", Uuid::new_v4()));
        write_download_history(&path, &[item]).expect("history should save");
        let contents = fs::read_to_string(&path).expect("history should be readable");
        for secret in [
            "secret-token",
            "secret-signature",
            "secret-cookie",
            "secret-header",
            "secret-post-body",
            "csrf=secret",
        ] {
            assert!(!contents.contains(secret), "history leaked {secret}");
        }
        let restored = restore_downloads(&path);
        let restored_item = restored
            .first()
            .expect("browser record should remain visible");
        assert!(restored_item.browser_context_redacted);
        assert_eq!(restored_item.status, DownloadStatus::Failed);
        assert!(restored_item
            .error_message
            .as_deref()
            .unwrap()
            .contains("Start it again from the browser"));
        assert_eq!(restored_item.request_method, "POST");
        assert!(restored_item.request_body.is_none());
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("json.bak"));
        let _ = fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn ftp_handoff_is_not_acknowledged_when_the_native_connection_fails() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let engine = Arc::new(DownloadEngine::new());
        let output_dir = std::env::temp_dir().join(format!("bytex-ftp-handoff-{}", Uuid::new_v4()));
        let request = NewDownloadRequest {
            url: format!("ftp://127.0.0.1:{port}/package.bin"),
            final_url: None,
            redirect_chain: Vec::new(),
            filename: Some("package.bin".to_string()),
            category: None,
            save_path: Some(output_dir.to_string_lossy().to_string()),
            threads_count: None,
            queue_id: Some("main-queue".to_string()),
            start_immediately: true,
            source_browser: Some("Firefox".to_string()),
            referer: None,
            cookies: None,
            user_agent: None,
            custom_headers: None,
            request_method: "GET".to_string(),
            request_body: None,
            browser_intercepted: true,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
        };
        let item = engine.add_download(request.clone());
        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
        engine
            .start_download_execution_with_ack(item.clone(), &request, ack_tx)
            .await;

        let acknowledgment = tokio::time::timeout(std::time::Duration::from_secs(5), ack_rx)
            .await
            .expect("FTP setup should return a handoff decision")
            .expect("FTP worker should report its setup result");
        assert!(acknowledgment.unwrap_err().contains("FTP connection error"));
        assert_eq!(
            engine
                .downloads
                .read()
                .iter()
                .find(|current| current.id == item.id)
                .unwrap()
                .status,
            DownloadStatus::Failed
        );
        let _ = std::fs::remove_dir_all(output_dir);
    }
}
