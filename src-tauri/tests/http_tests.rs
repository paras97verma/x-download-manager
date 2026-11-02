//! Integration Tests: HTTP Segmentation & Binary Content-Type Verification
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use xdm_lib::config::SiteCredential;
use xdm_lib::engine::http::*;
use xdm_lib::engine::{DownloadEngine, NewDownloadRequest};

#[test]
fn test_compute_initial_segments_even_and_remainder() {
    let total = 100_000_000; // 100 MB
    let segments = compute_initial_segments(total, 8, 512 * 1024);
    assert_eq!(segments.len(), 8);
    assert_eq!(segments.first().unwrap().start_byte, 0);
    assert_eq!(segments.last().unwrap().end_byte, total - 1);

    // Ensure contiguous coverage with zero gaps or overlaps
    for i in 1..segments.len() {
        assert_eq!(segments[i].start_byte, segments[i - 1].end_byte + 1);
    }
}

#[test]
fn test_compute_initial_segments_single_thread() {
    let total = 5_000_000;
    let segments = compute_initial_segments(total, 1, 512 * 1024);
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].start_byte, 0);
    assert_eq!(segments[0].end_byte, total - 1);
}

#[test]
fn test_compute_initial_segments_zero_bytes() {
    let segments = compute_initial_segments(0, 8, 512 * 1024);
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].start_byte, 0);
    assert_eq!(segments[0].end_byte, 0);
}

#[test]
fn test_is_non_html_binary_extension_detection() {
    // Archives & installers
    assert!(is_non_html_binary_extension("ubuntu-24.04.iso"));
    assert!(is_non_html_binary_extension("setup.exe"));
    assert!(is_non_html_binary_extension("archive.tar.gz"));
    assert!(is_non_html_binary_extension("package.dmg"));
    assert!(is_non_html_binary_extension("app.pkg"));
    assert!(is_non_html_binary_extension("data.zip"));
    assert!(is_non_html_binary_extension("source.7z"));

    // Media & documents
    assert!(is_non_html_binary_extension("video.mp4"));
    assert!(is_non_html_binary_extension("movie.mkv"));
    assert!(is_non_html_binary_extension("song.flac"));
    assert!(is_non_html_binary_extension("paper.pdf"));
    assert!(is_non_html_binary_extension("sheet.xlsx"));
    assert!(is_non_html_binary_extension("file.torrent"));

    // Real HTML / Web pages should NOT be marked as binary
    assert!(!is_non_html_binary_extension("index.html"));
    assert!(!is_non_html_binary_extension("login.htm"));
    assert!(!is_non_html_binary_extension("page.php"));
}

#[tokio::test]
async fn test_http_download_client_sends_saved_site_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("local listener");
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("client connection");
        let mut request = Vec::new();
        let mut chunk = [0; 1024];
        loop {
            let read = stream.read(&mut chunk).expect("read request");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.contains("authorization: bearer saved-token"));
        assert!(request.contains("cookie: session=saved-cookie"));
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .expect("write response");
    });

    let credential = SiteCredential {
        id: "local-auth".into(),
        host_pattern: "127.0.0.1".into(),
        site_type: "bearer".into(),
        username: String::new(),
        password_or_token: "saved-token".into(),
        cookies: Some("session=saved-cookie".into()),
        custom_headers: HashMap::new(),
        enabled: true,
    };
    let engine = DownloadEngine::new();
    engine.settings.write().site_credentials = vec![credential];
    let item = engine.add_download(NewDownloadRequest {
        url: format!("http://{address}/file.zip"),
        filename: Some("file.zip".into()),
        category: None,
        save_path: Some(
            std::env::temp_dir()
                .join("bytex-auth-test.zip")
                .to_string_lossy()
                .to_string(),
        ),
        threads_count: Some(1),
        queue_id: Some("main-queue".into()),
        start_immediately: false,
        source_browser: None,
        referer: None,
        cookies: None,
        user_agent: None,
        custom_headers: None,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
    });

    let client = build_http_client(&engine.settings.read(), &item).expect("HTTP client");
    let response = client
        .get(&item.url)
        .send()
        .await
        .expect("download request")
        .text()
        .await
        .expect("response body");
    server.join().expect("auth headers reached server");
    assert_eq!(response, "ok");
    assert_eq!(item.site_credential_id.as_deref(), Some("local-auth"));
}
