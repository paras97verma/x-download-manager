//! Cross-Platform Browser Detection, Native Messaging Host Registration & Auto-Extension Installer
//! Supports Chromium family (Chrome, Brave, Edge, Arc, Dia, Opera, Opera GX, Vivaldi, Chromium, Thorium, Yandex),
//! Mozilla Firefox family (Firefox, Zen Browser, LibreWolf, Waterfox, Floorp),
//! and Safari/WebKit family (Apple Safari, Orion Browser) across macOS, Windows, and Linux.

pub mod ipc_server;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
    ("chromium", "Chromium / Thorium", "chromium"),
    ("yandex", "Yandex Browser", "chromium"),
    ("firefox", "Mozilla Firefox", "firefox"),
    ("zen", "Zen Browser", "firefox"),
    ("librewolf", "LibreWolf", "firefox"),
    ("waterfox", "Waterfox", "firefox"),
    ("floorp", "Floorp", "firefox"),
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
            let status_message = if !detected {
                "Browser not detected on this system".to_string()
            } else if enabled && native_registered {
                "Connected & Intercepting Downloads".to_string()
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
                home.join("Applications/Dia.app/Contents/MacOS/Dia"),
            ],
            "opera" => vec![
                PathBuf::from("/Applications/Opera.app/Contents/MacOS/Opera"),
                home.join("Applications/Opera.app/Contents/MacOS/Opera"),
            ],
            "operagx" => vec![
                PathBuf::from("/Applications/Opera GX.app/Contents/MacOS/Opera GX"),
                home.join("Applications/Opera GX.app/Contents/MacOS/Opera GX"),
            ],
            "vivaldi" => vec![
                PathBuf::from("/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"),
                home.join("Applications/Vivaldi.app/Contents/MacOS/Vivaldi"),
            ],
            "chromium" => vec![
                PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
                PathBuf::from("/Applications/Thorium.app/Contents/MacOS/Thorium"),
                home.join("Applications/Chromium.app/Contents/MacOS/Chromium"),
            ],
            "yandex" => vec![
                PathBuf::from("/Applications/Yandex.app/Contents/MacOS/Yandex"),
                home.join("Applications/Yandex.app/Contents/MacOS/Yandex"),
            ],
            "firefox" => vec![
                PathBuf::from("/Applications/Firefox.app/Contents/MacOS/firefox"),
                home.join("Applications/Firefox.app/Contents/MacOS/firefox"),
            ],
            "zen" => vec![
                PathBuf::from("/Applications/Zen Browser.app/Contents/MacOS/zen"),
                PathBuf::from("/Applications/Zen.app/Contents/MacOS/zen"),
                home.join("Applications/Zen Browser.app/Contents/MacOS/zen"),
                home.join("Applications/Zen.app/Contents/MacOS/zen"),
            ],
            "librewolf" => vec![
                PathBuf::from("/Applications/LibreWolf.app/Contents/MacOS/librewolf"),
                home.join("Applications/LibreWolf.app/Contents/MacOS/librewolf"),
            ],
            "waterfox" => vec![
                PathBuf::from("/Applications/Waterfox.app/Contents/MacOS/waterfox"),
                home.join("Applications/Waterfox.app/Contents/MacOS/waterfox"),
            ],
            "floorp" => vec![
                PathBuf::from("/Applications/Floorp.app/Contents/MacOS/floorp"),
                home.join("Applications/Floorp.app/Contents/MacOS/floorp"),
            ],
            "safari" => vec![PathBuf::from(
                "/Applications/Safari.app/Contents/MacOS/Safari",
            )],
            "orion" => vec![
                PathBuf::from("/Applications/Orion.app/Contents/MacOS/Orion"),
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
            "chromium" => vec![
                PathBuf::from(&local_app_data).join(r"Chromium\Application\chrome.exe"),
                PathBuf::from(&prog_files).join(r"Thorium\thorium.exe"),
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
            "chromium" => vec![
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/usr/bin/thorium-browser",
            ],
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
            ],
            "opera" => vec![app_support.join("com.operasoftware.Opera/NativeMessagingHosts")],
            "operagx" => vec![app_support.join("com.operasoftware.OperaGX/NativeMessagingHosts")],
            "vivaldi" => vec![app_support.join("Vivaldi/NativeMessagingHosts")],
            "chromium" => vec![
                app_support.join("Chromium/NativeMessagingHosts"),
                app_support.join("Thorium/NativeMessagingHosts"),
            ],
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
            "safari" => vec![app_support.join("XDownloadManager/SafariExtension")],
            "orion" => vec![
                app_support.join("Orion/NativeMessagingHosts"),
                app_support.join("Orion/User Data/NativeMessagingHosts"),
            ],
            _ => vec![app_support.join("XDownloadManager/NativeMessagingHosts")],
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
            _ => vec![config.join("xdm/NativeMessagingHosts")],
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        vec![home
            .join("AppData/Local/XDownloadManager/NativeMessagingHosts")
            .join(browser_id)]
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
        .unwrap_or_else(|_| PathBuf::from("/usr/local/bin/x-download-manager"))
        .to_string_lossy()
        .to_string();

    let is_firefox_family = matches!(
        browser_id,
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp"
    );

    for dir in &all_dirs {
        let manifest_file = dir.join(format!("{}.json", NATIVE_HOST_NAME));
        if enable {
            let _ = fs::create_dir_all(dir);
            if is_firefox_family {
                let ff_manifest = FirefoxNativeHostManifest {
                    name: NATIVE_HOST_NAME.to_string(),
                    description: "X Download Manager Native Messaging Host".to_string(),
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
                    description: "X Download Manager Native Messaging Host".to_string(),
                    path: current_exe.clone(),
                    host_type: "stdio".to_string(),
                    allowed_origins: vec![
                        format!("chrome-extension://{}/", CHROMIUM_EXTENSION_ID),
                        format!("chrome-extension://{}/", CHROMIUM_UNPACKED_ID),
                    ],
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
            _ => vec![],
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let ext_dirs: Vec<PathBuf> = vec![];

    let is_firefox_family = matches!(
        browser_id,
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp"
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
    let base =
        if let Some(proj) = directories::ProjectDirs::from("com", "peivee", "XDownloadManager") {
            proj.config_dir().join("extensions")
        } else {
            PathBuf::from("extensions")
        };

    let target_dir = if family.eq_ignore_ascii_case("firefox") {
        base.join("firefox")
    } else {
        base.join("chromium")
    };

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    if family.eq_ignore_ascii_case("firefox") {
        let manifest = include_str!("../../../extensions/firefox/manifest.json");
        let bg = include_str!("../../../extensions/firefox/background.js");
        let content = include_str!("../../../extensions/firefox/content.js");
        let popup_html = include_str!("../../../extensions/firefox/popup.html");
        let popup_js = include_str!("../../../extensions/firefox/popup.js");
        let styles = include_str!("../../../extensions/firefox/styles.css");

        let _ = fs::write(target_dir.join("manifest.json"), manifest);
        let _ = fs::write(target_dir.join("background.js"), bg);
        let _ = fs::write(target_dir.join("content.js"), content);
        let _ = fs::write(target_dir.join("popup.html"), popup_html);
        let _ = fs::write(target_dir.join("popup.js"), popup_js);
        let _ = fs::write(target_dir.join("styles.css"), styles);
    } else {
        let manifest = include_str!("../../../extensions/chromium/manifest.json");
        let bg = include_str!("../../../extensions/chromium/background.js");
        let content = include_str!("../../../extensions/chromium/content.js");
        let popup_html = include_str!("../../../extensions/chromium/popup.html");
        let popup_js = include_str!("../../../extensions/chromium/popup.js");
        let styles = include_str!("../../../extensions/chromium/styles.css");

        let _ = fs::write(target_dir.join("manifest.json"), manifest);
        let _ = fs::write(target_dir.join("background.js"), bg);
        let _ = fs::write(target_dir.join("content.js"), content);
        let _ = fs::write(target_dir.join("popup.html"), popup_html);
        let _ = fs::write(target_dir.join("popup.js"), popup_js);
        let _ = fs::write(target_dir.join("styles.css"), styles);
    }

    Ok(target_dir)
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
        "yandex" => vec![format!(
            r"Software\Yandex\YandexBrowser\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        )],
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp" => vec![
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
        "firefox" | "zen" | "librewolf" | "waterfox" | "floorp"
    );

    if is_firefox_family {
        if let Ok((ff_ext, _)) = hkcu.create_subkey(r"Software\Mozilla\Firefox\Extensions") {
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let xpi_path = parent.join(r"extensions\firefox\xdm-extension-firefox.xpi");
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
