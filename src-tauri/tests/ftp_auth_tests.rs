//! Integration Tests: FTP / FTPS Credentials, Wildcard Matching & Auth Resolution
use std::collections::HashMap;
use xdm_lib::config::SiteCredential;
use xdm_lib::engine::ftp_auth::*;

#[test]
fn test_match_site_credential_wildcard() {
    let creds = vec![
        SiteCredential {
            id: "1".into(),
            host_pattern: "*.usersdrive.com".into(),
            site_type: "usersdrive".into(),
            username: "alice".into(),
            password_or_token: "secret".into(),
            cookies: Some("xfss=abc".into()),
            custom_headers: HashMap::new(),
            enabled: true,
        },
        SiteCredential {
            id: "2".into(),
            host_pattern: "ftp.myhost.org".into(),
            site_type: "ftp".into(),
            username: "bob".into(),
            password_or_token: "pass123".into(),
            cookies: None,
            custom_headers: HashMap::new(),
            enabled: true,
        },
    ];

    let m1 = match_site_credential("https://usersdrive.com/ef8912ab34.html", &creds);
    assert!(m1.is_some());
    assert_eq!(m1.unwrap().username, "alice");

    let m2 = match_site_credential("https://cdn4.usersdrive.com/d/xyz/archive.zip", &creds);
    assert!(m2.is_some());

    let m3 = match_site_credential("ftp://ftp.myhost.org/pub/file.tar.gz", &creds);
    assert!(m3.is_some());
    assert_eq!(m3.unwrap().username, "bob");

    let m4 = match_site_credential("https://otherhost.org/file.zip", &creds);
    assert!(m4.is_none());
}

#[test]
fn test_match_site_credential_disabled_ignored() {
    let creds = vec![SiteCredential {
        id: "disabled-cred".into(),
        host_pattern: "*.disabledhost.com".into(),
        site_type: "generic".into(),
        username: "user".into(),
        password_or_token: "pass".into(),
        cookies: None,
        custom_headers: HashMap::new(),
        enabled: false,
    }];

    let m = match_site_credential("https://sub.disabledhost.com/file.zip", &creds);
    assert!(m.is_none(), "Disabled site credentials must be ignored");
}

#[test]
fn test_ftp_url_embedded_credentials() {
    let url_str = "ftp://customuser:mysecretpass@ftp.example.com:2121/data/archive.zip";
    let parsed = url::Url::parse(url_str).expect("Valid FTP URL");
    assert_eq!(parsed.username(), "customuser");
    assert_eq!(parsed.password(), Some("mysecretpass"));
    assert_eq!(parsed.host_str(), Some("ftp.example.com"));
    assert_eq!(parsed.port(), Some(2121));
    assert_eq!(parsed.path(), "/data/archive.zip");
}
