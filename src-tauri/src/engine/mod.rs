pub mod http;
pub mod torrent;
pub mod ftp_auth;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use chrono::Utc;

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
}

pub struct DownloadEngine {
    pub settings: Arc<RwLock<AppSettings>>,
    pub config_manager: ConfigManager,
    pub downloads: Arc<RwLock<Vec<DownloadItem>>>,
    pub active_cancellations: Arc<RwLock<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
}

impl DownloadEngine {
    pub fn new() -> Self {
        let config_manager = ConfigManager::new();
        let settings = config_manager.load();
        Self {
            settings: Arc::new(RwLock::new(settings)),
            config_manager,
            downloads: Arc::new(RwLock::new(Vec::new())),
            active_cancellations: Arc::new(RwLock::new(HashMap::new())),
        }
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
        } else if lower.contains("1fichier.com") || lower.contains("mediafire.com") || lower.contains("pixeldrain.com") {
            DownloadProtocol::FileHostAuth
        } else if lower.starts_with("https://") {
            DownloadProtocol::Https
        } else {
            DownloadProtocol::Http
        }
    }

    pub fn infer_category(filename: &str, protocol: &DownloadProtocol, settings: &AppSettings) -> String {
        if *protocol == DownloadProtocol::BitTorrent || *protocol == DownloadProtocol::Magnet {
            return "Torrents".to_string();
        }
        if let Some(ext) = filename.rsplit('.').next() {
            let ext_lower = ext.to_lowercase();
            for cat in &settings.categories {
                if cat.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext_lower)) {
                    return cat.name.clone();
                }
            }
        }
        "Compressed".to_string()
    }

    pub fn add_download(&self, req: NewDownloadRequest) -> DownloadItem {
        let settings = self.settings.read().clone();
        let protocol = Self::detect_protocol(&req.url);
        let id = Uuid::new_v4().to_string();

        let filename = req.filename.unwrap_or_else(|| {
            if protocol == DownloadProtocol::Magnet {
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

        let category = req.category.unwrap_or_else(|| Self::infer_category(&filename, &protocol, &settings));
        let threads_count = req.threads_count.unwrap_or(settings.default_threads_per_download).clamp(1, settings.max_threads_per_download);
        let save_path = req.save_path.unwrap_or_else(|| {
            format!("{}/{}/{}", settings.default_download_dir, category, filename)
        });

        let mut headers = req.custom_headers.unwrap_or_default();
        if let Some(ua) = req.user_agent {
            headers.insert("User-Agent".to_string(), ua);
        }

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
            status: if req.start_immediately { DownloadStatus::Connecting } else { DownloadStatus::Queued },
            resumable: true,
            threads_count,
            segments: Vec::new(),
            torrent_meta: None,
            source_browser: req.source_browser,
            referer: req.referer,
            cookies: req.cookies,
            custom_headers: headers,
            site_credential_id: None,
            checksum_sha256: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            error_message: None,
            transfer_log: vec![
                format!("[{}] Added download task ({:?})", Utc::now().format("%H:%M:%S"), protocol),
            ],
        };

        self.downloads.write().insert(0, item.clone());
        item
    }
}
