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
fn test_dirs_default_download_path_has_bytex() {
    let p = dirs_default_download_path();
    assert!(p.ends_with("ByteX"));
}

#[test]
fn test_ensure_directories_exist() {
    let temp_dir = std::env::temp_dir().join("xdm_test_config");
    let settings = AppSettings {
        default_download_dir: temp_dir.to_string_lossy().to_string(),
        temp_segment_dir: temp_dir.join(".bytex_temp").to_string_lossy().to_string(),
        ..Default::default()
    };

    ensure_directories_exist(&settings);
    assert!(temp_dir.exists());
    assert!(temp_dir.join(".bytex_temp").exists());
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
fn test_legacy_xdm_data_migrates_to_bytex_without_overwriting() {
    let root = std::env::temp_dir().join(format!("bytex_migration_test_{}", std::process::id()));
    let legacy = root.join("XDownloadManager");
    let current = root.join("ByteXDownloadManager");
    fs::create_dir_all(legacy.join("torrent-state")).unwrap();
    fs::create_dir_all(&current).unwrap();
    fs::write(legacy.join("downloads.json"), "legacy-history").unwrap();
    fs::write(legacy.join("torrent-state/resume.json"), "legacy-resume").unwrap();
    fs::write(current.join("settings.json"), "current-settings").unwrap();

    migrate_legacy_data_dir(&legacy, &current);

    assert_eq!(
        fs::read_to_string(current.join("downloads.json")).unwrap(),
        "legacy-history"
    );
    assert_eq!(
        fs::read_to_string(current.join("torrent-state/resume.json")).unwrap(),
        "legacy-resume"
    );
    assert_eq!(
        fs::read_to_string(current.join("settings.json")).unwrap(),
        "current-settings"
    );
    assert!(!legacy.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn test_legacy_and_current_download_history_are_merged() {
    let root =
        std::env::temp_dir().join(format!("bytex_history_merge_test_{}", std::process::id()));
    let legacy = root.join("XDownloadManager");
    let current = root.join("ByteXDownloadManager");
    fs::create_dir_all(&legacy).unwrap();
    fs::create_dir_all(&current).unwrap();
    fs::write(
        legacy.join("downloads.json"),
        r#"{"format_version":1,"downloads":[{"id":"old"},{"id":"shared","legacy":true}]}"#,
    )
    .unwrap();
    fs::write(
        current.join("downloads.json"),
        r#"{"format_version":1,"downloads":[{"id":"new"},{"id":"shared","current":true}]}"#,
    )
    .unwrap();

    migrate_legacy_data_dir(&legacy, &current);

    let history: serde_json::Value =
        serde_json::from_slice(&fs::read(current.join("downloads.json")).unwrap()).unwrap();
    let downloads = history["downloads"].as_array().unwrap();
    let ids = downloads
        .iter()
        .map(|download| download["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids, ["new", "shared", "old"].into_iter().collect());
    assert_eq!(downloads.len(), 3);
    assert!(downloads
        .iter()
        .any(|download| download["id"] == "shared" && download["current"] == true));
    assert!(!legacy.exists());
    let _ = fs::remove_dir_all(root);
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
