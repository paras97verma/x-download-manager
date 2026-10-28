//! Integration Tests: Binary Entrypoint & Architecture Verification

#[test]
fn test_app_version_string() {
    let pkg_version = env!("CARGO_PKG_VERSION");
    assert_eq!(pkg_version, "1.0.0");
}

#[test]
fn test_app_binary_name() {
    let pkg_name = env!("CARGO_PKG_NAME");
    assert_eq!(pkg_name, "x-download-manager");
}
