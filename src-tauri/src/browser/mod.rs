//! Cross-Platform Browser Detection, Native Messaging Host Registration & Auto-Extension Installer
//! Supports the major Chromium family (Chrome, Brave, Edge, Arc, Dia, Opera, Opera GX, Vivaldi,
//! Chromium, Thorium, Ungoogled Chromium, Whale, Yandex),
//! Mozilla Firefox family (Firefox, Zen Browser, LibreWolf, Waterfox, Floorp, Tor, Mullvad),
//! and Safari/WebKit family (Apple Safari, Orion Browser) across macOS, Windows, and Linux.

pub mod ipc_server;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::AppSettings;

pub const CHROMIUM_EXTENSION_ID: &str = "knldjmfmopnpolahpmmgbagdohdnhkik";
pub const CHROMIUM_UNPACKED_ID: &str = "degffimdimlipahdfmgibgkliiihcbbj";
pub const FIREFOX_EXTENSION_ID: &str = "xdm-extension@peivee.com";
pub const SAFARI_EXTENSION_BUNDLE_ID: &str = "com.peivee.xdm.SafariExtension";
pub const NATIVE_HOST_NAME: &str = "com.peivee.xdm";

pub const SUPPORTED_BROWSERS: &[(&str, &str, &str)] = &[
    ("chrome", "Google Chrome", "chromium"),
    ("brave", "Brave Browser", "chromium"),
    ("edge", "Microsoft Edge", "chromium"),
    ("arc", "Arc Browser", "chromium"),
    ("dia", "Dia Browser", "chromium"),
    ("opera", "Opera", "chromium"),
    ("operagx", "Opera GX", "chromium"),
    ("vivaldi", "Vivaldi", "chromium"),
    ("chromium", "Chromium", "chromium"),
    ("thorium", "Thorium Browser", "chromium"),
    ("ungoogled", "Ungoogled Chromium", "chromium"),
    ("whale", "NAVER Whale", "chromium"),
    ("helium", "Helium Browser", "chromium"),
    ("yandex", "Yandex Browser", "chromium"),
    ("firefox", "Mozilla Firefox", "firefox"),
    ("zen", "Zen Browser", "firefox"),
    ("librewolf", "LibreWolf", "firefox"),
    ("waterfox", "Waterfox", "firefox"),
    ("floorp", "Floorp", "firefox"),
    ("tor", "Tor Browser", "firefox"),
    ("mullvad", "Mullvad Browser", "firefox"),
    ("safari", "Apple Safari", "safari"),
    ("orion", "Orion Browser", "safari"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserStatus {
    pub id: String,
    pub display_name: String,
    pub family: String, // "chromium" | "firefox" | "safari"
    pub detected_installed: bool,
    pub executable_path: Option<String>,
    pub extension_enabled: bool,
    pub native_host_registered: bool,
    pub is_connected: bool,
    pub manifest_path: String,
    pub extension_bundle_path: String,
    pub status_message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChromiumNativeHostManifest {
    name: String,
    description: String,
    path: String,
    #[serde(rename = "type")]
    host_type: String,
    allowed_origins: Vec<String>,
}

fn chromium_manifest_extension_id() -> Option<String> {
    use base64::Engine as _;
    use sha2::Digest as _;

    let manifest: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../../extensions/chromium/manifest.json"))
            .ok()?;
    let encoded_key = manifest.get("key")?.as_str()?;
    let public_key = base64::engine::general_purpose::STANDARD
        .decode(encoded_key)
        .ok()?;
    let digest = sha2::Sha256::digest(public_key);
    let mut extension_id = String::with_capacity(32);
    for byte in &digest[..16] {
        extension_id.push(char::from(b'a' + (*byte >> 4)));
        extension_id.push(char::from(b'a' + (*byte & 0x0f)));
    }
    Some(extension_id)
}

fn chromium_native_host_allowed_origins() -> Vec<String> {
    let mut origins = vec![
        format!("chrome-extension://{}/", CHROMIUM_EXTENSION_ID),
        format!("chrome-extension://{}/", CHROMIUM_UNPACKED_ID),
    ];
    if let Some(extension_id) = chromium_manifest_extension_id() {
        let origin = format!("chrome-extension://{extension_id}/");
        if !origins.contains(&origin) {
            origins.push(origin);
        }
    }
    origins
}

#[derive(Debug, Serialize, Deserialize)]
struct FirefoxNativeHostManifest {
    name: String,
    description: String,
    path: String,
    #[serde(rename = "type")]
    host_type: String,
    allowed_extensions: Vec<String>,
}

/// Detects all supported browsers on the current operating system (macOS, Windows, Linux)
pub fn detect_browsers(settings: &AppSettings) -> Vec<BrowserStatus> {
    let detected_chromium_count = SUPPORTED_BROWSERS
        .iter()
        .filter(|(id, _, family)| *family == "chromium" && probe_browser_executable(id).is_some())
        .count();
    let chromium_engine_connected = SUPPORTED_BROWSERS
        .iter()
        .filter(|(_, _, family)| *family == "chromium")
        .any(|(id, name, _)| crate::browser::ipc_server::is_browser_connected(id, name));
    SUPPORTED_BROWSERS
        .iter()
        .map(|(id, name, family)| {
            let exe = probe_browser_executable(id);
            let manifest_dir = get_native_messaging_dir(id);
            let manifest_file = manifest_dir.join(format!("{}.json", NATIVE_HOST_NAME));
            let native_registered = manifest_file.exists();
            let enabled = *settings.browser.enabled_browsers.get(*id).unwrap_or(&true);
            let ext_bundle = match *family {
                "chromium" => "extensions/chromium (Manifest V3)".to_string(),
                "firefox" => "extensions/firefox (WebExtension XPI)".to_string(),
                "safari" => "extensions/safari (Safari Web Extension)".to_string(),
                _ => String::new(),
            };

            let detected = exe.is_some() || (*id == "safari" && cfg!(target_os = "macos"));
            let is_connected = detected
                && (crate::browser::ipc_server::is_browser_connected(id, name)
                    || (*family == "chromium"
                        && detected_chromium_count == 1
                        && chromium_engine_connected));
            let status_message = if !detected {
                "Browser not detected on this system".to_string()
            } else if is_connected {
                "Connected & Intercepting Downloads".to_string()
            } else if enabled && native_registered {
                if *id == "safari" {
                    "Host Registered — Enable in Safari Settings > Extensions".to_string()
                } else {
                    "Host Registered — Extension not yet active in browser".to_string()
                }
            } else if enabled {
                "Ready — Click Install/Repair to register Native Host".to_string()
            } else {
                "Integration Disabled by User".to_string()
            };

            BrowserStatus {
                id: id.to_string(),
                display_name: name.to_string(),
                family: family.to_string(),
                detected_installed: detected,
                executable_path: exe,
                extension_enabled: enabled,
                native_host_registered: native_registered,
                is_connected,
                manifest_path: manifest_file.to_string_lossy().to_string(),
                extension_bundle_path: ext_bundle,
                status_message,
            }
        })
        .collect()
}

fn probe_browser_executable(browser_id: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let home = directories::BaseDirs::new()
            .map(|b| b.home_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let candidates: Vec<PathBuf> = match browser_id {
            "chrome" => vec![
                PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            ],
            "brave" => vec![
                PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
                home.join("Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            ],
            "edge" => vec![
                PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                home.join("Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            ],
            "arc" => vec![
                PathBuf::from("/Applications/Arc.app/Contents/MacOS/Arc"),
                home.join("Applications/Arc.app/Contents/MacOS/Arc"),
            ],
            "dia" => vec![
                PathBuf::from("/Applications/Dia.app/Contents/MacOS/Dia"),
                PathBuf::from("/Applications/Dia.app"),
                home.join("Applications/Dia.app/Contents/MacOS/Dia"),
                home.join("Applications/Dia.app"),
            ],
            "opera" => vec![
                PathBuf::from("/Applications/Opera.app/Contents/MacOS/Opera"),
                PathBuf::from("/Applications/Opera.app"),
                home.join("Applications/Opera.app/Contents/MacOS/Opera"),
                home.join("Applications/Opera.app"),
            ],
            "operagx" => vec![
                PathBuf::from("/Applications/Opera GX.app/Contents/MacOS/Opera GX"),
                PathBuf::from("/Applications/Opera GX.app"),
                home.join("Applications/Opera GX.app/Contents/MacOS/Opera GX"),
                home.join("Applications/Opera GX.app"),
            ],
            "vivaldi" => vec![
                PathBuf::from("/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"),
                PathBuf::from("/Applications/Vivaldi.app"),
                home.join("Applications/Vivaldi.app/Contents/MacOS/Vivaldi"),
                home.join("Applications/Vivaldi.app"),
            ],
            "chromium" => vec![
                PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
                PathBuf::from("/Applications/Chromium.app"),
                home.join("Applications/Chromium.app/Contents/MacOS/Chromium"),
            ],
            "thorium" => vec![
                PathBuf::from("/Applications/Thorium.app/Contents/MacOS/Thorium"),
                home.join("Applications/Thorium.app/Contents/MacOS/Thorium"),
            ],
            "ungoogled" => vec![PathBuf::from(
                "/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium",
            )],
            "whale" => vec![
                PathBuf::from("/Applications/Whale.app/Contents/MacOS/Whale"),
                PathBuf::from("/Applications/Naver Whale.app/Contents/MacOS/Whale"),
            ],
            "helium" => vec![
                PathBuf::from("/Applications/Helium.app/Contents/MacOS/Helium"),
                home.join("Applications/Helium.app/Contents/MacOS/Helium"),
            ],
            "yandex" => vec![
                PathBuf::from("/Applications/Yandex.app/Contents/MacOS/Yandex"),
                PathBuf::from("/Applications/Yandex.app"),
                home.join("Applications/Yandex.app/Contents/MacOS/Yandex"),
            ],
            "firefox" => vec![
                PathBuf::from("/Applications/Firefox.app/Contents/MacOS/firefox"),
                PathBuf::from("/Applications/Firefox.app"),
                home.join("Applications/Firefox.app/Contents/MacOS/firefox"),
            ],
            "zen" => vec![
                PathBuf::from("/Applications/Zen Browser.app/Contents/MacOS/zen"),
                PathBuf::from("/Applications/Zen.app/Contents/MacOS/zen"),
                PathBuf::from("/Applications/Zen Browser.app"),
                PathBuf::from("/Applications/Zen.app"),
                home.join("Applications/Zen Browser.app/Contents/MacOS/zen"),
                home.join("Applications/Zen.app/Contents/MacOS/zen"),
            ],
            "librewolf" => vec![
                PathBuf::from("/Applications/LibreWolf.app/Contents/MacOS/librewolf"),
                PathBuf::from("/Applications/LibreWolf.app"),
                home.join("Applications/LibreWolf.app/Contents/MacOS/librewolf"),
            ],
            "waterfox" => vec![
                PathBuf::from("/Applications/Waterfox.app/Contents/MacOS/waterfox"),
                PathBuf::from("/Applications/Waterfox.app"),
                home.join("Applications/Waterfox.app/Contents/MacOS/waterfox"),
            ],
            "floorp" => vec![
                PathBuf::from("/Applications/Floorp.app/Contents/MacOS/floorp"),
                PathBuf::from("/Applications/Floorp.app"),
                home.join("Applications/Floorp.app/Contents/MacOS/floorp"),
            ],
            "tor" => vec![
                PathBuf::from("/Applications/Tor Browser.app/Contents/MacOS/firefox"),
                PathBuf::from("/Applications/Tor Browser.app"),
            ],
            "mullvad" => vec![
                PathBuf::from("/Applications/Mullvad Browser.app/Contents/MacOS/mullvad-browser"),
                PathBuf::from("/Applications/Mullvad Browser.app"),
            ],
            "safari" => vec![
                PathBuf::from("/Applications/Safari.app/Contents/MacOS/Safari"),
                PathBuf::from("/Applications/Safari.app"),
                PathBuf::from("/System/Applications/Safari.app/Contents/MacOS/Safari"),
                PathBuf::from("/System/Applications/Safari.app"),
            ],
            "orion" => vec![
                PathBuf::from("/Applications/Orion.app/Contents/MacOS/Orion"),
                PathBuf::from("/Applications/Orion.app"),
                home.join("Applications/Orion.app/Contents/MacOS/Orion"),
            ],
            _ => vec![],
        };

        for path in candidates {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let prog_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let prog_files_x86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());

        let candidates: Vec<PathBuf> = match browser_id {
            "chrome" => vec![
                PathBuf::from(&prog_files).join(r"Google\Chrome\Application\chrome.exe"),
                PathBuf::from(&prog_files_x86).join(r"Google\Chrome\Application\chrome.exe"),
                PathBuf::from(&local_app_data).join(r"Google\Chrome\Application\chrome.exe"),
            ],
            "brave" => vec![
                PathBuf::from(&prog_files)
                    .join(r"BraveSoftware\Brave-Browser\Application\brave.exe"),
                PathBuf::from(&local_app_data)
                    .join(r"BraveSoftware\Brave-Browser\Application\brave.exe"),
            ],
            "edge" => vec![
                PathBuf::from(&prog_files_x86).join(r"Microsoft\Edge\Application\msedge.exe"),
                PathBuf::from(&prog_files).join(r"Microsoft\Edge\Application\msedge.exe"),
            ],
            "arc" => vec![
                PathBuf::from(&local_app_data).join(r"TheBrowserCompany\Arc\Arc.exe"),
                PathBuf::from(&local_app_data).join(r"Arc\Arc.exe"),
                PathBuf::from(&prog_files).join(r"Arc\Arc.exe"),
            ],
            "dia" => vec![
                PathBuf::from(&local_app_data).join(r"Dia\Application\Dia.exe"),
                PathBuf::from(&local_app_data).join(r"Dia\User Data\Dia.exe"),
            ],
            "opera" => vec![
                PathBuf::from(&prog_files).join(r"Opera\launcher.exe"),
                PathBuf::from(&local_app_data).join(r"Programs\Opera\launcher.exe"),
            ],
            "operagx" => vec![
                PathBuf::from(&prog_files).join(r"Opera GX\launcher.exe"),
                PathBuf::from(&local_app_data).join(r"Programs\Opera GX\launcher.exe"),
            ],
            "vivaldi" => vec![
                PathBuf::from(&prog_files).join(r"Vivaldi\Application\vivaldi.exe"),
                PathBuf::from(&local_app_data).join(r"Vivaldi\Application\vivaldi.exe"),
            ],
            "chromium" => {
                vec![PathBuf::from(&local_app_data).join(r"Chromium\Application\chrome.exe")]
            }
            "thorium" => vec![
                PathBuf::from(&local_app_data).join(r"Thorium\Application\thorium.exe"),
                PathBuf::from(&prog_files).join(r"Thorium\thorium.exe"),
            ],
            "ungoogled" => vec![PathBuf::from(&prog_files).join(r"Ungoogled Chromium\chrome.exe")],
            "whale" => vec![
                PathBuf::from(&local_app_data).join(r"Naver\Naver Whale\Application\whale.exe"),
                PathBuf::from(&prog_files).join(r"Naver\Naver Whale\Application\whale.exe"),
            ],
            "helium" => vec![
                PathBuf::from(&local_app_data).join(r"Programs\Helium\helium.exe"),
                PathBuf::from(&prog_files).join(r"Helium\helium.exe"),
            ],
            "yandex" => vec![PathBuf::from(&local_app_data)
                .join(r"Yandex\YandexBrowser\Application\browser.exe")],
            "firefox" => vec![
                PathBuf::from(&prog_files).join(r"Mozilla Firefox\firefox.exe"),
                PathBuf::from(&prog_files_x86).join(r"Mozilla Firefox\firefox.exe"),
            ],
            "zen" => vec![
                PathBuf::from(&prog_files).join(r"Zen Browser\zen.exe"),
                PathBuf::from(&local_app_data).join(r"Zen Browser\zen.exe"),
                PathBuf::from(&local_app_data).join(r"Programs\zen\zen.exe"),
            ],
            "librewolf" => vec![
                PathBuf::from(&prog_files).join(r"LibreWolf\librewolf.exe"),
                PathBuf::from(&local_app_data).join(r"LibreWolf\librewolf.exe"),
            ],
            "waterfox" => vec![PathBuf::from(&prog_files).join(r"Waterfox\waterfox.exe")],
            "floorp" => vec![PathBuf::from(&prog_files).join(r"Floorp\floorp.exe")],
            "tor" => vec![
                PathBuf::from(&prog_files).join(r"Tor Browser\Browser\firefox.exe"),
                PathBuf::from(&local_app_data).join(r"Tor Browser\Browser\firefox.exe"),
            ],
            "mullvad" => vec![
                PathBuf::from(&prog_files).join(r"Mullvad Browser\browser\firefox.exe"),
                PathBuf::from(&local_app_data).join(r"Mullvad Browser\browser\firefox.exe"),
            ],
            _ => vec![],
        };

        for path in candidates {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        let candidates: Vec<&str> = match browser_id {
            "chrome" => vec!["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
            "brave" => vec!["/usr/bin/brave-browser", "/usr/bin/brave"],
            "edge" => vec!["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
            "arc" => vec!["/usr/bin/arc", "/usr/bin/arc-browser"],
            "dia" => vec!["/usr/bin/dia-browser", "/usr/bin/dia"],
            "opera" => vec!["/usr/bin/opera"],
            "operagx" => vec!["/usr/bin/opera-gx"],
            "vivaldi" => vec!["/usr/bin/vivaldi", "/usr/bin/vivaldi-stable"],
            "chromium" => vec!["/usr/bin/chromium", "/usr/bin/chromium-browser"],
            "thorium" => vec!["/usr/bin/thorium-browser", "/usr/bin/thorium"],
            "ungoogled" => vec!["/usr/bin/ungoogled-chromium", "/usr/bin/chromium-ungoogled"],
            "whale" => vec!["/usr/bin/whale", "/usr/bin/naver-whale"],
            "helium" => vec!["/usr/bin/helium", "/opt/helium/helium"],
            "yandex" => vec!["/usr/bin/yandex-browser", "/usr/bin/yandex-browser-stable"],
            "firefox" => vec![
                "/usr/bin/firefox",
                "/snap/bin/firefox",
                "/var/lib/flatpak/exports/bin/org.mozilla.firefox",
            ],
            "zen" => vec![
                "/usr/bin/zen-browser",
                "/usr/bin/zen",
                "/var/lib/flatpak/exports/bin/app.zen_browser.zen",
            ],
            "librewolf" => vec![
                "/usr/bin/librewolf",
                "/var/lib/flatpak/exports/bin/io.gitlab.librewolf-community",
            ],
            "waterfox" => vec!["/usr/bin/waterfox"],
            "floorp" => vec!["/usr/bin/floorp"],
            "tor" => vec![
                "/usr/bin/torbrowser-launcher",
                "/usr/bin/tor-browser",
                "/var/lib/flatpak/exports/bin/org.torproject.torbrowser-launcher",
            ],
            "mullvad" => vec![
                "/usr/bin/mullvad-browser",
                "/opt/mullvad-browser/Browser/mullvad-browser",
            ],
            _ => vec![],
        };

        for path in candidates {
            if PathBuf::from(path).exists() {
                return Some(path.to_string());
            }
        }
        None
    }
}

/// Returns the primary NativeMessagingHosts directory for a given browser
pub fn get_native_messaging_dir(browser_id: &str) -> PathBuf {
    get_all_native_messaging_dirs(browser_id)
        .into_iter()
        .next()
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Returns all OS-appropriate NativeMessagingHosts directories for a given browser
pub fn get_all_native_messaging_dirs(browser_id: &str) -> Vec<PathBuf> {
    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        let app_support = home.join("Library/Application Support");
        let legacy_bytex_support = app_support.join("XDownloadManager");
        let bytex_support = app_support.join("ByteXDownloadManager");
        crate::config::migrate_legacy_data_dir(&legacy_bytex_support, &bytex_support);
        match browser_id {
            "chrome" => vec![app_support.join("Google/Chrome/NativeMessagingHosts")],
            "brave" => vec![app_support.join("BraveSoftware/Brave-Browser/NativeMessagingHosts")],
            "edge" => vec![app_support.join("Microsoft Edge/NativeMessagingHosts")],
            "arc" => vec![
                app_support.join("Arc/User Data/NativeMessagingHosts"),
                app_support.join("Arc/NativeMessagingHosts"),
                app_support.join("Google/Chrome/NativeMessagingHosts"),
            ],
            "dia" => vec![
                app_support.join("Dia/NativeMessagingHosts"),
                app_support.join("Dia/User Data/NativeMessagingHosts"),
                app_support.join("Google/Chrome/NativeMessagingHosts"),
                app_support.join("Chromium/NativeMessagingHosts"),
            ],
            "opera" => vec![
                app_support.join("com.operasoftware.Opera/NativeMessagingHosts"),
                app_support.join("Opera/NativeMessagingHosts"),
            ],
            "operagx" => vec![
                app_support.join("com.operasoftware.OperaGX/NativeMessagingHosts"),
                app_support.join("Opera GX/NativeMessagingHosts"),
            ],
            "vivaldi" => vec![app_support.join("Vivaldi/NativeMessagingHosts")],
            "chromium" => vec![app_support.join("Chromium/NativeMessagingHosts")],
            "thorium" => vec![app_support.join("Thorium/NativeMessagingHosts")],
            "ungoogled" => vec![app_support.join("Chromium/NativeMessagingHosts")],
            "whale" => vec![app_support.join("Naver/Whale/NativeMessagingHosts")],
            "helium" => vec![app_support.join("Helium/NativeMessagingHosts")],
            "yandex" => vec![app_support.join("Yandex/YandexBrowser/NativeMessagingHosts")],
            "firefox" => vec![app_support.join("Mozilla/NativeMessagingHosts")],
            "zen" => vec![
                app_support.join("zen/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "librewolf" => vec![
                app_support.join("LibreWolf/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "waterfox" => vec![
                app_support.join("Waterfox/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "floorp" => vec![
                app_support.join("Floorp/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "tor" => vec![
                app_support.join("TorBrowser/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "mullvad" => vec![
                app_support.join("Mullvad Browser/NativeMessagingHosts"),
                app_support.join("Mozilla/NativeMessagingHosts"),
            ],
            "safari" => vec![bytex_support.join("SafariExtension")],
            "orion" => vec![
                app_support.join("Orion/NativeMessagingHosts"),
                app_support.join("Orion/User Data/NativeMessagingHosts"),
            ],
            _ => vec![bytex_support.join("NativeMessagingHosts")],
        }
    }

    #[cfg(target_os = "linux")]
    {
        let config = home.join(".config");
        match browser_id {
            "chrome" => vec![config.join("google-chrome/NativeMessagingHosts")],
            "brave" => vec![config.join("BraveSoftware/Brave-Browser/NativeMessagingHosts")],
            "edge" => vec![config.join("microsoft-edge/NativeMessagingHosts")],
            "arc" => vec![config.join("arc/NativeMessagingHosts")],
            "dia" => vec![config.join("dia/NativeMessagingHosts")],
            "opera" => vec![config.join("opera/NativeMessagingHosts")],
            "operagx" => vec![config.join("opera-gx/NativeMessagingHosts")],
            "vivaldi" => vec![config.join("vivaldi/NativeMessagingHosts")],
            "chromium" => vec![config.join("chromium/NativeMessagingHosts")],
            "thorium" => vec![config.join("thorium/NativeMessagingHosts")],
            "ungoogled" => vec![
                config.join("ungoogled-chromium/NativeMessagingHosts"),
                config.join("chromium/NativeMessagingHosts"),
            ],
            "whale" => vec![
                config.join("naver-whale/NativeMessagingHosts"),
                config.join("whale/NativeMessagingHosts"),
            ],
            "helium" => vec![config.join("helium/NativeMessagingHosts")],
            "yandex" => vec![config.join("yandex-browser/NativeMessagingHosts")],
            "firefox" => vec![home.join(".mozilla/native-messaging-hosts")],
            "zen" => vec![
                home.join(".zen/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            "librewolf" => vec![
                home.join(".librewolf/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            "waterfox" => vec![
                home.join(".waterfox/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            "floorp" => vec![
                home.join(".floorp/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            "tor" => vec![
                home.join(".tor-browser/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            "mullvad" => vec![
                home.join(".mullvad-browser/native-messaging-hosts"),
                home.join(".mozilla/native-messaging-hosts"),
            ],
            _ => {
                let legacy = config.join("xdm");
                let current = config.join("bytex");
                crate::config::migrate_legacy_data_dir(&legacy, &current);
                vec![current.join("NativeMessagingHosts")]
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let app_local = home.join("AppData/Local");
        let legacy = app_local.join("XDownloadManager");
        let current = app_local.join("ByteXDownloadManager");
        crate::config::migrate_legacy_data_dir(&legacy, &current);
        vec![current.join("NativeMessagingHosts").join(browser_id)]
    }
}

/// Installs or removes the Native Messaging Host manifest & browser extension policy for a browser
pub fn configure_browser_integration(
    browser_id: &str,
    enable: bool,
    settings: &mut AppSettings,
) -> Result<BrowserStatus, String> {
    settings
        .browser
        .enabled_browsers
        .insert(browser_id.to_string(), enable);

    let all_dirs = get_all_native_messaging_dirs(browser_id);
    let primary_dir = get_native_messaging_dir(browser_id);
    let _primary_manifest_file = primary_dir.join(format!("{}.json", NATIVE_HOST_NAME));

    let current_exe = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("/usr/local/bin/bytex-download-manager"))
        .to_string_lossy()
        .to_string();

    let is_firefox_family = matches!(
        browser_id,
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp" | "tor" | "mullvad"
    );

    for dir in &all_dirs {
        let manifest_file = dir.join(format!("{}.json", NATIVE_HOST_NAME));
        if enable {
            let _ = fs::create_dir_all(dir);
            if is_firefox_family {
                let ff_manifest = FirefoxNativeHostManifest {
                    name: NATIVE_HOST_NAME.to_string(),
                    description: "ByteX Download Manager Native Messaging Host".to_string(),
                    path: current_exe.clone(),
                    host_type: "stdio".to_string(),
                    allowed_extensions: vec![FIREFOX_EXTENSION_ID.to_string()],
                };
                if let Ok(json) = serde_json::to_string_pretty(&ff_manifest) {
                    let _ = fs::write(&manifest_file, json);
                }
            } else {
                let cr_manifest = ChromiumNativeHostManifest {
                    name: NATIVE_HOST_NAME.to_string(),
                    description: "ByteX Download Manager Native Messaging Host".to_string(),
                    path: current_exe.clone(),
                    host_type: "stdio".to_string(),
                    allowed_origins: chromium_native_host_allowed_origins(),
                };
                if let Ok(json) = serde_json::to_string_pretty(&cr_manifest) {
                    let _ = fs::write(&manifest_file, json);
                }
            }
        } else if manifest_file.exists() {
            let _ = fs::remove_file(&manifest_file);
        }
    }

    if enable {
        let _ = write_external_extension_descriptor(browser_id, true);
        #[cfg(target_os = "windows")]
        let _ = register_windows_registry_native_host(browser_id, &_primary_manifest_file);
    } else {
        let _ = write_external_extension_descriptor(browser_id, false);
    }

    let statuses = detect_browsers(settings);
    statuses
        .into_iter()
        .find(|b| b.id == browser_id)
        .ok_or_else(|| format!("Unknown browser id: {}", browser_id))
}

/// Auto-installs Native Messaging manifests for all detected & enabled browsers on application startup
pub fn auto_register_all_detected_browsers(settings: &mut AppSettings) -> Vec<BrowserStatus> {
    let current = detect_browsers(settings);
    for b in &current {
        let is_enabled = *settings
            .browser
            .enabled_browsers
            .get(&b.id)
            .unwrap_or(&true);
        if is_enabled {
            let _ = configure_browser_integration(&b.id, true, settings);
        }
    }
    detect_browsers(settings)
}

/// Writes External Extension auto-install descriptors on macOS and Linux
/// so Chrome, Brave, Edge, Arc, Dia, Firefox, Zen, etc. automatically load the bundled extension when installed.
pub fn write_external_extension_descriptor(browser_id: &str, enable: bool) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    let ext_dirs: Vec<PathBuf> = {
        let app_support = home.join("Library/Application Support");
        match browser_id {
            "chrome" => vec![app_support.join("Google/Chrome/External Extensions")],
            "brave" => vec![app_support.join("BraveSoftware/Brave-Browser/External Extensions")],
            "edge" => vec![app_support.join("Microsoft Edge/External Extensions")],
            "arc" => vec![
                app_support.join("Arc/User Data/External Extensions"),
                app_support.join("Arc/External Extensions"),
            ],
            "dia" => vec![
                app_support.join("Dia/External Extensions"),
                app_support.join("Dia/User Data/External Extensions"),
            ],
            "opera" => vec![app_support.join("com.operasoftware.Opera/External Extensions")],
            "operagx" => vec![app_support.join("com.operasoftware.OperaGX/External Extensions")],
            "vivaldi" => vec![app_support.join("Vivaldi/External Extensions")],
            "chromium" => vec![app_support.join("Chromium/External Extensions")],
            "thorium" => vec![app_support.join("Thorium/External Extensions")],
            "ungoogled" => vec![app_support.join("Chromium/External Extensions")],
            "whale" => vec![app_support.join("Naver/Whale/External Extensions")],
            "helium" => vec![app_support.join("Helium/External Extensions")],
            "yandex" => vec![app_support.join("Yandex/YandexBrowser/External Extensions")],
            "firefox" => {
                vec![app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}")]
            }
            "zen" => vec![
                app_support.join("zen/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "librewolf" => vec![
                app_support.join("LibreWolf/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "waterfox" => vec![
                app_support.join("Waterfox/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "floorp" => vec![
                app_support.join("Floorp/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "tor" => vec![
                app_support.join("TorBrowser/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "mullvad" => vec![
                app_support
                    .join("Mullvad Browser/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            _ => vec![],
        }
    };

    #[cfg(target_os = "linux")]
    let ext_dirs: Vec<PathBuf> = {
        let config = home.join(".config");
        match browser_id {
            "chrome" => vec![config.join("google-chrome/External Extensions")],
            "brave" => vec![config.join("BraveSoftware/Brave-Browser/External Extensions")],
            "edge" => vec![config.join("microsoft-edge/External Extensions")],
            "arc" => vec![config.join("arc/External Extensions")],
            "dia" => vec![config.join("dia/External Extensions")],
            "opera" => vec![config.join("opera/External Extensions")],
            "operagx" => vec![config.join("opera-gx/External Extensions")],
            "vivaldi" => vec![config.join("vivaldi/External Extensions")],
            "chromium" => vec![config.join("chromium/External Extensions")],
            "thorium" => vec![config.join("thorium/External Extensions")],
            "ungoogled" => vec![
                config.join("ungoogled-chromium/External Extensions"),
                config.join("chromium/External Extensions"),
            ],
            "whale" => vec![
                config.join("naver-whale/External Extensions"),
                config.join("whale/External Extensions"),
            ],
            "helium" => vec![config.join("helium/External Extensions")],
            "yandex" => vec![config.join("yandex-browser/External Extensions")],
            "firefox" => {
                vec![home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}")]
            }
            "zen" => vec![
                home.join(".zen/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "librewolf" => vec![
                home.join(".librewolf/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "waterfox" => vec![
                home.join(".waterfox/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "floorp" => vec![
                home.join(".floorp/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "tor" => vec![
                home.join(".tor-browser/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            "mullvad" => vec![
                home.join(".mullvad-browser/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
                home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"),
            ],
            _ => vec![],
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let ext_dirs: Vec<PathBuf> = vec![];

    let is_firefox_family = matches!(
        browser_id,
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp" | "tor" | "mullvad"
    );

    for dir in ext_dirs {
        let _ = fs::create_dir_all(&dir);
        if is_firefox_family {
            let xpi_dest = dir.join(format!("{}.xpi", FIREFOX_EXTENSION_ID));
            if !enable && xpi_dest.exists() {
                let _ = fs::remove_file(xpi_dest);
            }
        } else {
            let descriptor_file1 = dir.join(format!("{}.json", CHROMIUM_EXTENSION_ID));
            let descriptor_file2 = dir.join(format!("{}.json", CHROMIUM_UNPACKED_ID));
            if enable {
                let payload = serde_json::json!({
                    "external_update_url": "https://clients2.google.com/service/update2/crx"
                });
                let json = serde_json::to_string_pretty(&payload).unwrap_or_default();
                let _ = fs::write(descriptor_file1, &json);
                let _ = fs::write(descriptor_file2, &json);
            } else {
                if descriptor_file1.exists() {
                    let _ = fs::remove_file(descriptor_file1);
                }
                if descriptor_file2.exists() {
                    let _ = fs::remove_file(descriptor_file2);
                }
            }
        }
    }
    Ok(())
}

pub fn get_or_create_extension_dir(family: &str) -> Result<PathBuf, String> {
    let base = if let Some(proj) =
        directories::ProjectDirs::from("com", "peivee", "ByteXDownloadManager")
    {
        proj.config_dir().join("extensions")
    } else {
        PathBuf::from("extensions")
    };

    materialize_extension_bundle(&base, family)
}

fn materialize_extension_bundle(base: &Path, family: &str) -> Result<PathBuf, String> {
    macro_rules! embedded_web_extension_files {
        ($family:literal) => {
            &[
                (
                    "manifest.json",
                    include_bytes!(concat!("../../../extensions/", $family, "/manifest.json"))
                        .as_slice(),
                ),
                (
                    "background.js",
                    include_bytes!(concat!("../../../extensions/", $family, "/background.js"))
                        .as_slice(),
                ),
                (
                    "content.js",
                    include_bytes!(concat!("../../../extensions/", $family, "/content.js"))
                        .as_slice(),
                ),
                (
                    "popup.html",
                    include_bytes!(concat!("../../../extensions/", $family, "/popup.html"))
                        .as_slice(),
                ),
                (
                    "popup.js",
                    include_bytes!(concat!("../../../extensions/", $family, "/popup.js"))
                        .as_slice(),
                ),
                (
                    "styles.css",
                    include_bytes!(concat!("../../../extensions/", $family, "/styles.css"))
                        .as_slice(),
                ),
                (
                    "icons/16x16.png",
                    include_bytes!(concat!("../../../extensions/", $family, "/icons/16x16.png"))
                        .as_slice(),
                ),
                (
                    "icons/32x32.png",
                    include_bytes!(concat!("../../../extensions/", $family, "/icons/32x32.png"))
                        .as_slice(),
                ),
                (
                    "icons/48x48.png",
                    include_bytes!(concat!("../../../extensions/", $family, "/icons/48x48.png"))
                        .as_slice(),
                ),
                (
                    "icons/128x128.png",
                    include_bytes!(concat!(
                        "../../../extensions/",
                        $family,
                        "/icons/128x128.png"
                    ))
                    .as_slice(),
                ),
            ]
        };
    }

    let (name, mut files) = if family.eq_ignore_ascii_case("firefox") {
        ("firefox", embedded_web_extension_files!("firefox").to_vec())
    } else if family.eq_ignore_ascii_case("safari") {
        ("safari", embedded_web_extension_files!("safari").to_vec())
    } else {
        (
            "chromium",
            embedded_web_extension_files!("chromium").to_vec(),
        )
    };
    if name == "chromium" {
        files.push((
            "request-capture.js",
            include_bytes!("../../../extensions/chromium/request-capture.js").as_slice(),
        ));
    } else if name == "firefox" {
        files.push((
            "request-capture.js",
            include_bytes!("../../../extensions/firefox/request-capture.js").as_slice(),
        ));
    }
    if name == "safari" {
        files.extend_from_slice(&[
            (
                "macos-wrapper/Info.plist",
                include_bytes!("../../../extensions/safari/macos-wrapper/Info.plist"),
            ),
            (
                "macos-wrapper/SafariWebExtensionHandler.swift",
                include_bytes!(
                    "../../../extensions/safari/macos-wrapper/SafariWebExtensionHandler.swift"
                ),
            ),
            (
                "macos-wrapper/project.yml",
                include_bytes!("../../../extensions/safari/macos-wrapper/project.yml"),
            ),
        ]);
    }

    let target_dir = base.join(name);
    fs::create_dir_all(&target_dir).map_err(|e| {
        format!(
            "Could not create {name} extension directory {}: {e}",
            target_dir.display()
        )
    })?;
    for (relative_path, contents) in files {
        let destination = target_dir.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Could not create extension directory {}: {e}",
                    parent.display()
                )
            })?;
        }
        fs::write(&destination, contents).map_err(|e| {
            format!(
                "Could not install extension file {}: {e}",
                destination.display()
            )
        })?;
    }

    Ok(target_dir)
}

#[cfg(test)]
mod extension_bundle_tests {
    use super::{
        chromium_manifest_extension_id, chromium_native_host_allowed_origins,
        materialize_extension_bundle,
    };
    use std::fs;

    #[test]
    fn chromium_native_host_allows_the_packaged_extension_key_id() {
        let extension_id = chromium_manifest_extension_id()
            .expect("the Chromium manifest should contain a valid public key");
        let expected_origin = format!("chrome-extension://{extension_id}/");
        assert!(chromium_native_host_allowed_origins().contains(&expected_origin));
    }

    #[test]
    fn bundled_manual_install_folders_include_every_manifest_icon() {
        let base = std::env::temp_dir().join(format!("bytex-extensions-{}", uuid::Uuid::new_v4()));

        for family in ["chromium", "firefox", "safari"] {
            let directory = materialize_extension_bundle(&base, family)
                .expect("extension bundle should be materialized");
            let manifest: serde_json::Value = serde_json::from_slice(
                &fs::read(directory.join("manifest.json")).expect("manifest should exist"),
            )
            .expect("manifest should be valid JSON");

            for icons in [
                manifest.get("icons"),
                manifest
                    .get("action")
                    .and_then(|action| action.get("default_icon")),
            ]
            .into_iter()
            .flatten()
            {
                for path in icons
                    .as_object()
                    .expect("icons should be an object")
                    .values()
                {
                    let relative_path = path.as_str().expect("icon paths should be strings");
                    assert!(
                        directory.join(relative_path).is_file(),
                        "{family} bundle is missing {relative_path}"
                    );
                }
            }

            assert!(directory.join("background.js").is_file());
            assert!(directory.join("content.js").is_file());
            let has_content_script = manifest
                .get("content_scripts")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|scripts| {
                    scripts.iter().any(|script| {
                        script
                            .get("js")
                            .and_then(serde_json::Value::as_array)
                            .is_some_and(|files| {
                                files.iter().any(|file| file.as_str() == Some("content.js"))
                            })
                    })
                });
            assert!(
                has_content_script,
                "{family} manifest must load the in-page notification script"
            );
            let icon_path = directory.join("icons/16x16.png");
            fs::write(&icon_path, b"stale icon").expect("stale icon should be replaceable");
            materialize_extension_bundle(&base, family)
                .expect("extension update should refresh existing files");
            assert_eq!(
                &fs::read(icon_path).expect("updated icon should exist")[..8],
                b"\x89PNG\r\n\x1a\n"
            );
            if family == "safari" {
                assert!(directory.join("macos-wrapper/Info.plist").is_file());
                assert!(directory
                    .join("macos-wrapper/SafariWebExtensionHandler.swift")
                    .is_file());
                assert!(directory.join("macos-wrapper/project.yml").is_file());
            }
        }

        let _ = fs::remove_dir_all(base);
    }
}

#[cfg(target_os = "windows")]
fn register_windows_registry_native_host(
    browser_id: &str,
    manifest_path: &PathBuf,
) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let subkeys: Vec<String> = match browser_id {
        "chrome" => vec![format!(
            r"Software\Google\Chrome\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "edge" => vec![format!(
            r"Software\Microsoft\Edge\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "brave" => vec![format!(
            r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "arc" => vec![
            format!(
                r"Software\The Browser Company\Arc\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
            format!(
                r"Software\Google\Chrome\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        "dia" => vec![
            format!(r"Software\Dia\NativeMessagingHosts\{}", NATIVE_HOST_NAME),
            format!(
                r"Software\Google\Chrome\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        "opera" | "operagx" => vec![format!(
            r"Software\Opera Software\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "vivaldi" => vec![format!(
            r"Software\Vivaldi\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "chromium" => vec![format!(
            r"Software\Chromium\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "thorium" => vec![
            format!(
                r"Software\Thorium\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
            format!(
                r"Software\Chromium\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        "ungoogled" => vec![format!(
            r"Software\Chromium\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "whale" => vec![
            format!(
                r"Software\Naver\Naver Whale\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
            format!(
                r"Software\Google\Chrome\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        "helium" => vec![
            format!(r"Software\Helium\NativeMessagingHosts\{}", NATIVE_HOST_NAME),
            format!(
                r"Software\Chromium\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        "yandex" => vec![format!(
            r"Software\Yandex\YandexBrowser\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp" | "tor" | "mullvad" => vec![
            format!(
                r"Software\Mozilla\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
            format!(
                r"Software\Zen Browser\NativeMessagingHosts\{}",
                NATIVE_HOST_NAME
            ),
        ],
        _ => vec![format!(
            r"Software\Google\Chrome\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
    };

    for subkey in subkeys {
        if let Ok((key, _)) = hkcu.create_subkey(&subkey) {
            let _ = key.set_value("", &manifest_path.to_string_lossy().to_string());
        }
    }

    let is_firefox_family = matches!(
        browser_id,
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp" | "tor" | "mullvad"
    );

    if is_firefox_family {
        if let Ok((ff_ext, _)) = hkcu.create_subkey(r"Software\Mozilla\Firefox\Extensions") {
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let xpi_path = parent.join(r"extensions\firefox\bytex-extension-firefox.xpi");
                    let _ = ff_ext.set_value(
                        FIREFOX_EXTENSION_ID,
                        &xpi_path.to_string_lossy().to_string(),
                    );
                }
            }
        }
    } else {
        let ext_subkeys: Vec<String> = match browser_id {
            "chrome" => vec![format!(
                r"Software\Google\Chrome\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "edge" => vec![format!(
                r"Software\Microsoft\Edge\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "brave" => vec![format!(
                r"Software\BraveSoftware\Brave-Browser\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "arc" => vec![
                format!(
                    r"Software\The Browser Company\Arc\Extensions\{}",
                    CHROMIUM_EXTENSION_ID
                ),
                format!(
                    r"Software\Google\Chrome\Extensions\{}",
                    CHROMIUM_EXTENSION_ID
                ),
            ],
            "dia" => vec![
                format!(r"Software\Dia\Extensions\{}", CHROMIUM_EXTENSION_ID),
                format!(
                    r"Software\Google\Chrome\Extensions\{}",
                    CHROMIUM_EXTENSION_ID
                ),
            ],
            "opera" | "operagx" => vec![format!(
                r"Software\Opera Software\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "vivaldi" => vec![format!(
                r"Software\Vivaldi\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "chromium" => vec![format!(
                r"Software\Chromium\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            "yandex" => vec![format!(
                r"Software\Yandex\YandexBrowser\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
            _ => vec![format!(
                r"Software\Google\Chrome\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            )],
        };

        for ext_subkey in ext_subkeys {
            if let Ok((ext_key, _)) = hkcu.create_subkey(&ext_subkey) {
                let _ = ext_key.set_value(
                    "update_url",
                    &"https://clients2.google.com/service/update2/crx".to_string(),
                );
            }
        }
    }
    Ok(())
}
