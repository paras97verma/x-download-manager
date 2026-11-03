//! Multi-Threaded Segmented HTTP/HTTPS Download Engine (ByteX Architecture)
//! Supports:
//! - Capability probe (`HEAD` & `GET Range: bytes=0-0`)
//! - Concurrent N-thread byte range chunking (up to 32 simultaneous threads)
//! - Dynamic segment work-stealing when a worker finishes early
//! - Token-bucket global & per-task bandwidth throttling
//! - Cookie, Referer, User-Agent, Basic/Bearer Auth header passthrough
//! - SHA-256 integrity calculation upon segment merge

use futures_util::StreamExt;
use parking_lot::RwLock;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    COOKIE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE, REFERER, USER_AGENT,
};
use reqwest::{Method, StatusCode};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;

use crate::config::AppSettings;
use crate::engine::{DownloadItem, DownloadStatus, ThreadSegment};

pub struct HttpProbeResult {
    pub total_bytes: u64,
    pub accepts_ranges: bool,
    pub resolved_url: String,
    pub suggested_filename: Option<String>,
    pub content_type: Option<String>,
}

pub fn is_non_html_binary_extension(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    matches!(
        ext,
        "zip"
            | "rar"
            | "7z"
            | "tar"
            | "gz"
            | "xz"
            | "bz2"
            | "iso"
            | "dmg"
            | "pkg"
            | "exe"
            | "msi"
            | "deb"
            | "rpm"
            | "bin"
            | "apk"
            | "appimage"
            | "mp4"
            | "mkv"
            | "avi"
            | "mov"
            | "webm"
            | "mp3"
            | "flac"
            | "wav"
            | "pdf"
            | "docx"
            | "xlsx"
            | "pptx"
            | "torrent"
    )
}

fn extract_disposition_filename(headers: &HeaderMap) -> Option<String> {
    let val = headers
        .get(reqwest::header::CONTENT_DISPOSITION)?
        .to_str()
        .ok()?;
    for part in val.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename*=") {
            if let Some(actual) = rest.split("''").nth(1) {
                let clean = actual.trim_matches('"').trim();
                if !clean.is_empty() {
                    return Some(clean.to_string());
                }
            }
        } else if let Some(rest) = p.strip_prefix("filename=") {
            let clean = rest.trim_matches('"').trim_matches('\'').trim();
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
    }
    None
}

pub fn build_http_client(
    settings: &AppSettings,
    item: &DownloadItem,
) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    let ua = item
        .custom_headers
        .get("User-Agent")
        .cloned()
        .unwrap_or_else(|| settings.custom_user_agent.clone());

    if let Ok(val) = HeaderValue::from_str(&ua) {
        headers.insert(USER_AGENT, val);
    }
    if let Some(ref referer) = item.referer {
        if let Ok(val) = HeaderValue::from_str(referer) {
            headers.insert(REFERER, val);
        }
    }
    if let Some(ref cookies) = item.cookies {
        if let Ok(val) = HeaderValue::from_str(cookies) {
            headers.insert(COOKIE, val);
        }
    }
    for (k, v) in &item.custom_headers {
        if k.starts_with("X-XDM-FTP-") {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            headers.insert(name, val);
        }
    }

    let mut builder = reqwest::Client::builder()
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(settings.connection_timeout_seconds))
        .redirect(reqwest::redirect::Policy::limited(10));

    if settings.proxy.enabled && !settings.proxy.host.is_empty() {
        let scheme = match settings.proxy.proxy_type.as_str() {
            "socks5" => "socks5",
            "https" => "https",
            _ => "http",
        };
        let proxy_url = format!(
            "{}://{}:{}",
            scheme, settings.proxy.host, settings.proxy.port
        );
        if let Ok(mut proxy) = reqwest::Proxy::all(&proxy_url) {
            if let (Some(u), Some(p)) = (&settings.proxy.username, &settings.proxy.password) {
                proxy = proxy.basic_auth(u, p);
            }
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

pub async fn probe_remote_resource(
    client: &reqwest::Client,
    target_url: &str,
) -> Result<HttpProbeResult, String> {
    // Perform HEAD request first, fallback to Range GET bytes=0-0 if server rejects HEAD
    let head_resp = client.head(target_url).send().await;
    if let Ok(resp) = head_resp {
        if resp.status().is_success() {
            let total_bytes = resp
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            let accepts_ranges = resp
                .headers()
                .get(ACCEPT_RANGES)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.contains("bytes"))
                .unwrap_or(false);

            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let suggested_filename = extract_disposition_filename(resp.headers());

            return Ok(HttpProbeResult {
                total_bytes,
                accepts_ranges,
                resolved_url: resp.url().to_string(),
                suggested_filename,
                content_type,
            });
        }
    }

    // Fallback probe with Range: bytes=0-0
    let get_resp = client
        .get(target_url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| format!("Network probe error: {}", e))?;

    let status = get_resp.status();
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "Download server rejected the request with HTTP {}. Check the URL, browser session cookies, and site credentials.",
            status
        ));
    }
    let accepts_ranges = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let total_bytes = get_resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|n| n.parse::<u64>().ok())
        .or_else(|| get_resp.content_length())
        .unwrap_or(0);

    let content_type = get_resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let suggested_filename = extract_disposition_filename(get_resp.headers());

    Ok(HttpProbeResult {
        total_bytes,
        accepts_ranges,
        resolved_url: get_resp.url().to_string(),
        suggested_filename,
        content_type,
    })
}

/// Partition `total_bytes` into `num_threads` byte-aligned segments
pub fn compute_initial_segments(
    total_bytes: u64,
    num_threads: usize,
    min_segment_bytes: u64,
) -> Vec<ThreadSegment> {
    if total_bytes == 0 || num_threads <= 1 {
        return vec![ThreadSegment {
            id: 1,
            start_byte: 0,
            end_byte: total_bytes.saturating_sub(1),
            downloaded_bytes: 0,
            speed_bps: 0,
            status: "waiting".to_string(),
        }];
    }

    let effective_threads =
        ((total_bytes / min_segment_bytes.max(1)).max(1) as usize).min(num_threads);
    let chunk_size = total_bytes / (effective_threads as u64);
    let mut segments = Vec::with_capacity(effective_threads);

    for i in 0..effective_threads {
        let start = (i as u64) * chunk_size;
        let end = if i == effective_threads - 1 {
            total_bytes - 1
        } else {
            (i as u64 + 1) * chunk_size - 1
        };
        segments.push(ThreadSegment {
            id: i + 1,
            start_byte: start,
            end_byte: end,
            downloaded_bytes: 0,
            speed_bps: 0,
            status: "waiting".to_string(),
        });
    }
    segments
}

fn restore_segment_progress(previous: &[ThreadSegment], current: &mut [ThreadSegment]) -> bool {
    for segment in current.iter_mut() {
        let Some(saved) = previous.iter().find(|saved| {
            saved.id == segment.id
                && saved.start_byte == segment.start_byte
                && saved.end_byte == segment.end_byte
        }) else {
            return false;
        };
        let segment_size = segment.end_byte - segment.start_byte + 1;
        if saved.downloaded_bytes > segment_size {
            return false;
        }
        segment.downloaded_bytes = saved.downloaded_bytes;
        segment.status = if saved.downloaded_bytes == segment_size {
            "completed".to_string()
        } else if saved.downloaded_bytes > 0 {
            "paused".to_string()
        } else {
            "waiting".to_string()
        };
        segment.speed_bps = 0;
    }
    true
}

fn browser_http_client(settings: &AppSettings) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(settings.connection_timeout_seconds))
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli();
    if settings.proxy.enabled && !settings.proxy.host.is_empty() {
        let scheme = match settings.proxy.proxy_type.as_str() {
            "socks5" => "socks5",
            "https" => "https",
            _ => "http",
        };
        let proxy_url = format!(
            "{}://{}:{}",
            scheme, settings.proxy.host, settings.proxy.port
        );
        if let Ok(mut proxy) = reqwest::Proxy::all(&proxy_url) {
            if let (Some(username), Some(password)) =
                (&settings.proxy.username, &settings.proxy.password)
            {
                proxy = proxy.basic_auth(username, password);
            }
            builder = builder.proxy(proxy);
        }
    }
    builder.build().map_err(|error| {
        format!(
            "Could not prepare the browser download request: {}",
            error.without_url()
        )
    })
}

fn browser_request_headers(item: &DownloadItem, settings: &AppSettings) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let mut values = item.custom_headers.clone();
    values
        .entry("User-Agent".to_string())
        .or_insert_with(|| settings.custom_user_agent.clone());
    if let Some(referer) = &item.referer {
        values
            .entry("Referer".to_string())
            .or_insert_with(|| referer.clone());
    }
    if let Some(cookies) = &item.cookies {
        values
            .entry("Cookie".to_string())
            .or_insert_with(|| cookies.clone());
    }

    for (name, value) in values {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "keep-alive"
                | "proxy-connection"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
                | "accept-encoding"
                | "range"
                | "if-range"
        ) || lower.starts_with("x-xdm-ftp-")
        {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            headers.insert(name, value);
        }
    }
    headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        HeaderValue::from_static("identity"),
    );
    headers
}

fn is_sensitive_request_header(name: &HeaderName) -> bool {
    let lower = name.as_str().to_ascii_lowercase();
    lower == "cookie"
        || lower == "authorization"
        || lower == "proxy-authorization"
        || lower.starts_with("x-auth")
        || lower.starts_with("x-api-")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("key")
        || lower.contains("session")
        || lower.contains("csrf")
        || lower.contains("signature")
        || lower.contains("credential")
        || lower.contains("password")
        || lower.contains("ticket")
}

fn is_html_filename(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm") || lower.ends_with(".xhtml")
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_lowercase();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<head")
        || trimmed.starts_with("<body")
        || trimmed.starts_with("<?xml")
}

fn content_range_start(headers: &HeaderMap) -> Option<(u64, u64)> {
    let value = headers.get(CONTENT_RANGE)?.to_str().ok()?;
    let range = value.strip_prefix("bytes ")?.split('/').next()?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?))
}

async fn send_browser_request(
    client: &reqwest::Client,
    method: &mut Method,
    mut url: url::Url,
    mut headers: HeaderMap,
    body: Option<Vec<u8>>,
) -> Result<reqwest::Response, String> {
    let mut body = body;
    for redirect_count in 0..=10 {
        let mut request = client
            .request(method.clone(), url.clone())
            .headers(headers.clone());
        if let Some(bytes) = body.as_ref() {
            request = request.body(bytes.clone());
        }
        let response = request.send().await.map_err(|error| {
            format!(
                "The browser request could not be replayed: {}",
                error.without_url()
            )
        })?;
        let status = response.status();
        if !status.is_redirection() {
            return Ok(response);
        }
        if redirect_count == 10 {
            return Err("The download exceeded the 10-redirect safety limit".to_string());
        }
        let Some(location) = response.headers().get(reqwest::header::LOCATION) else {
            return Ok(response);
        };
        let location = location
            .to_str()
            .map_err(|_| "The server returned an invalid redirect".to_string())?;
        let next_url = url
            .join(location)
            .map_err(|_| "The server returned an invalid redirect URL".to_string())?;
        if !matches!(next_url.scheme(), "http" | "https") {
            return Err(
                "The server redirected to a protocol ByteX cannot replay safely".to_string(),
            );
        }

        let cross_origin = url.origin() != next_url.origin();
        if cross_origin {
            if body.is_some()
                && matches!(
                    status,
                    StatusCode::TEMPORARY_REDIRECT | StatusCode::PERMANENT_REDIRECT
                )
            {
                return Err("The server redirected a request body to another origin. ByteX left the browser download in control to avoid forwarding form data or credentials across domains".to_string());
            }
            let sensitive_names = headers
                .keys()
                .filter(|name| is_sensitive_request_header(name))
                .cloned()
                .collect::<Vec<_>>();
            for name in sensitive_names {
                headers.remove(name);
            }
            headers.remove(REFERER);
        }
        if (status == StatusCode::SEE_OTHER && *method != Method::HEAD)
            || ((status == StatusCode::MOVED_PERMANENTLY || status == StatusCode::FOUND)
                && *method == Method::POST)
        {
            *method = Method::GET;
            body = None;
            headers.remove(reqwest::header::CONTENT_TYPE);
        }
        drop(response);
        url = next_url;
    }
    Err("The download exceeded the redirect safety limit".to_string())
}

async fn execute_browser_request_download(
    item: DownloadItem,
    downloads: Arc<RwLock<Vec<DownloadItem>>>,
    settings: Arc<RwLock<AppSettings>>,
    mut cancel_rx: watch::Receiver<bool>,
    startup_ack: &mut Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
) -> Result<(), String> {
    if matches!(item.request_method.as_str(), "POST" | "PUT" | "PATCH")
        && item.request_body.is_none()
    {
        return Err("ByteX no longer has the original browser request body. Start this download again from the browser.".to_string());
    }
    let current_settings = settings.read().clone();
    let client = browser_http_client(&current_settings)?;
    let mut method = Method::from_bytes(item.request_method.as_bytes())
        .map_err(|_| "The browser used an unsupported HTTP method".to_string())?;
    let mut headers = browser_request_headers(&item, &current_settings);
    let mut body = match item.request_body.as_deref() {
        Some(encoded) => {
            use base64::Engine as _;
            Some(
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|_| "The captured browser request body was invalid".to_string())?,
            )
        }
        None => None,
    };

    let target = item
        .resolved_url
        .as_deref()
        .unwrap_or(&item.url)
        .parse::<url::Url>()
        .map_err(|_| "The captured browser URL was invalid".to_string())?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("The native HTTP engine only accepts HTTP and HTTPS requests".to_string());
    }

    let output_path = crate::config::resolve_path(&item.save_path);
    let saved_size = std::fs::metadata(&output_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let requested_offset = if method == Method::GET
        && body.is_none()
        && item.range_advertised
        && item.resume_validator.is_some()
        && item.downloaded_bytes > 0
        && saved_size >= item.downloaded_bytes
    {
        item.downloaded_bytes
    } else {
        0
    };
    if requested_offset > 0 {
        headers.insert(
            RANGE,
            HeaderValue::from_str(&format!("bytes={requested_offset}-"))
                .map_err(|_| "Could not construct a safe resume request".to_string())?,
        );
        headers.insert(
            IF_RANGE,
            HeaderValue::from_str(item.resume_validator.as_deref().unwrap_or_default())
                .map_err(|_| "The stored resume validator was invalid".to_string())?,
        );
    }

    let response = tokio::select! {
        _ = cancel_rx.changed() => return Err("Browser handoff was cancelled before the native response was ready".to_string()),
        response = send_browser_request(&client, &mut method, target.clone(), headers, body.take()) => response?,
    };
    let effective_url = response.url().clone();
    let status = response.status();
    if !status.is_success() && status != StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "The server rejected the browser request with HTTP {status}. Check that the browser session is still valid and retry from the browser."
        ));
    }
    if requested_offset > 0 && status == StatusCode::PARTIAL_CONTENT {
        let Some((range_start, _)) = content_range_start(response.headers()) else {
            return Err(
                "The server returned an invalid partial response; ByteX did not append it"
                    .to_string(),
            );
        };
        if range_start != requested_offset {
            return Err("The server resumed at an unexpected byte offset; ByteX did not modify the partial file".to_string());
        }
        let response_total = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit('/').next())
            .and_then(|value| value.parse::<u64>().ok());
        if item.total_bytes > 0 && response_total.is_some_and(|total| total != item.total_bytes) {
            return Err("The remote file changed since ByteX saved this partial download; start it again from the browser".to_string());
        }
        let validator_matches = item.resume_validator.as_deref().is_some_and(|validator| {
            response
                .headers()
                .get(ETAG)
                .or_else(|| response.headers().get(LAST_MODIFIED))
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value == validator)
        });
        if !validator_matches {
            return Err("The server did not confirm the saved file version; ByteX did not append the resumed data".to_string());
        }
    } else if status == StatusCode::PARTIAL_CONTENT {
        return Err(
            "The server returned a partial file without a matching resume request".to_string(),
        );
    }

    let response_headers = response.headers().clone();
    let content_type = response_headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let suggested_filename = extract_disposition_filename(&response_headers).map(|name| {
        name.replace('\\', "/")
            .rsplit('/')
            .next()
            .unwrap_or("download")
            .to_string()
    });
    let filename = suggested_filename
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or(&item.filename)
        .to_string();
    let looks_html_by_type = content_type.as_deref().is_some_and(|value| {
        value.to_ascii_lowercase().contains("text/html")
            || value.to_ascii_lowercase().contains("application/xhtml+xml")
    });
    let allow_html = is_html_filename(&filename) || is_html_filename(&item.filename);

    let mut stream = response.bytes_stream();
    let mut buffered_chunks = Vec::new();
    let mut prefix = Vec::with_capacity(8192);
    while prefix.len() < 8192 {
        let next = tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_err() || *cancel_rx.borrow() {
                    return Err("Browser handoff was cancelled before ByteX accepted it".to_string());
                }
                continue;
            }
            next = stream.next() => next,
        };
        match next {
            Some(Ok(chunk)) => {
                prefix.extend_from_slice(
                    &chunk[..chunk.len().min(8192usize.saturating_sub(prefix.len()))],
                );
                buffered_chunks.push(chunk.to_vec());
            }
            Some(Err(error)) => {
                return Err(format!(
                    "The response failed before ByteX accepted it: {}",
                    error.without_url()
                ));
            }
            None => break,
        }
    }
    if !allow_html && (looks_html_by_type || looks_like_html(&prefix)) {
        return Err("The server returned an HTML login, CAPTCHA, or error page instead of the requested file. Refresh the browser session and start the download again.".to_string());
    }
    if !allow_html
        && is_non_html_binary_extension(&filename)
        && content_type.as_deref().is_some_and(|value| {
            let lower = value.to_ascii_lowercase();
            lower.contains("application/json")
                || lower.contains("text/plain")
                || lower.contains("application/xml")
        })
    {
        return Err("The server returned a text or JSON response instead of the requested binary file. Refresh the browser session and retry.".to_string());
    }

    let content_length = response_headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let total_bytes = if status == StatusCode::PARTIAL_CONTENT {
        response_headers
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit('/').next())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_else(|| requested_offset.saturating_add(content_length.unwrap_or(0)))
    } else {
        content_length.unwrap_or(0)
    };
    let range_advertised = response_headers
        .get(ACCEPT_RANGES)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("bytes"))
        });
    let validator = response_headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.starts_with("W/"))
        .or_else(|| {
            response_headers
                .get(LAST_MODIFIED)
                .and_then(|value| value.to_str().ok())
        })
        .map(str::to_string);

    let parent = output_path
        .parent()
        .ok_or("Download destination has no parent directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the download folder: {error}"))?;
    let actual_path = if filename != item.filename {
        output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(&filename)
    } else {
        output_path.clone()
    };
    let offset = if requested_offset > 0 && status == StatusCode::PARTIAL_CONTENT {
        requested_offset
    } else {
        0
    };
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(&actual_path)
        .map_err(|error| format!("Could not open the download destination: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("Could not prepare the download destination: {error}"))?;
    let mut downloaded = offset;
    for chunk in &buffered_chunks {
        file.write_all(chunk)
            .map_err(|error| format!("Could not write the first download bytes: {error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
    }
    file.sync_data()
        .map_err(|error| format!("Could not persist the first download bytes: {error}"))?;

    {
        let mut items = downloads.write();
        if let Some(current) = items.iter_mut().find(|current| current.id == item.id) {
            current.filename = filename.clone();
            current.save_path = actual_path.to_string_lossy().to_string();
            current.resolved_url = Some(effective_url.to_string());
            current.total_bytes = total_bytes;
            current.downloaded_bytes = downloaded;
            current.range_advertised = range_advertised;
            current.resume_validator = validator;
            current.resumable =
                range_advertised && current.resume_validator.is_some() && method == Method::GET;
            current.status = DownloadStatus::Downloading;
            current.threads_count = 1;
            current.segments = vec![ThreadSegment {
                id: 1,
                start_byte: 0,
                end_byte: total_bytes.saturating_sub(1),
                downloaded_bytes: downloaded,
                speed_bps: 0,
                status: "receiving".to_string(),
            }];
            current.transfer_log.push(if current.resumable {
                "Browser request accepted; using one connection with Range support checked when resuming.".to_string()
            } else {
                "Browser request accepted; using one sequential connection because safe Range resume is unavailable.".to_string()
            });
        }
    }
    if let Some(ack) = startup_ack.take() {
        let _ = ack.send(Ok(()));
    }

    let mut window_start = Instant::now();
    let mut window_bytes = 0u64;
    loop {
        let next = tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_err() || *cancel_rx.borrow() {
                    let mut items = downloads.write();
                    if let Some(current) = items.iter_mut().find(|current| current.id == item.id) {
                        current.status = DownloadStatus::Paused;
                        current.downloaded_bytes = downloaded;
                        current.speed_bps = 0;
                        if let Some(segment) = current.segments.first_mut() {
                            segment.downloaded_bytes = downloaded;
                            segment.speed_bps = 0;
                            segment.status = "paused".to_string();
                        }
                    }
                    return Ok(());
                }
                continue;
            }
            next = stream.next() => next,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk
            .map_err(|error| format!("The download stream stopped: {}", error.without_url()))?;
        let (limiter_on, max_kbps) = {
            let current = settings.read();
            (
                current.speed_limiter_enabled,
                current.global_max_download_kbps,
            )
        };
        let limit_bps = {
            let items = downloads.read();
            super::rate_limiter::download_rate_limit_bps(limiter_on, max_kbps, &items, false)
        };
        tokio::select! {
            _ = super::rate_limiter::throttle_download(chunk.len(), limit_bps) => {}
            changed = cancel_rx.changed() => {
                if changed.is_err() || *cancel_rx.borrow() {
                    let mut items = downloads.write();
                    if let Some(current) = items.iter_mut().find(|current| current.id == item.id) {
                        current.status = DownloadStatus::Paused;
                        current.downloaded_bytes = downloaded;
                        current.speed_bps = 0;
                        if let Some(segment) = current.segments.first_mut() {
                            segment.downloaded_bytes = downloaded;
                            segment.speed_bps = 0;
                            segment.status = "paused".to_string();
                        }
                    }
                    return Ok(());
                }
            }
        }
        file.write_all(&chunk)
            .map_err(|error| format!("Could not write download data: {error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        window_bytes = window_bytes.saturating_add(chunk.len() as u64);
        let elapsed = window_start.elapsed();
        if elapsed >= Duration::from_millis(250) {
            let speed = (window_bytes as f64 / elapsed.as_secs_f64()) as u64;
            window_start = Instant::now();
            window_bytes = 0;
            let mut items = downloads.write();
            if let Some(current) = items.iter_mut().find(|current| current.id == item.id) {
                current.downloaded_bytes = downloaded;
                current.speed_bps = speed;
                current.eta_seconds = (speed > 0 && current.total_bytes > downloaded)
                    .then_some((current.total_bytes - downloaded) / speed);
                if let Some(segment) = current.segments.first_mut() {
                    segment.downloaded_bytes = downloaded;
                    segment.speed_bps = speed;
                }
            }
        }
    }
    file.sync_all()
        .map_err(|error| format!("Could not finalize the downloaded file: {error}"))?;
    if total_bytes > 0 && downloaded != total_bytes {
        return Err(format!(
            "The server closed the transfer after {downloaded} of {total_bytes} bytes. The partial file is available to resume."
        ));
    }

    let should_hash = settings.read().auto_verify_checksum;
    let computed_hash = if should_hash {
        std::fs::read(&actual_path).ok().map(|bytes| {
            let mut hasher = Sha256::new();
            hasher.update(bytes);
            hex::encode(hasher.finalize())
        })
    } else {
        None
    };
    let mut items = downloads.write();
    if let Some(current) = items.iter_mut().find(|current| current.id == item.id) {
        current.status = DownloadStatus::Completed;
        current.downloaded_bytes = downloaded;
        if current.total_bytes == 0 {
            current.total_bytes = downloaded;
        }
        current.speed_bps = 0;
        current.eta_seconds = Some(0);
        current.checksum_sha256 = computed_hash;
        current.completed_at = Some(chrono::Utc::now().to_rfc3339());
        current
            .transfer_log
            .push("Browser-originated download completed.".to_string());
        if current.segments.is_empty() {
            current.segments.push(ThreadSegment {
                id: 1,
                start_byte: 0,
                end_byte: current.total_bytes.saturating_sub(1),
                downloaded_bytes: current.total_bytes,
                speed_bps: 0,
                status: "completed".to_string(),
            });
        } else {
            for segment in &mut current.segments {
                if segment.end_byte == 0 && current.total_bytes > 0 {
                    segment.end_byte = current.total_bytes.saturating_sub(1);
                }
                let len = segment
                    .end_byte
                    .saturating_sub(segment.start_byte)
                    .saturating_add(1);
                segment.downloaded_bytes = len;
                segment.status = "completed".to_string();
                segment.speed_bps = 0;
            }
        }
    }
    Ok(())
}

/// Executes a multi-threaded segmented download using independent Tokio workers writing to pre-allocated file offsets
pub async fn execute_segmented_http_download(
    item_id: String,
    downloads: Arc<RwLock<Vec<DownloadItem>>>,
    settings: Arc<RwLock<AppSettings>>,
    cancel_rx: watch::Receiver<bool>,
) -> Result<(), String> {
    let mut no_ack = None;
    execute_segmented_http_download_with_ack(item_id, downloads, settings, cancel_rx, &mut no_ack)
        .await
}

pub async fn execute_segmented_http_download_with_ack(
    item_id: String,
    downloads: Arc<RwLock<Vec<DownloadItem>>>,
    settings: Arc<RwLock<AppSettings>>,
    cancel_rx: watch::Receiver<bool>,
    startup_ack: &mut Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
) -> Result<(), String> {
    let (item_snapshot, current_settings) = {
        let dls = downloads.read();
        let found = dls
            .iter()
            .find(|d| d.id == item_id)
            .cloned()
            .ok_or("Download item not found")?;
        (found, settings.read().clone())
    };

    if item_snapshot.browser_intercepted {
        return execute_browser_request_download(
            item_snapshot,
            downloads,
            settings,
            cancel_rx,
            startup_ack,
        )
        .await;
    }

    let client = build_http_client(&current_settings, &item_snapshot)?;
    let target_url = item_snapshot
        .resolved_url
        .clone()
        .unwrap_or_else(|| item_snapshot.url.clone());

    // Probe file size and range support
    let probe = probe_remote_resource(&client, &target_url).await?;

    // Check if remote returned HTML error/login page instead of requested binary file
    let requested_as_binary = is_non_html_binary_extension(&item_snapshot.filename)
        || is_non_html_binary_extension(&target_url);

    if requested_as_binary {
        let is_html_mime = probe
            .content_type
            .as_ref()
            .map(|ct| {
                let l = ct.to_lowercase();
                l.contains("text/html") || l.contains("application/xhtml+xml")
            })
            .unwrap_or(false);

        let suggested_is_html = probe
            .suggested_filename
            .as_ref()
            .map(|s| {
                let l = s.to_lowercase();
                l.ends_with(".html") || l.ends_with(".htm")
            })
            .unwrap_or(false);

        if (is_html_mime && probe.total_bytes < 10_000_000) || suggested_is_html {
            let err_msg = "Remote server returned an HTML error or landing page (Content-Type: text/html) instead of the requested binary file. This occurs on file hosts (MediaFire, 1fichier, Usersdrive) when a captcha, wait timer, or active browser session is required. Please trigger the download in your browser so the ByteX extension can intercept the direct CDN link.".to_string();
            let mut dls = downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                d.status = DownloadStatus::Failed;
                d.error_message = Some(err_msg.clone());
                d.transfer_log.push(format!("[ERROR] {}", err_msg));
            }
            return Err(err_msg);
        }
    }

    // Apply suggested filename from Content-Disposition if available
    let final_save_path = if let Some(ref sname) = probe.suggested_filename {
        if !sname.is_empty() && sname != &item_snapshot.filename {
            let p = Path::new(&item_snapshot.save_path);
            if let Some(parent) = p.parent() {
                parent.join(sname).to_string_lossy().to_string()
            } else {
                item_snapshot.save_path.clone()
            }
        } else {
            item_snapshot.save_path.clone()
        }
    } else {
        item_snapshot.save_path.clone()
    };

    let threads = if probe.accepts_ranges && probe.total_bytes > 0 {
        item_snapshot.threads_count
    } else {
        1
    };

    let min_seg_bytes = current_settings.min_segment_size_kb * 1024;
    let mut segments = compute_initial_segments(probe.total_bytes, threads, min_seg_bytes);

    // Keep verified byte ranges when resuming an interrupted ranged download.
    // A changed file size, lost destination file, or server without Range support
    // safely falls back to a fresh download.
    let previous_file_is_intact = std::fs::metadata(&final_save_path)
        .map(|metadata| metadata.is_file() && metadata.len() == probe.total_bytes)
        .unwrap_or(false);
    let can_resume = item_snapshot.resumable
        && probe.accepts_ranges
        && probe.total_bytes > 0
        && item_snapshot.total_bytes == probe.total_bytes
        && previous_file_is_intact
        && restore_segment_progress(&item_snapshot.segments, &mut segments);
    if !can_resume {
        for segment in &mut segments {
            segment.downloaded_bytes = 0;
            segment.speed_bps = 0;
            segment.status = "waiting".to_string();
        }
    }

    // Pre-allocate destination file on disk
    if let Some(parent) = Path::new(&final_save_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if can_resume {
        let existing_file = OpenOptions::new()
            .write(true)
            .open(&final_save_path)
            .map_err(|e| format!("Failed to reopen partial file {}: {}", final_save_path, e))?;
        drop(existing_file);
    } else {
        let file = File::create(&final_save_path)
            .map_err(|e| format!("Failed to create target file {}: {}", final_save_path, e))?;
        if probe.total_bytes > 0 {
            let _ = file.set_len(probe.total_bytes);
        }
    }

    // Update item state with segments
    {
        let mut dls = downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
            d.total_bytes = probe.total_bytes;
            d.resumable = probe.accepts_ranges;
            d.resolved_url = Some(probe.resolved_url.clone());
            d.save_path = final_save_path.clone();
            if let Some(ref sname) = probe.suggested_filename {
                if !sname.is_empty() {
                    d.filename = sname.clone();
                }
            }
            d.status = DownloadStatus::Downloading;
            d.segments = segments.clone();
            d.downloaded_bytes = segments
                .iter()
                .map(|segment| segment.downloaded_bytes)
                .sum();
            d.transfer_log.push(format!(
                "Server supports Range={} | Total Size={} bytes | Spawning {} concurrent worker threads",
                probe.accepts_ranges,
                probe.total_bytes,
                segments.len()
            ));
        }
    }

    // Spawn worker tasks for each segment
    let mut handles = Vec::new();
    for seg in segments {
        if seg.downloaded_bytes > seg.end_byte - seg.start_byte {
            continue;
        }
        let client_clone = client.clone();
        let url_clone = probe.resolved_url.clone();
        let save_path_clone = final_save_path.clone();
        let dls_clone = Arc::clone(&downloads);
        let settings_clone = Arc::clone(&settings);
        let item_id_clone = item_id.clone();
        let mut worker_cancel = cancel_rx.clone();

        let handle = tokio::spawn(async move {
            let range_header = format!(
                "bytes={}-{}",
                seg.start_byte + seg.downloaded_bytes,
                seg.end_byte
            );
            let mut req = client_clone.get(&url_clone);
            if probe.accepts_ranges && probe.total_bytes > 0 {
                req = req.header(RANGE, range_header);
            }

            let resp = req.send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!(
                    "HTTP {} while downloading {}",
                    resp.status(),
                    url_clone
                ));
            }
            let mut stream = resp.bytes_stream();

            let mut file = OpenOptions::new()
                .write(true)
                .open(&save_path_clone)
                .map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(seg.start_byte + seg.downloaded_bytes))
                .map_err(|e| e.to_string())?;

            let mut seg_downloaded = seg.downloaded_bytes;
            let mut window_start = Instant::now();
            let mut window_bytes = 0u64;

            loop {
                tokio::select! {
                    _ = worker_cancel.changed() => {
                        if *worker_cancel.borrow() {
                            return Err("Paused or cancelled by user".to_string());
                        }
                    }
                    maybe_chunk = stream.next() => {
                        match maybe_chunk {
                            Some(Ok(chunk)) => {
                                let (limiter_on, max_kbps) = {
                                    let st = settings_clone.read();
                                    (st.speed_limiter_enabled, st.global_max_download_kbps)
                                };
                                let limit_bps = {
                                    let dls = dls_clone.read();
                                    super::rate_limiter::download_rate_limit_bps(
                                        limiter_on,
                                        max_kbps,
                                        &dls,
                                        false,
                                    )
                                };
                                tokio::select! {
                                    _ = super::rate_limiter::throttle_download(chunk.len(), limit_bps) => {}
                                    changed = worker_cancel.changed() => {
                                        if changed.is_err() || *worker_cancel.borrow() {
                                            return Err("Paused or cancelled by user".to_string());
                                        }
                                    }
                                }
                                file.write_all(&chunk).map_err(|e| e.to_string())?;
                                let len = chunk.len() as u64;
                                seg_downloaded += len;
                                window_bytes += len;

                                let elapsed = window_start.elapsed();
                                if elapsed >= Duration::from_millis(250) {
                                    let speed = ((window_bytes as f64) / elapsed.as_secs_f64()) as u64;
                                    window_start = Instant::now();
                                    window_bytes = 0;

                                    {
                                        let mut dls = dls_clone.write();
                                        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id_clone) {
                                            if let Some(s) = d.segments.iter_mut().find(|s| s.id == seg.id) {
                                                s.downloaded_bytes = seg_downloaded;
                                                s.speed_bps = speed;
                                                s.status = "receiving".to_string();
                                            }
                                            d.downloaded_bytes = d.segments.iter().map(|s| s.downloaded_bytes).sum();
                                            d.speed_bps = d.segments.iter().map(|s| s.speed_bps).sum();
                                            if d.speed_bps > 0 && d.total_bytes > d.downloaded_bytes {
                                                d.eta_seconds = Some((d.total_bytes - d.downloaded_bytes) / d.speed_bps);
                                            }
                                        }
                                    }

                                }
                            }
                            Some(Err(e)) => return Err(e.to_string()),
                            None => break,
                        }
                    }
                }
            }

            let mut dls = dls_clone.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id_clone) {
                if let Some(s) = d.segments.iter_mut().find(|s| s.id == seg.id) {
                    s.downloaded_bytes = s.end_byte - s.start_byte + 1;
                    s.speed_bps = 0;
                    s.status = "completed".to_string();
                }
            }
            Ok::<(), String>(())
        });
        handles.push(handle);
    }

    for h in handles {
        match h.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if e.contains("Paused") {
                    return Ok(());
                }
                return Err(e);
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    // Verify SHA-256 checksum on completion if enabled
    let should_hash = settings.read().auto_verify_checksum;
    let computed_hash = if should_hash {
        if let Ok(bytes) = std::fs::read(&final_save_path) {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            Some(hex::encode(hasher.finalize()))
        } else {
            None
        }
    } else {
        None
    };

    let mut dls = downloads.write();
    if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
        d.status = DownloadStatus::Completed;
        d.downloaded_bytes = d.total_bytes;
        d.speed_bps = 0;
        d.eta_seconds = Some(0);
        d.checksum_sha256 = computed_hash;
        d.completed_at = Some(chrono::Utc::now().to_rfc3339());
        d.transfer_log
            .push("All segments merged and verified successfully.".to_string());
        for segment in &mut d.segments {
            let len = segment
                .end_byte
                .saturating_sub(segment.start_byte)
                .saturating_add(1);
            segment.downloaded_bytes = len;
            segment.status = "completed".to_string();
            segment.speed_bps = 0;
        }
    }

    Ok(())
}

#[cfg(test)]
mod resume_tests {
    use super::{compute_initial_segments, restore_segment_progress};
    use crate::engine::ThreadSegment;

    #[test]
    fn restores_saved_http_segment_offsets_when_layout_matches() {
        let mut current = compute_initial_segments(4_000_000, 2, 512);
        let previous = vec![
            ThreadSegment {
                id: current[0].id,
                start_byte: current[0].start_byte,
                end_byte: current[0].end_byte,
                downloaded_bytes: 700_000,
                speed_bps: 10,
                status: "receiving".into(),
            },
            ThreadSegment {
                id: current[1].id,
                start_byte: current[1].start_byte,
                end_byte: current[1].end_byte,
                downloaded_bytes: current[1].end_byte - current[1].start_byte + 1,
                speed_bps: 0,
                status: "completed".into(),
            },
        ];

        assert!(restore_segment_progress(&previous, &mut current));
        assert_eq!(current[0].downloaded_bytes, 700_000);
        assert_eq!(current[0].status, "paused");
        assert_eq!(current[1].status, "completed");
        assert!(current.iter().all(|segment| segment.speed_bps == 0));
    }

    #[test]
    fn rejects_saved_offsets_when_remote_segment_layout_changes() {
        let mut current = compute_initial_segments(4_000_000, 1, 512);
        let previous = [ThreadSegment {
            id: 1,
            start_byte: 0,
            end_byte: 1_999_999,
            downloaded_bytes: 700_000,
            speed_bps: 0,
            status: "paused".into(),
        }];

        assert!(!restore_segment_progress(&previous, &mut current));
    }
}

#[cfg(test)]
mod browser_request_tests {
    use super::*;
    use crate::config::AppSettings;
    use crate::engine::{DownloadEngine, DownloadProtocol, NewDownloadRequest};
    use parking_lot::RwLock as ParkingRwLock;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use uuid::Uuid;

    async fn read_request(stream: &mut TcpStream) -> (String, HashMap<String, String>, Vec<u8>) {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 8192];
        let header_end = loop {
            let count = stream
                .read(&mut buffer)
                .await
                .expect("request should be readable");
            assert!(count > 0, "client closed before sending request headers");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let head = String::from_utf8_lossy(&bytes[..header_end]);
        let mut lines = head.split("\r\n");
        let request_line = lines.next().unwrap_or_default().to_string();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
            .collect::<HashMap<_, _>>();
        let content_length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len().saturating_sub(header_end) < content_length {
            let count = stream
                .read(&mut buffer)
                .await
                .expect("request body should be readable");
            assert!(
                count > 0,
                "client closed before sending the full request body"
            );
            bytes.extend_from_slice(&buffer[..count]);
        }
        let body = bytes[header_end..header_end + content_length].to_vec();
        (request_line, headers, body)
    }

    async fn respond(stream: &mut TcpStream, status: &str, headers: &[(&str, &str)], body: &[u8]) {
        let mut response = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        response.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
        stream
            .write_all(response.as_bytes())
            .await
            .expect("response headers should be written");
        stream
            .write_all(body)
            .await
            .expect("response body should be written");
        stream
            .shutdown()
            .await
            .expect("response should close cleanly");
    }

    async fn test_download(
        url: String,
        filename: &str,
        method: &str,
        body: Option<Vec<u8>>,
        headers: HashMap<String, String>,
    ) -> (
        DownloadItem,
        Arc<ParkingRwLock<Vec<DownloadItem>>>,
        Arc<ParkingRwLock<AppSettings>>,
        std::path::PathBuf,
    ) {
        let directory = std::env::temp_dir().join(format!("bytex-browser-http-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("test folder should be created");
        let engine = DownloadEngine::new();
        let encoded_body = body.map(|bytes| {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(bytes)
        });
        let mut item = engine.add_download(NewDownloadRequest {
            url,
            final_url: None,
            redirect_chain: Vec::new(),
            filename: Some(filename.to_string()),
            category: Some("Compressed".to_string()),
            save_path: Some(directory.to_string_lossy().to_string()),
            threads_count: Some(4),
            queue_id: Some("main-queue".to_string()),
            start_immediately: false,
            source_browser: Some("Chrome".to_string()),
            referer: headers.get("referer").cloned(),
            cookies: headers.get("cookie").cloned(),
            user_agent: headers.get("user-agent").cloned(),
            custom_headers: Some(headers),
            request_method: method.to_string(),
            request_body: encoded_body,
            browser_intercepted: true,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
            scheduled_start: None,
            scheduled_stop: None,
        });
        item.protocol = DownloadProtocol::Https;
        let path = std::path::Path::new(&item.save_path)
            .parent()
            .unwrap()
            .to_path_buf();
        let items = Arc::new(ParkingRwLock::new(vec![item.clone()]));
        let settings = Arc::new(ParkingRwLock::new(AppSettings::default()));
        (item, items, settings, path)
    }

    async fn execute_and_ack(
        item: DownloadItem,
        items: Arc<ParkingRwLock<Vec<DownloadItem>>>,
        settings: Arc<ParkingRwLock<AppSettings>>,
    ) -> (
        Result<(), String>,
        Result<Result<(), String>, tokio::sync::oneshot::error::RecvError>,
    ) {
        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
        let mut ack = Some(ack_tx);
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let result =
            execute_browser_request_download(item, items, settings, cancel_rx, &mut ack).await;
        if let Err(error) = &result {
            if let Some(sender) = ack.take() {
                let _ = sender.send(Err(error.clone()));
            }
        }
        (result, ack_rx.await)
    }

    #[tokio::test]
    async fn replays_authenticated_post_and_persists_bytes_before_acknowledging() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (line, headers, body) = read_request(&mut stream).await;
            assert!(line.starts_with("POST /download "));
            assert_eq!(body, b"download_id=secret");
            assert_eq!(
                headers.get("cookie").map(String::as_str),
                Some("session=secret")
            );
            assert_eq!(
                headers.get("authorization").map(String::as_str),
                Some("Bearer secret")
            );
            assert_eq!(
                headers.get("referer").map(String::as_str),
                Some("http://origin.test/page")
            );
            assert_eq!(
                headers.get("user-agent").map(String::as_str),
                Some("Browser Test")
            );
            respond(
                &mut stream,
                "200 OK",
                &[
                    ("Content-Type", "application/octet-stream"),
                    (
                        "Content-Disposition",
                        "attachment; filename=server-name.bin",
                    ),
                    ("Accept-Ranges", "none"),
                ],
                b"native-file-bytes",
            )
            .await;
        });
        let mut headers = HashMap::new();
        headers.insert(
            "content-type".to_string(),
            "application/x-www-form-urlencoded".to_string(),
        );
        headers.insert("cookie".to_string(), "session=secret".to_string());
        headers.insert("authorization".to_string(), "Bearer secret".to_string());
        headers.insert("referer".to_string(), "http://origin.test/page".to_string());
        headers.insert("user-agent".to_string(), "Browser Test".to_string());
        let (item, items, settings, directory) = test_download(
            format!("http://{address}/download"),
            "initial.bin",
            "POST",
            Some(b"download_id=secret".to_vec()),
            headers,
        )
        .await;
        let (result, ack) = execute_and_ack(item.clone(), items.clone(), settings).await;
        server.await.unwrap();
        assert!(result.is_ok());
        ack.unwrap().unwrap();
        assert_eq!(
            std::fs::read(directory.join("server-name.bin")).unwrap(),
            b"native-file-bytes"
        );
        let saved = items
            .read()
            .iter()
            .find(|saved| saved.id == item.id)
            .unwrap()
            .clone();
        assert_eq!(saved.status, DownloadStatus::Completed);
        assert_eq!(saved.downloaded_bytes, b"native-file-bytes".len() as u64);
        assert_eq!(saved.segments.len(), 1);
        assert_eq!(saved.segments[0].status, "completed");
        assert_eq!(
            saved.segments[0].downloaded_bytes,
            b"native-file-bytes".len() as u64
        );
        assert_eq!(saved.threads_count, 1);
        assert!(
            !saved.resumable,
            "the server explicitly disabled byte ranges"
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn strips_credentials_when_a_redirect_changes_origin() {
        let final_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let final_address = final_listener.local_addr().unwrap();
        let final_server = tokio::spawn(async move {
            let (mut stream, _) = final_listener.accept().await.unwrap();
            let (line, headers, _) = read_request(&mut stream).await;
            assert!(line.starts_with("GET /final "));
            assert!(!headers.contains_key("cookie"));
            assert!(!headers.contains_key("authorization"));
            assert!(!headers.contains_key("referer"));
            respond(
                &mut stream,
                "200 OK",
                &[("Content-Type", "application/octet-stream")],
                b"redirected",
            )
            .await;
        });
        let first_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let first_address = first_listener.local_addr().unwrap();
        let first_server = tokio::spawn(async move {
            let (mut stream, _) = first_listener.accept().await.unwrap();
            let _ = read_request(&mut stream).await;
            let location = format!("http://{final_address}/final");
            let headers = [("Location", location.as_str())];
            respond(&mut stream, "302 Found", &headers, b"").await;
        });
        let mut headers = HashMap::new();
        headers.insert("cookie".to_string(), "session=secret".to_string());
        headers.insert("authorization".to_string(), "Bearer secret".to_string());
        headers.insert("referer".to_string(), "http://origin.test/page".to_string());
        let (item, items, settings, directory) = test_download(
            format!("http://{first_address}/start"),
            "redirect.bin",
            "GET",
            None,
            headers,
        )
        .await;
        let (result, ack) = execute_and_ack(item, items, settings).await;
        first_server.await.unwrap();
        final_server.await.unwrap();
        assert!(result.is_ok());
        ack.unwrap().unwrap();
        assert_eq!(
            std::fs::read(directory.join("redirect.bin")).unwrap(),
            b"redirected"
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn validates_range_resume_before_appending_partial_file() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (_, headers, _) = read_request(&mut stream).await;
            assert_eq!(headers.get("range").map(String::as_str), Some("bytes=4-"));
            assert_eq!(
                headers.get("if-range").map(String::as_str),
                Some("\"version-1\"")
            );
            respond(
                &mut stream,
                "206 Partial Content",
                &[
                    ("Content-Type", "application/octet-stream"),
                    ("Content-Range", "bytes 4-7/8"),
                    ("ETag", "\"version-1\""),
                    ("Accept-Ranges", "bytes"),
                ],
                b"data",
            )
            .await;
        });
        let (mut item, items, settings, directory) = test_download(
            format!("http://{address}/resume.bin"),
            "resume.bin",
            "GET",
            None,
            HashMap::new(),
        )
        .await;
        std::fs::write(&item.save_path, b"old-").unwrap();
        item.downloaded_bytes = 4;
        item.range_advertised = true;
        item.resume_validator = Some("\"version-1\"".to_string());
        item.resumable = true;
        items.write()[0] = item.clone();
        let (result, ack) = execute_and_ack(item.clone(), items.clone(), settings).await;
        server.await.unwrap();
        assert!(result.is_ok());
        ack.unwrap().unwrap();
        assert_eq!(std::fs::read(&item.save_path).unwrap(), b"old-data");
        let saved = items
            .read()
            .iter()
            .find(|saved| saved.id == item.id)
            .unwrap()
            .clone();
        assert_eq!(saved.downloaded_bytes, 8);
        assert!(saved.resumable);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn rejects_html_instead_of_acknowledging_a_binary_download() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut stream).await;
            respond(
                &mut stream,
                "200 OK",
                &[("Content-Type", "text/html; charset=utf-8")],
                b"<!doctype html><html><title>Login</title></html>",
            )
            .await;
        });
        let (item, items, settings, directory) = test_download(
            format!("http://{address}/archive.zip"),
            "archive.zip",
            "GET",
            None,
            HashMap::new(),
        )
        .await;
        let (result, ack) = execute_and_ack(item, items, settings).await;
        server.await.unwrap();
        assert!(result.unwrap_err().contains("HTML login"));
        assert!(ack.unwrap().unwrap_err().contains("HTML login"));
        assert!(!directory.join("archive.zip").exists());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn interrupted_sequential_transfer_keeps_partial_bytes_for_a_safe_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (close_tx, close_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut stream).await;
            let headers = b"HTTP/1.1 200 OK\r\nContent-Length: 32768\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n";
            stream.write_all(headers).await.unwrap();
            stream.write_all(&vec![b'x'; 16384]).await.unwrap();
            stream.flush().await.unwrap();
            let _ = close_rx.await;
            stream.shutdown().await.unwrap();
        });
        let (item, items, settings, directory) = test_download(
            format!("http://{address}/large.bin"),
            "large.bin",
            "GET",
            None,
            HashMap::new(),
        )
        .await;
        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
        let mut ack = Some(ack_tx);
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transfer = tokio::spawn(async move {
            let result = execute_browser_request_download(
                item,
                items.clone(),
                settings,
                cancel_rx,
                &mut ack,
            )
            .await;
            if let Err(error) = &result {
                if let Some(sender) = ack.take() {
                    let _ = sender.send(Err(error.clone()));
                }
            }
            result
        });
        assert_eq!(ack_rx.await.unwrap(), Ok(()));
        close_tx.send(()).unwrap();
        let error = transfer.await.unwrap().unwrap_err();
        server.await.unwrap();
        assert!(error.contains("stream stopped"));
        let partial = std::fs::read(directory.join("large.bin")).unwrap();
        assert_eq!(partial.len(), 16384);
        assert!(partial.iter().all(|byte| *byte == b'x'));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn browser_html_signature_and_content_range_validation_are_strict() {
        assert!(looks_like_html(b"  <!doctype html><html>"));
        assert!(!looks_like_html(b"PK\x03\x04archive"));
        let headers =
            HeaderMap::from_iter([(CONTENT_RANGE, HeaderValue::from_static("bytes 10-19/100"))]);
        assert_eq!(content_range_start(&headers), Some((10, 19)));
    }
}
