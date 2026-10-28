//! Integration Tests: Browser Extension Detection, Native Messaging Manifests & Engine Registry
use xdm_lib::browser::*;
use xdm_lib::config::AppSettings;

#[test]
fn test_supported_browsers_list_completeness() {
    // Verifies all expected browser engines and modern browsers are present
    let ids: Vec<&str> = SUPPORTED_BROWSERS.iter().map(|(id, _, _)| *id).collect();
    assert!(ids.contains(&"dia"), "Dia browser must be supported");
    assert!(ids.contains(&"arc"), "Arc browser must be supported");
    assert!(ids.contains(&"chrome"), "Google Chrome must be supported");
    assert!(ids.contains(&"brave"), "Brave must be supported");
    assert!(ids.contains(&"edge"), "Edge must be supported");
    assert!(ids.contains(&"opera"), "Opera must be supported");
    assert!(ids.contains(&"operagx"), "Opera GX must be supported");
    assert!(ids.contains(&"vivaldi"), "Vivaldi must be supported");
    assert!(ids.contains(&"firefox"), "Firefox must be supported");
    assert!(ids.contains(&"zen"), "Zen Browser must be supported");
    assert!(ids.contains(&"safari"), "Apple Safari must be supported");
}

#[test]
fn test_detect_browsers_returns_valid_structure() {
    let settings = AppSettings::default();
    let statuses = detect_browsers(&settings);
    assert_eq!(statuses.len(), SUPPORTED_BROWSERS.len());

    for status in statuses {
        assert!(!status.id.is_empty());
        assert!(!status.display_name.is_empty());
        assert!(matches!(
            status.family.as_str(),
            "chromium" | "firefox" | "safari"
        ));
        assert!(!status.manifest_path.is_empty());
        assert!(!status.status_message.is_empty());
    }
}

#[test]
fn test_native_messaging_directories_generated() {
    let chrome_dirs = get_all_native_messaging_dirs("chrome");
    assert!(!chrome_dirs.is_empty());

    let dia_dirs = get_all_native_messaging_dirs("dia");
    assert!(!dia_dirs.is_empty());

    let opera_dirs = get_all_native_messaging_dirs("opera");
    assert!(!opera_dirs.is_empty());

    let zen_dirs = get_all_native_messaging_dirs("zen");
    assert!(!zen_dirs.is_empty());
}
