use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteCredential {
    pub id: String,
    pub host_pattern: String,
    pub site_type: String, // "usersdrive" | "1fichier" | "mediafire" | "ftp" | "sftp" | "http_basic" | "bearer" | "cookie"
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

    // Connections & Multi-Threading (IDM style)
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
        let temp_dl = format!("{}/.xdm_temp", base_dl);

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
            custom_user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 XDM/1.0".to_string(),

            speed_limiter_enabled: false,
            global_max_download_kbps: 10240, // 10 MB/s when enabled
            global_max_upload_kbps: 2048,

            categories: vec![
                CategoryRule {
                    id: "compressed".into(),
                    name: "Compressed".into(),
                    icon: "Archive".into(),
                    extensions: vec!["zip".into(), "rar".into(), "7z".into(), "tar".into(), "gz".into(), "bz2".into(), "xz".into(), "zst".into()],
                    default_subfolder: "Compressed".into(),
                },
                CategoryRule {
                    id: "programs".into(),
                    name: "Programs".into(),
                    icon: "Cpu".into(),
                    extensions: vec!["exe".into(), "msi".into(), "dmg".into(), "pkg".into(), "deb".into(), "rpm".into(), "appimage".into(), "iso".into(), "apk".into()],
                    default_subfolder: "Programs".into(),
                },
                CategoryRule {
                    id: "video".into(),
                    name: "Video".into(),
                    icon: "Film".into(),
                    extensions: vec!["mp4".into(), "mkv".into(), "webm".into(), "avi".into(), "mov".into(), "flv".into(), "m4v".into(), "ts".into()],
                    default_subfolder: "Video".into(),
                },
                CategoryRule {
                    id: "music".into(),
                    name: "Music".into(),
                    icon: "Music".into(),
                    extensions: vec!["mp3".into(), "flac".into(), "wav".into(), "aac".into(), "ogg".into(), "m4a".into(), "opus".into()],
                    default_subfolder: "Music".into(),
                },
                CategoryRule {
                    id: "documents".into(),
                    name: "Documents".into(),
                    icon: "FileText".into(),
                    extensions: vec!["pdf".into(), "epub".into(), "docx".into(), "xlsx".into(), "pptx".into(), "txt".into(), "md".into(), "csv".into()],
                    default_subfolder: "Documents".into(),
                },
            ],
            site_credentials: vec![
                SiteCredential {
                    id: "cred-usersdrive-default".into(),
                    host_pattern: "*.usersdrive.com".into(),
                    site_type: "usersdrive".into(),
                    username: "premium_user".into(),
                    password_or_token: "".into(),
                    cookies: Some("xfss=session_token_from_browser".into()),
                    custom_headers: HashMap::new(),
                    enabled: true,
                },
                SiteCredential {
                    id: "cred-ftp-mirror".into(),
                    host_pattern: "ftp.ubuntu.com".into(),
                    site_type: "ftp".into(),
                    username: "anonymous".into(),
                    password_or_token: "anonymous@xdm.local".into(),
                    cookies: None,
                    custom_headers: HashMap::new(),
                    enabled: true,
                },
            ],
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
                    "ZIP", "RAR", "7Z", "TAR", "GZ", "EXE", "MSI", "DMG", "PKG",
                    "DEB", "RPM", "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI",
                    "MOV", "MP3", "FLAC", "WAV", "PDF", "DOCX", "XLSX", "PPTX", "TORRENT"
                ].into_iter().map(String::from).collect(),
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
            return dl.join("XDM").to_string_lossy().to_string();
        }
    }
    if let Some(base_dirs) = directories::BaseDirs::new() {
        return base_dirs
            .home_dir()
            .join("Downloads")
            .join("XDM")
            .to_string_lossy()
            .to_string();
    }
    "~/Downloads/XDM".to_string()
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

pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_path = if let Some(proj) = ProjectDirs::from("com", "peivee", "XDownloadManager")
        {
            let dir = proj.config_dir().to_path_buf();
            let _ = fs::create_dir_all(&dir);
            dir.join("settings.json")
        } else {
            PathBuf::from("xdm_settings.json")
        };
        Self { config_path }
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

        // If settings had a default_download_dir ending with pure "Downloads"
        // (like on initial runs where dirs_default_download_path returned ~/Downloads without /XDM),
        // or literal "~/Downloads/XDM", migrate to canonical ~/Downloads/XDM path.
        let resolved = resolve_path(&settings.default_download_dir);
        let path_str = resolved.to_string_lossy();
        if path_str.ends_with("/Downloads") || path_str.ends_with("\\Downloads") {
            settings.default_download_dir = resolved.join("XDM").to_string_lossy().to_string();
            settings.temp_segment_dir = format!("{}/.xdm_temp", settings.default_download_dir);
            let _ = self.save(&settings);
        } else if settings.default_download_dir.starts_with("~/") {
            settings.default_download_dir = resolved.to_string_lossy().to_string();
            settings.temp_segment_dir = format!("{}/.xdm_temp", settings.default_download_dir);
            let _ = self.save(&settings);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_tilde_path() {
        let p = resolve_path("~/Downloads/XDM");
        assert!(!p.to_string_lossy().starts_with('~'));
        assert!(p.to_string_lossy().contains("Downloads"));
        assert!(p.to_string_lossy().ends_with("XDM"));
    }

    #[test]
    fn test_dirs_default_download_path_has_xdm() {
        let p = dirs_default_download_path();
        assert!(p.ends_with("XDM"));
    }

    #[test]
    fn test_ensure_directories_exist() {
        let temp_dir = std::env::temp_dir().join("xdm_test_config");
        let mut settings = AppSettings::default();
        settings.default_download_dir = temp_dir.to_string_lossy().to_string();
        settings.temp_segment_dir = temp_dir.join(".xdm_temp").to_string_lossy().to_string();

        ensure_directories_exist(&settings);
        assert!(temp_dir.exists());
        assert!(temp_dir.join(".xdm_temp").exists());
        for cat in &settings.categories {
            assert!(temp_dir.join(&cat.default_subfolder).exists());
        }
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
