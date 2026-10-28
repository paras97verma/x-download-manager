//! Integration Tests: Configuration, Directory Resolution & Settings
use std::fs;
use xdm_lib::config::*;

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
    let settings = AppSettings {
        default_download_dir: temp_dir.to_string_lossy().to_string(),
        temp_segment_dir: temp_dir.join(".xdm_temp").to_string_lossy().to_string(),
        ..Default::default()
    };

    ensure_directories_exist(&settings);
    assert!(temp_dir.exists());
    assert!(temp_dir.join(".xdm_temp").exists());
    for cat in &settings.categories {
        assert!(temp_dir.join(&cat.default_subfolder).exists());
    }
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_default_settings_no_dummy_credentials() {
    let settings = AppSettings::default();
    // Default settings must start clean without hardcoded dummy credentials
    assert!(
        settings.site_credentials.is_empty(),
        "Default site credentials must be empty; user or intercept will provide real credentials"
    );
    assert_eq!(settings.ui_mode, "simple");
    assert!(settings.default_threads_per_download >= 1);
    assert!(settings.max_threads_per_download >= settings.default_threads_per_download);
}

#[test]
fn test_settings_serialization_roundtrip() {
    let original = AppSettings::default();
    let json = serde_json::to_string_pretty(&original).expect("Failed to serialize AppSettings");
    let deserialized: AppSettings =
        serde_json::from_str(&json).expect("Failed to deserialize AppSettings");
    assert_eq!(deserialized.ui_mode, original.ui_mode);
    assert_eq!(
        deserialized.default_download_dir,
        original.default_download_dir
    );
    assert_eq!(deserialized.categories.len(), original.categories.len());
    assert_eq!(deserialized.queues.len(), original.queues.len());
}
