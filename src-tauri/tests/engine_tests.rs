//! Integration Tests: Download Engine Lifecycle, Protocol Routing & Task Addition
use std::sync::Arc;
use xdm_lib::engine::*;

#[test]
fn test_download_engine_initial_state() {
    let engine = Arc::new(DownloadEngine::new());
    let list = engine.downloads.read().clone();
    // Engine must initialize clean with zero phantom/dummy downloads
    assert!(
        list.is_empty(),
        "New engine must have an empty downloads list without dummy tasks"
    );
}

#[test]
fn test_detect_protocol_accuracy() {
    assert_eq!(
        DownloadEngine::detect_protocol("magnet:?xt=urn:btih:abc1234567890"),
        DownloadProtocol::Magnet
    );
    assert_eq!(
        DownloadEngine::detect_protocol("https://releases.ubuntu.com/24.04/ubuntu.iso"),
        DownloadProtocol::Https
    );
    assert_eq!(
        DownloadEngine::detect_protocol("http://example.com/file.zip"),
        DownloadProtocol::Http
    );
    assert_eq!(
        DownloadEngine::detect_protocol("ftp://mirror.net/pub/archive.tar.gz"),
        DownloadProtocol::Ftp
    );
    assert_eq!(
        DownloadEngine::detect_protocol("ftps://secure.host.org/doc.pdf"),
        DownloadProtocol::Ftps
    );
    assert_eq!(
        DownloadEngine::detect_protocol("https://usersdrive.com/12345.html"),
        DownloadProtocol::Usersdrive
    );
}

#[test]
fn test_add_download_task_proper_routing() {
    let engine = Arc::new(DownloadEngine::new());
    let req = NewDownloadRequest {
        url: "https://example.com/downloads/package.tar.gz".to_string(),
        filename: Some("package.tar.gz".to_string()),
        category: None,
        save_path: None,
        threads_count: Some(4),
        queue_id: Some("main-queue".to_string()),
        start_immediately: false,
        source_browser: Some("dia".to_string()),
        referer: Some("https://example.com".to_string()),
        cookies: None,
        user_agent: None,
        custom_headers: None,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
    };

    let item = engine.add_download(req);
    assert_eq!(item.filename, "package.tar.gz");
    assert_eq!(item.category, "Compressed");
    assert_eq!(item.protocol, DownloadProtocol::Https);
    assert_eq!(item.threads_count, 4);
    assert_eq!(item.source_browser, Some("dia".to_string()));
    assert_eq!(item.status, DownloadStatus::Queued);
    assert_eq!(item.downloaded_bytes, 0);

    let list = engine.downloads.read().clone();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, item.id);
}
