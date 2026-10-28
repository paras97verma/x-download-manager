//! Cross-Platform Browser Detection, Native Messaging Host Registration & Auto-Extension Installer
//! Supports Chromium family (Chrome, Edge, Brave, Opera, Vivaldi), Mozilla Firefox, and Apple Safari
//! across macOS, Windows, and Linux.

pub mod ipc_server;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::AppSettings;

pub const CHROMIUM_EXTENSION_ID: &str = "knldjmfmopnpolahpmmgbagdohdnhkik";
pub const FIREFOX_EXTENSION_ID: &str = "xdm-extension@peivee.com";
pub const SAFARI_EXTENSION_BUNDLE_ID: &str = "com.peivee.xdm.SafariExtension";
pub const NATIVE_HOST_NAME: &str = "com.peivee.xdm";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserStatus {
    pub id: String, // "chrome" | "edge" | "brave" | "opera" | "vivaldi" | "firefox" | "safari"
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
    let specs = vec![
        ("chrome", "Google Chrome", "chromium"),
        ("brave", "Brave Browser", "chromium"),
        ("edge", "Microsoft Edge", "chromium"),
        ("opera", "Opera", "chromium"),
        ("vivaldi", "Vivaldi", "chromium"),
        ("firefox", "Mozilla Firefox", "firefox"),
        ("safari", "Apple Safari", "safari"),
    ];

    specs
        .into_iter()
        .map(|(id, name, family)| {
            let exe = probe_browser_executable(id);
            let manifest_dir = get_native_messaging_dir(id);
            let manifest_file = manifest_dir.join(format!("{}.json", NATIVE_HOST_NAME));
            let native_registered = manifest_file.exists();
            let enabled = *settings.browser.enabled_browsers.get(id).unwrap_or(&true);
            let ext_bundle = match family {
                "chromium" => "extensions/chromium (Manifest V3)".to_string(),
                "firefox" => "extensions/firefox (WebExtension XPI)".to_string(),
                "safari" => "extensions/safari (Safari Web Extension)".to_string(),
                _ => String::new(),
            };

            let detected = exe.is_some() || (id == "safari" && cfg!(target_os = "macos"));
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
    let candidates: Vec<&str> = match browser_id {
        "chrome" => vec!["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        "brave" => vec!["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
        "edge" => vec!["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        "opera" => vec!["/Applications/Opera.app/Contents/MacOS/Opera"],
        "vivaldi" => vec!["/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
        "firefox" => vec!["/Applications/Firefox.app/Contents/MacOS/firefox"],
        "safari" => vec!["/Applications/Safari.app/Contents/MacOS/Safari"],
        _ => vec![],
    };

    #[cfg(target_os = "windows")]
    let candidates: Vec<&str> = match browser_id {
        "chrome" => vec![
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ],
        "brave" => vec![r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"],
        "edge" => vec![
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ],
        "opera" => vec![r"C:\Program Files\Opera\launcher.exe"],
        "vivaldi" => vec![r"C:\Program Files\Vivaldi\Application\vivaldi.exe"],
        "firefox" => vec![r"C:\Program Files\Mozilla Firefox\firefox.exe"],
        _ => vec![],
    };

    #[cfg(target_os = "linux")]
    let candidates: Vec<&str> = match browser_id {
        "chrome" => vec![
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
        ],
        "brave" => vec!["/usr/bin/brave-browser", "/usr/bin/brave"],
        "edge" => vec!["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
        "opera" => vec!["/usr/bin/opera"],
        "vivaldi" => vec!["/usr/bin/vivaldi", "/usr/bin/vivaldi-stable"],
        "firefox" => vec!["/usr/bin/firefox", "/snap/bin/firefox"],
        _ => vec![],
    };

    for path in candidates {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

/// Returns the OS-appropriate NativeMessagingHosts directory for a given browser
pub fn get_native_messaging_dir(browser_id: &str) -> PathBuf {
    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        let app_support = home.join("Library").join("Application Support");
        match browser_id {
            "chrome" => app_support.join("Google/Chrome/NativeMessagingHosts"),
            "brave" => app_support.join("BraveSoftware/Brave-Browser/NativeMessagingHosts"),
            "edge" => app_support.join("Microsoft Edge/NativeMessagingHosts"),
            "opera" => app_support.join("com.operasoftware.Opera/NativeMessagingHosts"),
            "vivaldi" => app_support.join("Vivaldi/NativeMessagingHosts"),
            "firefox" => app_support.join("Mozilla/NativeMessagingHosts"),
            "safari" => app_support.join("XDownloadManager/SafariExtension"),
            _ => app_support.join("XDownloadManager/NativeMessagingHosts"),
        }
    }

    #[cfg(target_os = "linux")]
    {
        let config = home.join(".config");
        match browser_id {
            "chrome" => config.join("google-chrome/NativeMessagingHosts"),
            "brave" => config.join("BraveSoftware/Brave-Browser/NativeMessagingHosts"),
            "edge" => config.join("microsoft-edge/NativeMessagingHosts"),
            "opera" => config.join("opera/NativeMessagingHosts"),
            "vivaldi" => config.join("vivaldi/NativeMessagingHosts"),
            "firefox" => home.join(".mozilla/native-messaging-hosts"),
            _ => config.join("xdm/NativeMessagingHosts"),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        home.join("AppData/Local/XDownloadManager/NativeMessagingHosts")
            .join(browser_id)
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

    let manifest_dir = get_native_messaging_dir(browser_id);
    fs::create_dir_all(&manifest_dir)
        .map_err(|e| format!("Failed to create manifest dir: {}", e))?;
    let manifest_file = manifest_dir.join(format!("{}.json", NATIVE_HOST_NAME));

    let current_exe = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("/usr/local/bin/x-download-manager"))
        .to_string_lossy()
        .to_string();

    if enable {
        if browser_id == "firefox" {
            let ff_manifest = FirefoxNativeHostManifest {
                name: NATIVE_HOST_NAME.to_string(),
                description: "X Download Manager Native Messaging Host".to_string(),
                path: current_exe,
                host_type: "stdio".to_string(),
                allowed_extensions: vec![FIREFOX_EXTENSION_ID.to_string()],
            };
            let json = serde_json::to_string_pretty(&ff_manifest).map_err(|e| e.to_string())?;
            fs::write(&manifest_file, json).map_err(|e| e.to_string())?;
        } else {
            let cr_manifest = ChromiumNativeHostManifest {
                name: NATIVE_HOST_NAME.to_string(),
                description: "X Download Manager Native Messaging Host".to_string(),
                path: current_exe,
                host_type: "stdio".to_string(),
                allowed_origins: vec![format!("chrome-extension://{}/", CHROMIUM_EXTENSION_ID)],
            };
            let json = serde_json::to_string_pretty(&cr_manifest).map_err(|e| e.to_string())?;
            fs::write(&manifest_file, json).map_err(|e| e.to_string())?;
        }

        let _ = write_external_extension_descriptor(browser_id, true);
        #[cfg(target_os = "windows")]
        let _ = register_windows_registry_native_host(browser_id, &manifest_file);
    } else {
        let _ = write_external_extension_descriptor(browser_id, false);
        if manifest_file.exists() {
            let _ = fs::remove_file(&manifest_file);
        }
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
/// so Chrome, Brave, Edge, and Firefox automatically load the bundled extension when installed.
pub fn write_external_extension_descriptor(browser_id: &str, enable: bool) -> Result<(), String> {
    let home = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    let ext_dir = {
        let app_support = home.join("Library/Application Support");
        match browser_id {
            "chrome" => Some(app_support.join("Google/Chrome/External Extensions")),
            "brave" => Some(app_support.join("BraveSoftware/Brave-Browser/External Extensions")),
            "edge" => Some(app_support.join("Microsoft Edge/External Extensions")),
            "firefox" => {
                Some(app_support.join("Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"))
            }
            _ => None,
        }
    };

    #[cfg(target_os = "linux")]
    let ext_dir = {
        let config = home.join(".config");
        match browser_id {
            "chrome" => Some(config.join("google-chrome/External Extensions")),
            "brave" => Some(config.join("BraveSoftware/Brave-Browser/External Extensions")),
            "edge" => Some(config.join("microsoft-edge/External Extensions")),
            "firefox" => {
                Some(home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"))
            }
            _ => None,
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let ext_dir: Option<PathBuf> = None;

    if let Some(dir) = ext_dir {
        let _ = fs::create_dir_all(&dir);
        if browser_id == "firefox" {
            let xpi_dest = dir.join(format!("{}.xpi", FIREFOX_EXTENSION_ID));
            if !enable && xpi_dest.exists() {
                let _ = fs::remove_file(xpi_dest);
            }
        } else {
            let descriptor_file = dir.join(format!("{}.json", CHROMIUM_EXTENSION_ID));
            if enable {
                let payload = serde_json::json!({
                    "external_update_url": "https://clients2.google.com/service/update2/crx"
                });
                let _ = fs::write(
                    descriptor_file,
                    serde_json::to_string_pretty(&payload).unwrap_or_default(),
                );
            } else if descriptor_file.exists() {
                let _ = fs::remove_file(descriptor_file);
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_windows_registry_native_host(
    browser_id: &str,
    manifest_path: &Path,
) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let subkey = match browser_id {
        "chrome" => format!(
            r"Software\Google\Chrome\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        ),
        "edge" => format!(
            r"Software\Microsoft\Edge\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        ),
        "brave" => format!(
            r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        ),
        "firefox" => format!(
            r"Software\Mozilla\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        ),
        _ => format!(
            r"Software\Google\Chrome\NativeMessagingHosts\{}",
            NATIVE_HOST_NAME
        ),
    };
    let (key, _) = hkcu.create_subkey(&subkey).map_err(|e| e.to_string())?;
    key.set_value("", &manifest_path.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;

    // Also register External Extension auto-install key (IDM / FDM method)
    if browser_id == "firefox" {
        let (ff_ext, _) = hkcu
            .create_subkey(r"Software\Mozilla\Firefox\Extensions")
            .map_err(|e| e.to_string())?;
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let xpi_path = parent.join(r"extensions\firefox\xdm-extension-firefox.xpi");
                let _ = ff_ext.set_value(
                    FIREFOX_EXTENSION_ID,
                    &xpi_path.to_string_lossy().to_string(),
                );
            }
        }
    } else {
        let ext_subkey = match browser_id {
            "chrome" => format!(
                r"Software\Google\Chrome\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            ),
            "edge" => format!(
                r"Software\Microsoft\Edge\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            ),
            "brave" => format!(
                r"Software\BraveSoftware\Brave-Browser\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            ),
            _ => format!(
                r"Software\Google\Chrome\Extensions\{}",
                CHROMIUM_EXTENSION_ID
            ),
        };
        if let Ok((ext_key, _)) = hkcu.create_subkey(&ext_subkey) {
            let _ = ext_key.set_value(
                "update_url",
                &"https://clients2.google.com/service/update2/crx".to_string(),
            );
        }
    }
    Ok(())
}
