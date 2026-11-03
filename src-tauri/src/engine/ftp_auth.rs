//! FTP & Authenticated File-Sharing Resolver (Usersdrive, 1fichier, MediaFire, etc.)
//! Supports:
//! - Anonymous & Authenticated FTP transfers with guarded `REST` byte-offset resumption
//! - Automatic Site Credential matching from ByteX's saved site logins (`*.usersdrive.com`, etc.)
//! - Usersdrive (`https://usersdrive.com/<id>.html`) 2-step form/cookie resolution and direct CDN extraction
//! - Cookie, Bearer Token, and Basic Auth injection

use async_std::io::ReadExt;
use regex::Regex;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use suppaftp::AsyncRustlsFtpStream;

use crate::config::{AppSettings, SiteCredential};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedAuthDownload {
    pub direct_url: String,
    pub filename: Option<String>,
    pub cookies: Option<String>,
    pub auth_header: Option<String>,
    pub referer: String,
    pub resolver_note: String,
}

/// Finds a matching credential from the user's Site Logins Vault based on host wildcard pattern
pub fn match_site_credential<'a>(
    url: &str,
    credentials: &'a [SiteCredential],
) -> Option<&'a SiteCredential> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();

    credentials.iter().find(|cred| {
        if !cred.enabled {
            return false;
        }
        let pat = cred.host_pattern.trim().to_lowercase();
        if let Some(suffix) = pat.strip_prefix("*.") {
            host == suffix || host.ends_with(&format!(".{}", suffix))
        } else {
            host == pat
        }
    })
}

pub fn resolve_credential_secret(c: &SiteCredential) -> String {
    if !c.password_or_token.is_empty() {
        return c.password_or_token.clone();
    }
    let keyring = crate::security::KeyringStore::new();
    keyring
        .get_secret(&format!("site_cred:{}", c.id))
        .unwrap_or_default()
}

/// Applies a matching saved site login to a new download. Browser-provided
/// cookies and explicitly supplied headers take precedence over saved values.
pub fn apply_site_credential(
    url: &str,
    credentials: &[SiteCredential],
    headers: &mut std::collections::HashMap<String, String>,
    cookies: &mut Option<String>,
) -> Option<String> {
    let credential = match_site_credential(url, credentials)?;

    for (name, value) in &credential.custom_headers {
        if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
            headers.insert(name.clone(), value.clone());
        }
    }

    let secret = resolve_credential_secret(credential);

    if cookies.is_none() {
        *cookies = credential.cookies.clone();
        if cookies.is_none() && credential.site_type == "cookie" && !secret.is_empty() {
            *cookies = Some(secret.clone());
        }
    }

    match credential.site_type.as_str() {
        "http_basic"
            if !headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("Authorization")) =>
        {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", credential.username, secret));
            headers.insert("Authorization".to_string(), format!("Basic {encoded}"));
        }
        "bearer"
            if !headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("Authorization")) =>
        {
            let token = secret.trim();
            let value = if token
                .get(..7)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("Bearer "))
            {
                token.to_string()
            } else {
                format!("Bearer {token}")
            };
            headers.insert("Authorization".to_string(), value);
        }
        "ftp" => {
            // FTP credentials are resolved directly by the FTP worker from the
            // same saved entry, so they never need to be copied into HTTP headers.
        }
        _ => {}
    }

    Some(credential.id.clone())
}

/// Resolves Usersdrive (`https://usersdrive.com/<code>.html`) or other XFileSharing-based file hosts
/// using either browser-forwarded cookies or stored Site Logins credentials.
pub async fn resolve_usersdrive_or_filehost(
    page_url: &str,
    settings: &AppSettings,
    forwarded_cookies: Option<String>,
) -> Result<ResolvedAuthDownload, String> {
    let matched_cred = match_site_credential(page_url, &settings.site_credentials);
    let effective_cookies =
        forwarded_cookies.or_else(|| matched_cred.and_then(|c| c.cookies.clone()));

    let client = reqwest::Client::builder()
        .user_agent(&settings.custom_user_agent)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut get_req = client.get(page_url).header(REFERER, page_url);
    if let Some(ref c) = effective_cookies {
        get_req = get_req.header(COOKIE, c);
    }

    let resp = get_req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch file host page: {}", e))?;

    // If the URL is already a direct binary stream (e.g., redirected directly because of premium cookie)
    if let Some(ct) = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
    {
        if !ct.contains("text/html") {
            return Ok(ResolvedAuthDownload {
                direct_url: resp.url().to_string(),
                filename: None,
                cookies: effective_cookies,
                auth_header: None,
                referer: page_url.to_string(),
                resolver_note: "Direct stream resolved via active premium session".to_string(),
            });
        }
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;

    // Check for MediaFire direct CDN link
    if page_url.contains("mediafire.com") {
        let mf_re = Regex::new(r#"https?://download[0-9]*\.mediafire\.com/[^\s"'<>]+"#)
            .map_err(|e| e.to_string())?;
        if let Some(mat) = mf_re.find(&html) {
            let direct_url = mat.as_str().to_string();
            let filename = direct_url
                .split('?')
                .next()
                .and_then(|u| u.rsplit('/').next())
                .map(|s| s.to_string());
            return Ok(ResolvedAuthDownload {
                direct_url,
                filename,
                cookies: effective_cookies,
                auth_header: None,
                referer: page_url.to_string(),
                resolver_note: "Extracted MediaFire direct CDN download link from page".to_string(),
            });
        }
    }

    // Check for 1fichier direct download link
    if page_url.contains("1fichier.com") {
        let f1_re = Regex::new(r#"https?://[a-zA-Z0-9.\-]+\.1fichier\.com/[^\s"'<>]+"#)
            .map_err(|e| e.to_string())?;
        for mat in f1_re.find_iter(&html) {
            let candidate = mat.as_str();
            if !candidate.contains("auth.1fichier.com")
                && !candidate.ends_with(".css")
                && !candidate.ends_with(".js")
            {
                let direct_url = candidate.to_string();
                let filename = direct_url
                    .split('?')
                    .next()
                    .and_then(|u| u.rsplit('/').next())
                    .map(|s| s.to_string());
                return Ok(ResolvedAuthDownload {
                    direct_url,
                    filename,
                    cookies: effective_cookies,
                    auth_header: None,
                    referer: page_url.to_string(),
                    resolver_note: "Extracted 1fichier direct download link from page".to_string(),
                });
            }
        }
    }

    // Check for direct download link in HTML (`https://*.usersdrive.com/d/...` or `<a href=".../d/..."`)
    let direct_re =
        Regex::new(r#"https?://[a-zA-Z0-9.\-]*usersdrive\.com/d/[a-zA-Z0-9]+/[^\s"'<>]+"#)
            .map_err(|e| e.to_string())?;

    if let Some(mat) = direct_re.find(&html) {
        let direct_url = mat.as_str().to_string();
        let filename = direct_url.rsplit('/').next().map(|s| s.to_string());
        return Ok(ResolvedAuthDownload {
            direct_url,
            filename,
            cookies: effective_cookies,
            auth_header: None,
            referer: page_url.to_string(),
            resolver_note: "Extracted Usersdrive direct CDN stream URL from page".to_string(),
        });
    }

    // Parse XFileSharing POST form fields (`op`, `id`, `rand`, `referer`, `method_free`, `method_premium`)
    let id_re = Regex::new(r#"name=["']id["']\s+value=["']([^"']+)["']"#).unwrap();
    let rand_re = Regex::new(r#"name=["']rand["']\s+value=["']([^"']+)["']"#).unwrap();

    if let Some(id_cap) = id_re.captures(&html) {
        let file_id = id_cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let rand_val = rand_re
            .captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .unwrap_or("");

        let form = vec![
            ("op", "download2"),
            ("id", file_id),
            ("rand", rand_val),
            ("referer", page_url),
            ("method_free", "Free Download"),
            ("down_script", "1"),
        ];

        let mut post_req = client
            .post(page_url)
            .header(REFERER, page_url)
            .header(USER_AGENT, &settings.custom_user_agent)
            .form(&form);

        if let Some(ref c) = effective_cookies {
            post_req = post_req.header(COOKIE, c);
        }

        if let Ok(post_resp) = post_req.send().await {
            if let Ok(post_html) = post_resp.text().await {
                if let Some(mat) = direct_re.find(&post_html) {
                    let direct_url = mat.as_str().to_string();
                    let filename = direct_url.rsplit('/').next().map(|s| s.to_string());
                    return Ok(ResolvedAuthDownload {
                        direct_url,
                        filename,
                        cookies: effective_cookies,
                        auth_header: None,
                        referer: page_url.to_string(),
                        resolver_note: "Resolved Usersdrive stage-2 POST form to CDN link"
                            .to_string(),
                    });
                }
            }
        }
    }

    Ok(ResolvedAuthDownload {
        direct_url: page_url.to_string(),
        filename: None,
        cookies: effective_cookies,
        auth_header: None,
        referer: page_url.to_string(),
        resolver_note: "Using authenticated session passthrough".to_string(),
    })
}

/// Downloads a file over FTP / FTPS with optional credential lookup and byte-offset resumption
pub async fn download_via_ftp(
    ftp_url: &str,
    save_path: &str,
    resume_offset: u64,
    settings: &AppSettings,
) -> Result<u64, String> {
    let parsed = url::Url::parse(ftp_url).map_err(|e| format!("Invalid FTP URL: {}", e))?;
    if parsed.scheme() == "ftps" {
        return Err("FTPS is not supported by the current FTP transport; the request was not sent because credentials could be exposed".to_string());
    }
    let host = parsed.host_str().ok_or("Missing FTP host")?;
    let port = parsed.port().unwrap_or(21);
    let remote_path = parsed.path();

    let matched_cred = match_site_credential(ftp_url, &settings.site_credentials);
    let username = if !parsed.username().is_empty() {
        parsed.username().to_string()
    } else if let Some(c) = matched_cred {
        c.username.clone()
    } else {
        "anonymous".to_string()
    };

    let password = if let Some(p) = parsed.password() {
        p.to_string()
    } else if let Some(c) = matched_cred {
        let sec = resolve_credential_secret(c);
        if !sec.is_empty() {
            sec
        } else {
            c.password_or_token.clone()
        }
    } else {
        "anonymous@bytex.local".to_string()
    };

    let mut ftp_stream = AsyncRustlsFtpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("FTP connection error: {}", e))?;

    ftp_stream
        .login(&username, &password)
        .await
        .map_err(|e| format!("FTP authentication failed: {}", e))?;

    ftp_stream
        .transfer_type(suppaftp::types::FileType::Binary)
        .await
        .map_err(|e| e.to_string())?;

    if resume_offset > 0 {
        ftp_stream
            .resume_transfer(resume_offset as usize)
            .await
            .map_err(|e| format!("FTP REST resume failed: {}", e))?;
    }

    let mut data_stream = ftp_stream
        .retr_as_stream(remote_path)
        .await
        .map_err(|e| format!("FTP RETR error: {}", e))?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(resume_offset == 0)
        .open(save_path)
        .map_err(|e| e.to_string())?;

    use std::io::{Seek, SeekFrom, Write};
    if resume_offset > 0 {
        file.seek(SeekFrom::Start(resume_offset))
            .map_err(|e| e.to_string())?;
    }

    let mut buf = [0u8; 65536];
    let mut total_written = resume_offset;
    loop {
        let n = data_stream
            .read(&mut buf)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        total_written += n as u64;
    }

    let _ = ftp_stream.finalize_retr_stream(data_stream).await;
    let _ = ftp_stream.quit().await;

    Ok(total_written)
}

/// Full execution of an FTP / FTPS download with live telemetry, credentials resolution, and cancellation
pub async fn execute_ftp_download(
    item_id: String,
    downloads: std::sync::Arc<parking_lot::RwLock<Vec<crate::engine::DownloadItem>>>,
    settings: std::sync::Arc<parking_lot::RwLock<AppSettings>>,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
) -> Result<u64, String> {
    let mut no_ack = None;
    execute_ftp_download_with_ack(item_id, downloads, settings, cancel_rx, &mut no_ack).await
}

pub async fn execute_ftp_download_with_ack(
    item_id: String,
    downloads: std::sync::Arc<parking_lot::RwLock<Vec<crate::engine::DownloadItem>>>,
    settings: std::sync::Arc<parking_lot::RwLock<AppSettings>>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
    startup_ack: &mut Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
) -> Result<u64, String> {
    let (item_snapshot, current_settings) = {
        let dls = downloads.read();
        let found = dls
            .iter()
            .find(|d| d.id == item_id)
            .cloned()
            .ok_or_else(|| "Download item not found".to_string())?;
        (found, settings.read().clone())
    };

    let ftp_url = item_snapshot
        .resolved_url
        .as_deref()
        .unwrap_or(&item_snapshot.url);
    let parsed = url::Url::parse(ftp_url).map_err(|e| format!("Invalid FTP URL: {}", e))?;
    if parsed.scheme() == "ftps" {
        return Err("FTPS is not supported by the current FTP transport; the request was not sent because credentials could be exposed".to_string());
    }
    let host = parsed.host_str().ok_or("Missing FTP host")?;
    let port = parsed.port().unwrap_or(21);
    let remote_path = parsed.path();

    let matched_cred = match_site_credential(ftp_url, &current_settings.site_credentials);
    let username = if !parsed.username().is_empty() {
        parsed.username().to_string()
    } else if let Some(username) = item_snapshot.custom_headers.get("X-XDM-FTP-Username") {
        username.clone()
    } else if let Some(c) = matched_cred {
        c.username.clone()
    } else {
        "anonymous".to_string()
    };

    let password = if let Some(p) = parsed.password() {
        p.to_string()
    } else if let Some(password) = item_snapshot.custom_headers.get("X-XDM-FTP-Password") {
        password.clone()
    } else if let Some(c) = matched_cred {
        let sec = resolve_credential_secret(c);
        if !sec.is_empty() {
            sec
        } else {
            c.password_or_token.clone()
        }
    } else {
        "anonymous@bytex.local".to_string()
    };

    // Attempt connection
    let mut ftp_stream = match await_ftp_before_handoff(
        AsyncRustlsFtpStream::connect(format!("{}:{}", host, port)),
        &mut cancel_rx,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let err_msg = format!("FTP connection error: {}", e);
            let mut dls = downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                d.status = crate::engine::DownloadStatus::Failed;
                d.error_message = Some(err_msg.clone());
                d.transfer_log.push(format!("[ERROR] {}", err_msg));
            }
            return Err(err_msg);
        }
    };

    if let Err(e) =
        await_ftp_before_handoff(ftp_stream.login(&username, &password), &mut cancel_rx).await
    {
        let err_msg = format!("FTP authentication failed: {e}");
        let mut dls = downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
            d.status = crate::engine::DownloadStatus::Failed;
            d.error_message = Some(err_msg.clone());
            d.transfer_log.push(format!("[ERROR] {}", err_msg));
        }
        return Err(err_msg);
    }

    await_ftp_before_handoff(
        ftp_stream.transfer_type(suppaftp::types::FileType::Binary),
        &mut cancel_rx,
    )
    .await?;

    // Try to get remote file size
    let remote_size = tokio::select! {
        _ = cancel_rx.changed() => return Err("FTP handoff was cancelled before data arrived".to_string()),
        size = ftp_stream.size(remote_path) => size.ok().map(|size| size as u64),
    };

    let existing_size = std::fs::metadata(&item_snapshot.save_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut resume_offset = item_snapshot.downloaded_bytes;
    let partial_matches_remote = resume_offset > 0
        && existing_size >= resume_offset
        && item_snapshot.total_bytes > 0
        && remote_size == Some(item_snapshot.total_bytes);
    if !partial_matches_remote {
        resume_offset = 0;
    }
    if resume_offset > 0 {
        let resume_result = await_ftp_before_handoff(
            ftp_stream.resume_transfer(resume_offset as usize),
            &mut cancel_rx,
        )
        .await;
        if let Err(error) = resume_result {
            if *cancel_rx.borrow() {
                return Err(error);
            }
            // REST support is optional. If the server rejects it, restart from
            // byte zero rather than append a full response at the saved offset.
            resume_offset = 0;
            if let Some(current) = downloads
                .write()
                .iter_mut()
                .find(|current| current.id == item_id)
            {
                current.resumable = false;
                current.transfer_log.push(
                    "FTP server does not support resuming this transfer; restarting from byte zero."
                        .to_string(),
                );
            }
        }
    }

    let mut data_stream = match await_ftp_before_handoff(
        ftp_stream.retr_as_stream(remote_path),
        &mut cancel_rx,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let err_msg = format!("FTP RETR error: {}", e);
            let mut dls = downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                d.status = crate::engine::DownloadStatus::Failed;
                d.error_message = Some(err_msg.clone());
                d.transfer_log.push(format!("[ERROR] {}", err_msg));
            }
            return Err(err_msg);
        }
    };

    if let Some(parent) = std::path::Path::new(&item_snapshot.save_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(resume_offset == 0)
        .open(&item_snapshot.save_path)
        .map_err(|e| e.to_string())?;

    use std::io::{Seek, SeekFrom, Write};
    if resume_offset > 0 {
        file.set_len(resume_offset)
            .map_err(|error| format!("Could not trim the partial FTP file: {error}"))?;
        file.seek(SeekFrom::Start(resume_offset))
            .map_err(|e| e.to_string())?;
    }

    let mut buf = [0u8; 65536];
    let first_count = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        data_stream.read(&mut buf),
    )
    .await
    .map_err(|_| "FTP server did not send data in time".to_string())?
    .map_err(|error| format!("FTP data stream failed before handoff: {error}"))?;
    if first_count > 0 {
        file.write_all(&buf[..first_count])
            .map_err(|error| error.to_string())?;
        file.sync_data().map_err(|error| error.to_string())?;
    }
    let mut total_written = resume_offset.saturating_add(first_count as u64);

    // Update state to Downloading before acknowledging the handoff.
    {
        let mut dls = downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
            if let Some(sz) = remote_size {
                d.total_bytes = sz;
            }
            d.downloaded_bytes = total_written;
            d.status = crate::engine::DownloadStatus::Downloading;
            d.transfer_log.push(format!(
                "Connected to FTP {} | Size: {} bytes",
                host,
                remote_size.unwrap_or(0)
            ));
        }
    }

    if let Some(ack) = startup_ack.take() {
        let _ = ack.send(Ok(()));
    }

    let mut window_start = std::time::Instant::now();
    let mut window_bytes = 0u64;

    loop {
        if *cancel_rx.borrow() {
            let mut dls = downloads.write();
            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                d.status = crate::engine::DownloadStatus::Paused;
                d.speed_bps = 0;
            }
            return Ok(total_written);
        }

        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    let mut dls = downloads.write();
                    if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                        d.status = crate::engine::DownloadStatus::Paused;
                        d.speed_bps = 0;
                    }
                    return Ok(total_written);
                }
            }
            res = data_stream.read(&mut buf) => {
                let n = match res {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) => {
                        let err_msg = e.to_string();
                        let mut dls = downloads.write();
                        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                            d.status = crate::engine::DownloadStatus::Failed;
                            d.error_message = Some(err_msg.clone());
                        }
                        return Err(err_msg);
                    }
                };

                let (limiter_on, max_kbps) = {
                    let current = settings.read();
                    (current.speed_limiter_enabled, current.global_max_download_kbps)
                };
                let limit_bps = {
                    let dls = downloads.read();
                    super::rate_limiter::download_rate_limit_bps(
                        limiter_on,
                        max_kbps,
                        &dls,
                        false,
                    )
                };
                tokio::select! {
                    _ = super::rate_limiter::throttle_download(n, limit_bps) => {}
                    changed = cancel_rx.changed() => {
                        if changed.is_err() || *cancel_rx.borrow() {
                            let mut dls = downloads.write();
                            if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                                d.status = crate::engine::DownloadStatus::Paused;
                                d.speed_bps = 0;
                            }
                            return Ok(total_written);
                        }
                    }
                }

                file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                total_written += n as u64;
                window_bytes += n as u64;

                let elapsed = window_start.elapsed();
                if elapsed >= std::time::Duration::from_millis(250) {
                    let speed = ((window_bytes as f64) / elapsed.as_secs_f64()) as u64;
                    window_start = std::time::Instant::now();
                    window_bytes = 0;

                    let mut dls = downloads.write();
                    if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
                        d.downloaded_bytes = total_written;
                        d.speed_bps = speed;
                        if d.total_bytes > total_written && speed > 0 {
                            d.eta_seconds = Some((d.total_bytes - total_written) / speed);
                        }
                    }
                }
            }
        }
    }

    let _ = ftp_stream.finalize_retr_stream(data_stream).await;
    let _ = ftp_stream.quit().await;

    if remote_size.is_some_and(|size| size != total_written) {
        let error = format!(
            "FTP server closed the transfer after {total_written} of {} bytes. The partial file is available to retry.",
            remote_size.unwrap_or_default()
        );
        let mut dls = downloads.write();
        if let Some(current) = dls.iter_mut().find(|current| current.id == item_id) {
            current.status = crate::engine::DownloadStatus::Failed;
            current.downloaded_bytes = total_written;
            current.error_message = Some(error.clone());
            current.transfer_log.push(format!("[ERROR] {error}"));
        }
        return Err(error);
    }

    // Completion
    let should_hash = settings.read().auto_verify_checksum;
    let computed_hash = if should_hash {
        if let Ok(bytes) = std::fs::read(&item_snapshot.save_path) {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            Some(hex::encode(hasher.finalize()))
        } else {
            None
        }
    } else {
        None
    };

    {
        let mut dls = downloads.write();
        if let Some(d) = dls.iter_mut().find(|d| d.id == item_id) {
            d.status = crate::engine::DownloadStatus::Completed;
            d.downloaded_bytes = total_written;
            if d.total_bytes < total_written {
                d.total_bytes = total_written;
            }
            d.speed_bps = 0;
            d.eta_seconds = Some(0);
            d.checksum_sha256 = computed_hash;
            d.completed_at = Some(chrono::Utc::now().to_rfc3339());
            d.transfer_log
                .push("FTP download finished successfully.".to_string());
        }
    }

    Ok(total_written)
}

async fn await_ftp_before_handoff<T, E, F>(
    future: F,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    if *cancel_rx.borrow() {
        return Err("FTP handoff cancelled before the native transfer was ready".to_string());
    }
    tokio::select! {
        result = future => result.map_err(|error| error.to_string()),
        _ = cancel_rx.changed() => Err("FTP handoff cancelled before the native transfer was ready".to_string()),
    }
}

#[cfg(test)]
mod browser_ftp_tests {
    use super::execute_ftp_download_with_ack;
    use crate::engine::{DownloadEngine, DownloadRedirect, DownloadStatus, NewDownloadRequest};
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;
    use uuid::Uuid;

    #[tokio::test]
    async fn ftp_transfer_is_acknowledged_after_native_data_is_written() {
        let control_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let control_address = control_listener.local_addr().unwrap();
        let expected_bytes = b"ftp-native-bytes".to_vec();
        let server_bytes = expected_bytes.clone();
        let server = tokio::spawn(async move {
            let (control, _) = control_listener.accept().await.unwrap();
            let mut control = BufReader::new(control);
            control
                .get_mut()
                .write_all(b"220 Test FTP ready\r\n")
                .await
                .unwrap();
            let mut passive_listener: Option<TcpListener> = None;
            let mut commands = Vec::new();
            loop {
                let mut line = String::new();
                if control.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let command = line.trim().to_string();
                commands.push(command.clone());
                let upper = command.to_ascii_uppercase();
                if upper.starts_with("USER ") {
                    control
                        .get_mut()
                        .write_all(b"331 Password required\r\n")
                        .await
                        .unwrap();
                } else if upper.starts_with("PASS ") {
                    control
                        .get_mut()
                        .write_all(b"230 Logged in\r\n")
                        .await
                        .unwrap();
                } else if upper == "TYPE I" {
                    control
                        .get_mut()
                        .write_all(b"200 Binary mode\r\n")
                        .await
                        .unwrap();
                } else if upper.starts_with("SIZE ") {
                    control
                        .get_mut()
                        .write_all(format!("213 {}\r\n", server_bytes.len()).as_bytes())
                        .await
                        .unwrap();
                } else if upper == "PASV" {
                    let data_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                    let port = data_listener.local_addr().unwrap().port();
                    passive_listener = Some(data_listener);
                    control
                        .get_mut()
                        .write_all(
                            format!(
                                "227 Entering Passive Mode (127,0,0,1,{},{})\r\n",
                                port / 256,
                                port % 256
                            )
                            .as_bytes(),
                        )
                        .await
                        .unwrap();
                } else if upper.starts_with("RETR ") {
                    control
                        .get_mut()
                        .write_all(b"150 Opening data connection\r\n")
                        .await
                        .unwrap();
                    let listener = passive_listener.take().expect("PASV should precede RETR");
                    let (mut data, _) = listener.accept().await.unwrap();
                    data.write_all(&server_bytes).await.unwrap();
                    data.shutdown().await.unwrap();
                    control
                        .get_mut()
                        .write_all(b"226 Transfer complete\r\n")
                        .await
                        .unwrap();
                } else if upper == "QUIT" {
                    control
                        .get_mut()
                        .write_all(b"221 Goodbye\r\n")
                        .await
                        .unwrap();
                    break;
                } else {
                    control
                        .get_mut()
                        .write_all(b"200 Command accepted\r\n")
                        .await
                        .unwrap();
                }
            }
            commands
        });

        let engine = Arc::new(DownloadEngine::new());
        let output_dir = std::env::temp_dir().join(format!("bytex-ftp-success-{}", Uuid::new_v4()));
        let request = NewDownloadRequest {
            url: "https://origin.test/trigger-download".to_string(),
            final_url: Some(format!(
                "ftp://test-user:test-password@{control_address}/package.bin"
            )),
            redirect_chain: vec![DownloadRedirect {
                from_url: "https://origin.test/trigger-download".to_string(),
                to_url: format!("ftp://test-user:test-password@{control_address}/package.bin"),
                status_code: Some(302),
            }],
            filename: Some("package.bin".to_string()),
            category: None,
            save_path: Some(output_dir.to_string_lossy().to_string()),
            threads_count: None,
            queue_id: Some("main-queue".to_string()),
            start_immediately: false,
            source_browser: Some("Firefox".to_string()),
            referer: None,
            cookies: None,
            user_agent: None,
            custom_headers: None,
            request_method: "GET".to_string(),
            request_body: None,
            browser_intercepted: true,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
        };
        let item = engine.add_download(request);
        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
        let mut ack = Some(ack_tx);
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let transferred = execute_ftp_download_with_ack(
            item.id.clone(),
            engine.downloads.clone(),
            engine.settings.clone(),
            cancel_rx,
            &mut ack,
        )
        .await
        .unwrap();
        assert_eq!(ack_rx.await.unwrap(), Ok(()));
        assert_eq!(transferred, expected_bytes.len() as u64);
        assert_eq!(std::fs::read(&item.save_path).unwrap(), expected_bytes);
        assert_eq!(
            engine
                .downloads
                .read()
                .iter()
                .find(|current| current.id == item.id)
                .unwrap()
                .status,
            DownloadStatus::Completed
        );
        let commands = server.await.unwrap();
        assert!(commands.iter().any(|command| command == "USER test-user"));
        assert!(commands
            .iter()
            .any(|command| command == "PASS test-password"));
        let _ = std::fs::remove_dir_all(output_dir);
    }
}
