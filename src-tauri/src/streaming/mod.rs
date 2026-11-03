//! Progressive Media Streaming Subsystem (`OBJECTIVE.md §1, §16`)
//!
//! Provides a local embedded HTTP Range streaming server on the IPC loopback bridge
//! (`http://127.0.0.1:45678/api/v1/stream/:id`), allowing video and audio downloads
//! to be played seamlessly while actively downloading or after completion.
//!
//! Supports:
//! - Full RFC 7233 HTTP Byte-Range requests (`Range: bytes=X-Y`, `bytes=X-`, `bytes=-Y`).
//! - 206 Partial Content and 416 Range Not Satisfiable status codes with proper Content-Range.
//! - Accurate detection of media container MIME types (MP4, MKV, WebM, AVI, MOV, MP3, FLAC, WAV, AAC, OGG).
//! - Safe read isolation: reads only validated contiguous bytes from disk without corrupting active workers.
//! - Multi-file BitTorrent directory inspection to locate and stream primary media payloads.
//! - Cross-origin resource sharing (CORS) allowing embedded HTML5 video/audio players and external players.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::path::{Path as StdPath, PathBuf};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::engine::{DownloadEngine, DownloadItem, DownloadStatus};

/// Information returned to the frontend or external players describing a streamable media asset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaStreamInfo {
    pub download_id: String,
    pub filename: String,
    pub stream_url: String,
    pub mime_type: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub is_video: bool,
    pub is_audio: bool,
    pub is_complete: bool,
}

/// Detects the MIME type of a media asset based on its filename extension.
pub fn detect_media_mime(filename: &str) -> &'static str {
    let lower = filename.trim().to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "ts" => "video/mp2t",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "opus" => "audio/opus",
        _ => "application/octet-stream",
    }
}

/// Returns true if the file extension corresponds to a known video format.
pub fn is_video_file(filename: &str) -> bool {
    let lower = filename.trim().to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    matches!(
        ext,
        "mp4" | "m4v" | "webm" | "mkv" | "avi" | "mov" | "ts" | "ogv"
    )
}

/// Returns true if the file extension corresponds to a known audio format.
pub fn is_audio_file(filename: &str) -> bool {
    let lower = filename.trim().to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    matches!(
        ext,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "oga" | "m4a" | "opus"
    )
}

/// Returns true if the file is an audio or video media asset.
pub fn is_media_file(filename: &str) -> bool {
    is_video_file(filename) || is_audio_file(filename)
}

/// Resolves the concrete filesystem path of the media file associated with a download item.
/// For single-file downloads (HTTP/FTP/single-file torrents), returns the target file.
/// For multi-file torrent directories, inspects the directory structure and returns the largest media file.
pub fn resolve_media_file_path(item: &DownloadItem) -> Option<PathBuf> {
    let resolved = crate::config::resolve_path(&item.save_path);
    if resolved.is_file() {
        return Some(resolved);
    }

    if resolved.is_dir() {
        // Multi-file torrent payload: recursively find all media files and pick the largest one.
        let mut largest_media: Option<(PathBuf, u64)> = None;
        find_media_in_dir(&resolved, &mut largest_media);
        if let Some((path, _)) = largest_media {
            return Some(path);
        }
    }

    // Check if filename has an extension directly in the parent directory
    if let Some(parent) = resolved.parent() {
        let direct = parent.join(&item.filename);
        if direct.is_file() {
            return Some(direct);
        }
    }

    None
}

fn find_media_in_dir(dir: &StdPath, current_largest: &mut Option<(PathBuf, u64)>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_media_in_dir(&path, current_largest);
            } else if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if is_media_file(&name) {
                    let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    match current_largest {
                        Some((_, cur_len)) => {
                            if len > *cur_len {
                                *current_largest = Some((path, len));
                            }
                        }
                        None => {
                            *current_largest = Some((path, len));
                        }
                    }
                }
            }
        }
    }
}

/// Parses an HTTP `Range` header conforming to RFC 7233.
/// Returns `Some((start, end))` where `start` and `end` are inclusive offsets.
pub fn parse_range_header(range_val: &str, total_length: u64) -> Option<(u64, u64)> {
    if total_length == 0 {
        return None;
    }
    let s = range_val.trim();
    if !s.starts_with("bytes=") {
        return None;
    }
    let spec = &s["bytes=".len()..];
    // We handle single-range requests, which standard audio/video elements emit.
    let first_range = spec.split(',').next()?.trim();
    let mut parts = first_range.split('-');
    let start_str = parts.next()?.trim();
    let end_str = parts.next()?.trim();

    if start_str.is_empty() {
        // Suffix range: bytes=-500 -> last 500 bytes
        let suffix_len: u64 = end_str.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = total_length.saturating_sub(suffix_len);
        let end = total_length - 1;
        Some((start, end))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= total_length {
            return None;
        }
        let end = if end_str.is_empty() {
            total_length - 1
        } else {
            let e: u64 = end_str.parse().ok()?;
            e.min(total_length - 1)
        };
        if start > end {
            return None;
        }
        Some((start, end))
    }
}

/// Computes the available contiguous upper boundary from `requested_start` given active download state.
pub fn compute_available_end(
    item: &DownloadItem,
    requested_start: u64,
    requested_end: u64,
    disk_file_len: u64,
) -> Option<u64> {
    if item.status == DownloadStatus::Completed {
        // Download is 100% complete; everything on disk is verified and available.
        let max_len = if item.total_bytes > 0 {
            item.total_bytes
        } else {
            disk_file_len
        };
        if requested_start >= max_len {
            return None;
        }
        return Some(requested_end.min(max_len.saturating_sub(1)));
    }

    // Active or paused download
    if item.segments.is_empty() {
        // Single stream or torrent: contiguous downloaded bytes from offset 0
        let available_bytes = item.downloaded_bytes.min(disk_file_len);
        if requested_start < available_bytes {
            let max_avail = available_bytes.saturating_sub(1);
            Some(requested_end.min(max_avail))
        } else {
            // Requested offset has not yet been downloaded
            None
        }
    } else {
        // Multi-segmented download: find the segment responsible for `requested_start`
        let covering_seg = item
            .segments
            .iter()
            .find(|seg| requested_start >= seg.start_byte && requested_start <= seg.end_byte);

        if let Some(seg) = covering_seg {
            let seg_downloaded_up_to = seg.start_byte + seg.downloaded_bytes;
            if requested_start < seg_downloaded_up_to {
                let seg_available_end = seg_downloaded_up_to.saturating_sub(1).min(seg.end_byte);
                Some(requested_end.min(seg_available_end))
            } else {
                // Segment has not downloaded up to requested start offset yet
                None
            }
        } else {
            // Requested offset is outside configured segment ranges
            None
        }
    }
}

/// Standard CORS and byte-range headers added to all media streaming responses.
fn apply_common_headers(headers: &mut HeaderMap, mime_type: &str) {
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range, Accept, Origin, Content-Type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static(
            "Content-Range, Content-Length, Accept-Ranges, X-ByteX-Buffering, X-ByteX-Media-Status",
        ),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
}

/// Axum HTTP handler serving progressive media streams with RFC 7233 byte-range support.
pub async fn stream_media_handler(
    Path(download_id): Path<String>,
    req_headers: HeaderMap,
    State(engine): State<Arc<DownloadEngine>>,
) -> Response {
    // 1. Look up download item
    let item = {
        let dls = engine.downloads.read();
        dls.iter().find(|d| d.id == download_id).cloned()
    };

    let Some(item) = item else {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"Download not found"}"#,
        )
            .into_response();
    };

    // 2. Resolve media file on disk
    let file_path = match resolve_media_file_path(&item) {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [
                    (header::CONTENT_TYPE, "application/json"),
                    (header::HeaderName::from_static("retry-after"), "2"),
                ],
                r#"{"error":"Media file not yet created on disk. Transfer is initializing."}"#,
            )
                .into_response();
        }
    };

    // 3. Inspect file metadata
    let disk_file_len = match tokio::fs::metadata(&file_path).await {
        Ok(m) => m.len(),
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CONTENT_TYPE, "application/json")],
                r#"{"error":"Could not read file metadata from storage."}"#,
            )
                .into_response();
        }
    };

    let total_file_len = if item.total_bytes > 0 {
        item.total_bytes
    } else {
        disk_file_len
    };

    if total_file_len == 0 {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"Media payload size is 0 bytes; waiting for content."}"#,
        )
            .into_response();
    }

    let mime_type = detect_media_mime(&file_path.to_string_lossy());

    // 4. Handle Range header
    let range_header = req_headers.get(header::RANGE).and_then(|h| h.to_str().ok());

    match range_header {
        Some(range_str) => {
            let parsed_range = parse_range_header(range_str, total_file_len);
            let Some((req_start, req_end)) = parsed_range else {
                let mut resp_headers = HeaderMap::new();
                resp_headers.insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes */{}", total_file_len))
                        .unwrap_or(HeaderValue::from_static("bytes */*")),
                );
                apply_common_headers(&mut resp_headers, mime_type);
                return (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    resp_headers,
                    "Requested Range Not Satisfiable",
                )
                    .into_response();
            };

            // Evaluate contiguous downloaded bytes for this offset
            let available_end = compute_available_end(&item, req_start, req_end, disk_file_len);
            let Some(available_end) = available_end else {
                // The requested offset is currently downloading or ahead of the buffer
                let mut resp_headers = HeaderMap::new();
                resp_headers.insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes */{}", total_file_len))
                        .unwrap_or(HeaderValue::from_static("bytes */*")),
                );
                resp_headers.insert(
                    header::HeaderName::from_static("x-bytex-buffering"),
                    HeaderValue::from_static("pending"),
                );
                apply_common_headers(&mut resp_headers, mime_type);
                return (
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    resp_headers,
                    "Requested range is currently buffering from the remote source",
                )
                    .into_response();
            };

            let chunk_len = available_end.saturating_sub(req_start) + 1;

            // Open file for reading
            let mut file = match File::open(&file_path).await {
                Ok(f) => f,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        [(header::CONTENT_TYPE, "application/json")],
                        format!(r#"{{"error":"Storage read error: {}"}}"#, err),
                    )
                        .into_response();
                }
            };

            if let Err(err) = file.seek(SeekFrom::Start(req_start)).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!(r#"{{"error":"Seek error: {}"}}"#, err),
                )
                    .into_response();
            }

            let stream = ReaderStream::new(file.take(chunk_len));
            let body = Body::from_stream(stream);

            let mut resp_headers = HeaderMap::new();
            apply_common_headers(&mut resp_headers, mime_type);
            resp_headers.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!(
                    "bytes {}-{}/{}",
                    req_start, available_end, total_file_len
                ))
                .unwrap(),
            );
            resp_headers.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&chunk_len.to_string()).unwrap(),
            );
            resp_headers.insert(
                header::HeaderName::from_static("x-bytex-media-status"),
                HeaderValue::from_str(if item.status == DownloadStatus::Completed {
                    "completed"
                } else {
                    "streaming-active"
                })
                .unwrap(),
            );

            (StatusCode::PARTIAL_CONTENT, resp_headers, body).into_response()
        }
        None => {
            // Full stream request without Range header
            if item.status == DownloadStatus::Completed {
                let file = match File::open(&file_path).await {
                    Ok(f) => f,
                    Err(err) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            [(header::CONTENT_TYPE, "application/json")],
                            format!(r#"{{"error":"Storage read error: {}"}}"#, err),
                        )
                            .into_response();
                    }
                };

                let stream = ReaderStream::new(file.take(total_file_len));
                let body = Body::from_stream(stream);

                let mut resp_headers = HeaderMap::new();
                apply_common_headers(&mut resp_headers, mime_type);
                resp_headers.insert(
                    header::CONTENT_LENGTH,
                    HeaderValue::from_str(&total_file_len.to_string()).unwrap(),
                );

                (StatusCode::OK, resp_headers, body).into_response()
            } else {
                // In-progress: return partial content starting from byte 0 up to available
                let available_end =
                    compute_available_end(&item, 0, total_file_len - 1, disk_file_len).unwrap_or(0);
                let chunk_len = available_end + 1;

                let mut file = match File::open(&file_path).await {
                    Ok(f) => f,
                    Err(err) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            [(header::CONTENT_TYPE, "application/json")],
                            format!(r#"{{"error":"Storage read error: {}"}}"#, err),
                        )
                            .into_response();
                    }
                };

                let _ = file.seek(SeekFrom::Start(0)).await;
                let stream = ReaderStream::new(file.take(chunk_len));
                let body = Body::from_stream(stream);

                let mut resp_headers = HeaderMap::new();
                apply_common_headers(&mut resp_headers, mime_type);
                resp_headers.insert(
                    header::CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes 0-{}/{}", available_end, total_file_len))
                        .unwrap(),
                );
                resp_headers.insert(
                    header::CONTENT_LENGTH,
                    HeaderValue::from_str(&chunk_len.to_string()).unwrap(),
                );
                resp_headers.insert(
                    header::HeaderName::from_static("x-bytex-media-status"),
                    HeaderValue::from_static("streaming-active"),
                );

                (StatusCode::PARTIAL_CONTENT, resp_headers, body).into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::DownloadProtocol;

    #[test]
    fn test_detect_media_mime() {
        assert_eq!(detect_media_mime("movie.mp4"), "video/mp4");
        assert_eq!(detect_media_mime("CLIP.MKV"), "video/x-matroska");
        assert_eq!(detect_media_mime("track.mp3"), "audio/mpeg");
        assert_eq!(detect_media_mime("song.flac"), "audio/flac");
        assert_eq!(detect_media_mime("archive.zip"), "application/octet-stream");
    }

    #[test]
    fn test_is_media_file() {
        assert!(is_media_file("video.mp4"));
        assert!(is_media_file("audio.mp3"));
        assert!(is_media_file("sample.webm"));
        assert!(is_media_file("lossless.flac"));
        assert!(!is_media_file("document.pdf"));
        assert!(!is_media_file("installer.dmg"));
    }

    #[test]
    fn test_parse_range_header() {
        let total = 10_000u64;

        // bytes=0-499
        assert_eq!(parse_range_header("bytes=0-499", total), Some((0, 499)));

        // bytes=500-
        assert_eq!(parse_range_header("bytes=500-", total), Some((500, 9999)));

        // bytes=-500 (suffix)
        assert_eq!(parse_range_header("bytes=-500", total), Some((9500, 9999)));

        // Invalid: start >= total
        assert_eq!(parse_range_header("bytes=15000-", total), None);

        // Invalid: start > end
        assert_eq!(parse_range_header("bytes=500-200", total), None);

        // Clamped end
        assert_eq!(
            parse_range_header("bytes=9000-20000", total),
            Some((9000, 9999))
        );
    }

    #[test]
    fn test_compute_available_end_completed() {
        use crate::engine::DownloadProtocol;
        let item = DownloadItem {
            id: "dl-1".to_string(),
            filename: "video.mp4".to_string(),
            url: "https://example.com/video.mp4".to_string(),
            resolved_url: None,
            redirect_chain: vec![],
            protocol: DownloadProtocol::Https,
            category: "video".to_string(),
            queue_id: "main-queue".to_string(),
            save_path: "/downloads/video.mp4".to_string(),
            total_bytes: 1000,
            downloaded_bytes: 1000,
            speed_bps: 0,
            upload_speed_bps: 0,
            eta_seconds: None,
            status: DownloadStatus::Completed,
            resumable: true,
            range_advertised: true,
            resume_validator: None,
            threads_count: 4,
            segments: vec![],
            torrent_meta: None,
            source_browser: None,
            referer: None,
            cookies: None,
            custom_headers: std::collections::HashMap::new(),
            request_method: "GET".to_string(),
            request_body: None,
            browser_intercepted: false,
            browser_context_redacted: false,
            site_credential_id: None,
            checksum_sha256: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            completed_at: None,
            error_message: None,
            transfer_log: vec![],
            torrent_file_path: None,
            torrent_selected_files: None,
            priority: "normal".to_string(),
            speed_limit_bps: None,
        };

        assert_eq!(compute_available_end(&item, 0, 499, 1000), Some(499));
        assert_eq!(compute_available_end(&item, 500, 999, 1000), Some(999));
        assert_eq!(compute_available_end(&item, 1000, 1500, 1000), None);
    }

    #[tokio::test]
    async fn test_streaming_endpoint_range_and_headers() {
        use axum::http::Request;
        use http_body_util::BodyExt;
        use tower::ServiceExt;

        let temp_dir =
            std::env::temp_dir().join(format!("bytex-test-stream-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let sample_file = temp_dir.join("sample.mp4");
        // Write 1000 bytes of dummy mp4 payload
        let sample_data = (0..1000).map(|i| (i % 256) as u8).collect::<Vec<u8>>();
        std::fs::write(&sample_file, &sample_data).unwrap();

        let engine = Arc::new(DownloadEngine::new());
        let item = DownloadItem {
            id: "stream-test-1".to_string(),
            filename: "sample.mp4".to_string(),
            url: "https://example.com/sample.mp4".to_string(),
            resolved_url: None,
            redirect_chain: vec![],
            protocol: DownloadProtocol::Https,
            category: "video".to_string(),
            queue_id: "main-queue".to_string(),
            save_path: sample_file.to_string_lossy().to_string(),
            total_bytes: 1000,
            downloaded_bytes: 1000,
            speed_bps: 0,
            upload_speed_bps: 0,
            eta_seconds: None,
            status: DownloadStatus::Completed,
            resumable: true,
            range_advertised: true,
            resume_validator: None,
            threads_count: 4,
            segments: vec![],
            torrent_meta: None,
            source_browser: None,
            referer: None,
            cookies: None,
            custom_headers: std::collections::HashMap::new(),
            request_method: "GET".to_string(),
            request_body: None,
            browser_intercepted: false,
            browser_context_redacted: false,
            site_credential_id: None,
            checksum_sha256: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            completed_at: None,
            error_message: None,
            transfer_log: vec![],
            torrent_file_path: None,
            torrent_selected_files: None,
            priority: "normal".to_string(),
            speed_limit_bps: None,
        };
        engine.downloads.write().push(item);

        let app = axum::Router::new()
            .route("/stream/:id", axum::routing::get(stream_media_handler))
            .with_state(engine);

        // Request partial range 100-199
        let req = Request::builder()
            .uri("/stream/stream-test-1")
            .header(header::RANGE, "bytes=100-199")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 100-199/1000"
        );
        assert_eq!(resp.headers().get(header::CONTENT_LENGTH).unwrap(), "100");
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "video/mp4"
        );
        assert_eq!(resp.headers().get(header::ACCEPT_RANGES).unwrap(), "bytes");

        let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(body_bytes.len(), 100);
        assert_eq!(&body_bytes[..], &sample_data[100..200]);

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
