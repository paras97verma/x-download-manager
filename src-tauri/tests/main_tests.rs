//! Integration Tests: Binary Entrypoint & Architecture Verification

#[test]
fn test_app_version_string() {
    let pkg_version = env!("CARGO_PKG_VERSION");
    assert!(!pkg_version.is_empty(), "Version must not be empty");
    assert!(
        pkg_version.contains('.'),
        "Version must follow semantic version format"
    );
}

#[test]
fn test_app_binary_name() {
    let pkg_name = env!("CARGO_PKG_NAME");
    assert_eq!(pkg_name, "x-download-manager");
}
