use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 ByteX/1.0";
const LEGACY_DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 XDM/1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteCredential {
    pub id: String,
    pub host_pattern: String,
    pub site_type: String, // "usersdrive" | "1fichier" | "mediafire" | "ftp" | "http_basic" | "bearer" | "cookie"
    pub username: String,
    pub password_or_token: String,
    pub cookies: Option<String>,
    pub custom_headers: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryRule {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub extensions: Vec<String>,
    pub default_subfolder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxySettings {
    pub enabled: bool,
    pub proxy_type: String, // "http" | "https" | "socks5"
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub bypass_local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentSettings {
    pub enable_dht: bool,
    pub enable_pex: bool,
    pub enable_lpd: bool,
    pub enable_upnp: bool,
    pub listen_port: u16,
    pub max_active_torrents: usize,
    pub max_peers_per_torrent: usize,
    pub seed_ratio_limit: f64,
    pub seed_time_limit_minutes: u64,
    pub sequential_download_default: bool,
    pub encryption_mode: String, // "prefer" | "require" | "disable"
    pub default_trackers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserIntegrationSettings {
    pub ipc_port: u16,
    pub auto_install_extensions_on_startup: bool,
    pub intercept_all_downloads: bool,
    pub min_file_size_kb: u64,
    pub intercepted_extensions: Vec<String>,
    pub ignored_domains: Vec<String>,
    pub capture_streaming_media: bool,
    pub bypass_key: String, // "Alt" | "Shift" | "Ctrl"
    pub enabled_browsers: HashMap<String, bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerQueueConfig {
    pub id: String,
    pub name: String,
    pub max_concurrent: usize,
    pub start_time_enabled: bool,
    pub start_time_hhmm: String,
    pub stop_time_enabled: bool,
    pub stop_time_hhmm: String,
    pub days_of_week: Vec<u8>, // 0 = Sun .. 6 = Sat
    pub speed_limit_kbps: Option<u64>,
    pub post_queue_action: String, // "none" | "exit_app" | "sleep" | "shutdown"
}

fn default_ui_mode() -> String {
    "simple".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    // General
    pub theme: String, // "dark" | "light" | "midnight"
    #[serde(default = "default_ui_mode")]
    pub ui_mode: String, // "simple" | "advanced"
    pub start_on_boot: bool,
    pub minimize_to_tray: bool,
    pub show_completion_dialog: bool,
    pub show_detailed_segment_dialog: bool,
    pub play_sound_on_complete: bool,
    pub prevent_system_sleep: bool,
    pub default_download_dir: String,
    pub temp_segment_dir: String,
    pub duplicate_file_action: String, // "auto_rename" | "overwrite" | "prompt"
    pub auto_verify_checksum: bool,
    pub antivirus_command: String,

    // Connections & Multi-Threading (XDM Architecture)
    pub default_threads_per_download: usize,
    pub max_threads_per_download: usize,
    pub max_concurrent_downloads: usize,
    pub min_segment_size_kb: u64,
    pub dynamic_segment_stealing: bool,
    pub max_retries: u32,
    pub retry_delay_seconds: u64,
    pub connection_timeout_seconds: u64,
    pub custom_user_agent: String,

    // Speed Limiter
    pub speed_limiter_enabled: bool,
    pub global_max_download_kbps: u64,
    pub global_max_upload_kbps: u64,

    // Sub-settings
    pub categories: Vec<CategoryRule>,
    pub site_credentials: Vec<SiteCredential>,
    pub torrent: TorrentSettings,
    pub browser: BrowserIntegrationSettings,
    pub proxy: ProxySettings,
    pub queues: Vec<SchedulerQueueConfig>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let base_dl = dirs_default_download_path();
        let temp_dl = format!("{}/.bytex_temp", base_dl);

        let mut enabled_browsers = HashMap::new();
        enabled_browsers.insert("chrome".to_string(), true);
        enabled_browsers.insert("edge".to_string(), true);
        enabled_browsers.insert("brave".to_string(), true);
        enabled_browsers.insert("opera".to_string(), true);
        enabled_browsers.insert("vivaldi".to_string(), true);
        enabled_browsers.insert("firefox".to_string(), true);
        enabled_browsers.insert("safari".to_string(), true);

        Self {
            theme: "dark".to_string(),
            ui_mode: "simple".to_string(),
            start_on_boot: true,
            minimize_to_tray: true,
            show_completion_dialog: true,
            show_detailed_segment_dialog: true,
            play_sound_on_complete: true,
            prevent_system_sleep: true,
            default_download_dir: base_dl,
            temp_segment_dir: temp_dl,
            duplicate_file_action: "auto_rename".to_string(),
            auto_verify_checksum: true,
            antivirus_command: String::new(),

            default_threads_per_download: 8,
            max_threads_per_download: 32,
            max_concurrent_downloads: 5,
            min_segment_size_kb: 512,
            dynamic_segment_stealing: true,
            max_retries: 10,
            retry_delay_seconds: 5,
            connection_timeout_seconds: 30,
            custom_user_agent: DEFAULT_USER_AGENT.to_string(),

            speed_limiter_enabled: false,
            global_max_download_kbps: 10240, // 10 MB/s when enabled
            global_max_upload_kbps: 2048,

            categories: vec![
                CategoryRule {
                    id: "compressed".into(),
                    name: "Compressed".into(),
                    icon: "Archive".into(),
                    extensions: vec![
                        "zip".into(),
                        "rar".into(),
                        "7z".into(),
                        "tar".into(),
                        "gz".into(),
                        "bz2".into(),
                        "xz".into(),
                        "zst".into(),
                    ],
                    default_subfolder: "Compressed".into(),
                },
                CategoryRule {
                    id: "programs".into(),
                    name: "Programs".into(),
                    icon: "Cpu".into(),
                    extensions: vec![
                        "exe".into(),
                        "msi".into(),
                        "dmg".into(),
                        "pkg".into(),
                        "deb".into(),
                        "rpm".into(),
                        "appimage".into(),
                        "iso".into(),
                        "apk".into(),
                    ],
                    default_subfolder: "Programs".into(),
                },
                CategoryRule {
                    id: "video".into(),
                    name: "Video".into(),
                    icon: "Film".into(),
                    extensions: vec![
                        "mp4".into(),
                        "mkv".into(),
                        "webm".into(),
                        "avi".into(),
                        "mov".into(),
                        "flv".into(),
                        "m4v".into(),
                        "ts".into(),
                    ],
                    default_subfolder: "Video".into(),
                },
                CategoryRule {
                    id: "music".into(),
                    name: "Music".into(),
                    icon: "Music".into(),
                    extensions: vec![
                        "mp3".into(),
                        "flac".into(),
                        "wav".into(),
                        "aac".into(),
                        "ogg".into(),
                        "m4a".into(),
                        "opus".into(),
                    ],
                    default_subfolder: "Music".into(),
                },
                CategoryRule {
                    id: "documents".into(),
                    name: "Documents".into(),
                    icon: "FileText".into(),
                    extensions: vec![
                        "pdf".into(),
                        "epub".into(),
                        "docx".into(),
                        "xlsx".into(),
                        "pptx".into(),
                        "txt".into(),
                        "md".into(),
                        "csv".into(),
                    ],
                    default_subfolder: "Documents".into(),
                },
            ],
            site_credentials: Vec::new(),
            torrent: TorrentSettings {
                enable_dht: true,
                enable_pex: true,
                enable_lpd: true,
                enable_upnp: true,
                listen_port: 51413,
                max_active_torrents: 5,
                max_peers_per_torrent: 100,
                seed_ratio_limit: 1.5,
                seed_time_limit_minutes: 120,
                sequential_download_default: false,
                encryption_mode: "prefer".into(),
                default_trackers: vec![
                    "udp://tracker.opentrackr.org:1337/announce".into(),
                    "udp://open.stealth.si:80/announce".into(),
                    "udp://tracker.torrent.eu.org:451/announce".into(),
                    "https://tracker.tamersunion.org:443/announce".into(),
                ],
            },
            browser: BrowserIntegrationSettings {
                ipc_port: 45678,
                auto_install_extensions_on_startup: true,
                intercept_all_downloads: true,
                min_file_size_kb: 256,
                intercepted_extensions: vec![
                    "ZIP", "RAR", "7Z", "TAR", "GZ", "EXE", "MSI", "DMG", "PKG", "DEB", "RPM",
                    "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI", "MOV", "MP3", "FLAC", "WAV",
                    "PDF", "DOCX", "XLSX", "PPTX", "TORRENT",
                ]
                .into_iter()
                .map(String::from)
                .collect(),
                ignored_domains: vec!["localhost".into(), "127.0.0.1".into()],
                capture_streaming_media: true,
                bypass_key: "Alt".into(),
                enabled_browsers,
            },
            proxy: ProxySettings {
                enabled: false,
                proxy_type: "http".into(),
                host: "127.0.0.1".into(),
                port: 8080,
                username: None,
                password: None,
                bypass_local: true,
            },
            queues: vec![
                SchedulerQueueConfig {
                    id: "main-queue".into(),
                    name: "Main Download Queue".into(),
                    max_concurrent: 4,
                    start_time_enabled: false,
                    start_time_hhmm: "00:00".into(),
                    stop_time_enabled: false,
                    stop_time_hhmm: "08:00".into(),
                    days_of_week: vec![0, 1, 2, 3, 4, 5, 6],
                    speed_limit_kbps: None,
                    post_queue_action: "none".into(),
                },
                SchedulerQueueConfig {
                    id: "night-queue".into(),
                    name: "Night Off-Peak Queue".into(),
                    max_concurrent: 8,
                    start_time_enabled: true,
                    start_time_hhmm: "01:00".into(),
                    stop_time_enabled: true,
                    stop_time_hhmm: "07:00".into(),
                    days_of_week: vec![0, 1, 2, 3, 4, 5, 6],
                    speed_limit_kbps: None,
                    post_queue_action: "sleep".into(),
                },
            ],
        }
    }
}

pub fn resolve_path(p: &str) -> PathBuf {
    if let Some(stripped) = p.strip_prefix("~/") {
        if let Some(base) = directories::BaseDirs::new() {
            return base.home_dir().join(stripped);
        }
    } else if p == "~" {
        if let Some(base) = directories::BaseDirs::new() {
            return base.home_dir().to_path_buf();
        }
    }
    PathBuf::from(p)
}

pub fn dirs_default_download_path() -> String {
    if let Some(user_dirs) = directories::UserDirs::new() {
        if let Some(dl) = user_dirs.download_dir() {
            return dl.join("ByteX").to_string_lossy().to_string();
        }
    }
    if let Some(base_dirs) = directories::BaseDirs::new() {
        return base_dirs
            .home_dir()
            .join("Downloads")
            .join("ByteX")
            .to_string_lossy()
            .to_string();
    }
    "~/Downloads/ByteX".to_string()
}

fn dirs_legacy_default_download_path() -> Option<PathBuf> {
    if let Some(user_dirs) = directories::UserDirs::new() {
        if let Some(downloads) = user_dirs.download_dir() {
            return Some(downloads.join("XDM"));
        }
    }
    directories::BaseDirs::new().map(|base_dirs| base_dirs.home_dir().join("Downloads/XDM"))
}

pub fn migrate_legacy_default_download_path(
    settings: &mut AppSettings,
    legacy: &std::path::Path,
    current: &std::path::Path,
) -> bool {
    let legacy = resolve_path(&legacy.to_string_lossy());
    if resolve_path(&settings.default_download_dir) != legacy {
        return false;
    }

    let old_temp_dir = legacy.join(".xdm_temp");
    let current = resolve_path(&current.to_string_lossy());
    let old_temp = resolve_path(&settings.temp_segment_dir);
    settings.default_download_dir = current.to_string_lossy().to_string();
    if old_temp == old_temp_dir {
        settings.temp_segment_dir = current.join(".bytex_temp").to_string_lossy().to_string();
    }
    true
}

pub fn ensure_directories_exist(settings: &AppSettings) {
    let dl_dir = resolve_path(&settings.default_download_dir);
    if let Err(e) = fs::create_dir_all(&dl_dir) {
        tracing::warn!(
            "Failed to create default download directory {}: {}",
            dl_dir.display(),
            e
        );
    }

    let temp_dir = resolve_path(&settings.temp_segment_dir);
    if let Err(e) = fs::create_dir_all(&temp_dir) {
        tracing::warn!(
            "Failed to create temp directory {}: {}",
            temp_dir.display(),
            e
        );
    }

    for cat in &settings.categories {
        let cat_dir = dl_dir.join(&cat.default_subfolder);
        let _ = fs::create_dir_all(&cat_dir);
    }
}

/// Moves legacy XDM app data into the ByteX directory without overwriting any
/// files already present at the new location.
pub fn migrate_legacy_data_dir(legacy: &std::path::Path, current: &std::path::Path) {
    if legacy == current || !legacy.exists() {
        return;
    }
    if !current.exists() && fs::rename(legacy, current).is_ok() {
        return;
    }
    if fs::create_dir_all(current).is_err() {
        return;
    }

    let Ok(entries) = fs::read_dir(legacy) else {
        return;
    };
    for entry in entries.flatten() {
        let source = entry.path();
        let destination = current.join(entry.file_name());
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            migrate_legacy_data_dir(&source, &destination);
        } else if source
            .file_name()
            .is_some_and(|name| name == "downloads.json")
            && destination.exists()
        {
            merge_download_histories(&source, &destination);
        } else if !destination.exists() {
            let _ = fs::rename(&source, &destination);
        }
    }
    if fs::read_dir(legacy).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = fs::remove_dir(legacy);
    }
}

/// Combines valid history snapshots when both the old and new data directories
/// contain one. Invalid or unsupported snapshots are left in place for recovery.
fn merge_download_histories(legacy: &std::path::Path, current: &std::path::Path) {
    let (Ok(legacy_raw), Ok(current_raw)) =
        (fs::read_to_string(legacy), fs::read_to_string(current))
    else {
        return;
    };
    let (Ok(mut legacy_history), Ok(current_history)) = (
        serde_json::from_str::<serde_json::Value>(&legacy_raw),
        serde_json::from_str::<serde_json::Value>(&current_raw),
    ) else {
        return;
    };
    if legacy_history
        .get("format_version")
        .and_then(|v| v.as_u64())
        != Some(1)
        || current_history
            .get("format_version")
            .and_then(|v| v.as_u64())
            != Some(1)
    {
        return;
    }
    let (Some(legacy_downloads), Some(current_downloads)) = (
        legacy_history
            .get_mut("downloads")
            .and_then(serde_json::Value::as_array_mut),
        current_history
            .get("downloads")
            .and_then(serde_json::Value::as_array),
    ) else {
        return;
    };
    let mut known_ids = current_downloads
        .iter()
        .filter_map(|download| {
            download
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .collect::<std::collections::HashSet<_>>();
    let legacy_downloads = legacy_downloads.clone();
    let mut merged_downloads = current_downloads.clone();
    for download in legacy_downloads {
        let Some(id) = download
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        if known_ids.insert(id) {
            merged_downloads.push(download);
        }
    }
    if let Some(downloads) = legacy_history
        .get_mut("downloads")
        .and_then(serde_json::Value::as_array_mut)
    {
        *downloads = merged_downloads;
    }
    if let Ok(merged) = serde_json::to_vec(&legacy_history) {
        let temporary = current.with_extension("json.migration-tmp");
        if fs::write(&temporary, merged).is_ok() && fs::rename(&temporary, current).is_ok() {
            let _ = fs::remove_file(legacy);
        } else {
            let _ = fs::remove_file(temporary);
        }
    }
}

pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_path =
            if let Some(proj) = ProjectDirs::from("com", "peivee", "ByteXDownloadManager") {
                if let Some(legacy) = ProjectDirs::from("com", "peivee", "XDownloadManager") {
                    migrate_legacy_data_dir(legacy.config_dir(), proj.config_dir());
                }
                let dir = proj.config_dir().to_path_buf();
                let _ = fs::create_dir_all(&dir);
                dir.join("settings.json")
            } else {
                PathBuf::from("xdm_settings.json")
            };
        Self { config_path }
    }

    /// Persistent download history lives beside settings so an app upgrade can
    /// replace binaries without touching the user's transfers or resume state.
    pub fn download_history_path(&self) -> PathBuf {
        self.config_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("downloads.json")
    }

    pub fn database_path(&self) -> PathBuf {
        self.config_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("bytex.db")
    }

    pub fn torrent_state_dir(&self) -> PathBuf {
        self.config_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("torrent-state")
    }

    pub fn load(&self) -> AppSettings {
        let mut settings = if let Ok(raw) = fs::read_to_string(&self.config_path) {
            if let Ok(parsed) = serde_json::from_str::<AppSettings>(&raw) {
                parsed
            } else {
                let default = AppSettings::default();
                let _ = self.save(&default);
                default
            }
        } else {
            let default = AppSettings::default();
            let _ = self.save(&default);
            default
        };

        if settings.custom_user_agent == LEGACY_DEFAULT_USER_AGENT {
            settings.custom_user_agent = DEFAULT_USER_AGENT.to_string();
            let _ = self.save(&settings);
        }

        let legacy_default = dirs_legacy_default_download_path();
        let current_default = PathBuf::from(dirs_default_download_path());
        let migrated_legacy_default = legacy_default.as_ref().is_some_and(|legacy| {
            migrate_legacy_default_download_path(&mut settings, legacy, &current_default)
        });

        // Migrate old installations that stored Downloads directly, while
        // leaving any explicitly selected custom download path untouched.
        if migrated_legacy_default {
            let _ = self.save(&settings);
        } else {
            let resolved = resolve_path(&settings.default_download_dir);
            let path_str = resolved.to_string_lossy();
            if path_str.ends_with("/Downloads") || path_str.ends_with("\\Downloads") {
                settings.default_download_dir =
                    resolved.join("ByteX").to_string_lossy().to_string();
                settings.temp_segment_dir =
                    format!("{}/.bytex_temp", settings.default_download_dir);
                let _ = self.save(&settings);
            } else if settings.default_download_dir.starts_with("~/") {
                settings.default_download_dir = resolved.to_string_lossy().to_string();
                let temp_dir_name = if settings.default_download_dir.ends_with("/XDM")
                    || settings.default_download_dir.ends_with("\\XDM")
                {
                    ".xdm_temp"
                } else {
                    ".bytex_temp"
                };
                settings.temp_segment_dir =
                    format!("{}/{}", settings.default_download_dir, temp_dir_name);
                let _ = self.save(&settings);
            }
        }

        // Guarantee that the download folder and all subfolders exist immediately
        ensure_directories_exist(&settings);

        settings
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, json).map_err(|e| e.to_string())
    }
}

impl Default for ConfigManager {
    fn default() -> Self {
        Self::new()
    }
}
