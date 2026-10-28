//! Integration Tests: HTTP Segmentation & Binary Content-Type Verification
use xdm_lib::engine::http::*;

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
