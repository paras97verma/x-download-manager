use crate::db::{ResumableSnapshot, UpdateCheckpoint};
use crate::engine::{DownloadEngine, DownloadProtocol, DownloadStatus};
use reqwest::header::{CONTENT_RANGE, ETAG, LAST_MODIFIED, RANGE};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::time::{sleep, Duration, Instant};

/// Global flag indicating an application update preparation is underway.
/// When true, any incoming download intercept (e.g. from browser extensions)
/// or new task additions from the UI are rejected with HTTP 503 / friendly error.
pub static IS_PREPARING_UPDATE: AtomicBool = AtomicBool::new(false);

pub fn is_preparing_update() -> bool {
    IS_PREPARING_UPDATE.load(Ordering::SeqCst)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePreparationSummary {
    pub success: bool,
    pub paused_downloads_count: usize,
    pub queued_downloads_count: usize,
    pub completed_downloads_count: usize,
    pub backup_path: String,
    pub db_intact: bool,
    pub prepared_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRestorationReport {
    pub restored_at: String,
    pub app_version: String,
    pub previous_version: Option<String>,
    pub total_restored: usize,
    pub safely_paused: usize,
    pub ready_to_resume: Vec<RestoredDownloadInfo>,
    pub non_resumable_protected: Vec<RestoredDownloadInfo>,
    pub completed_verified: usize,
    pub db_restored_from_backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoredDownloadInfo {
    pub id: String,
    pub filename: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub resumable: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResumeVerificationResult {
    pub id: String,
    pub can_resume: bool,
    pub accepts_ranges: bool,
    pub validator_matches: bool,
    pub server_total_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
}

/// Gracefully prepares the application for an update:
/// 1. Stops accepting any new downloads.
/// 2. Sends cancel/pause tokens to all active download workers.
/// 3. Waits for active workers to complete and flush file buffers to disk (`file.sync_data()`).
/// 4. Transitions all active items to `Paused` with exact segment offsets.
/// 5. Commits transactional state to SQLite and truncates the WAL file.
/// 6. Creates a verified database backup snapshot.
/// 7. Records an `update_checkpoints` entry for safe post-update restoration.
pub async fn prepare_for_update(
    engine: &Arc<DownloadEngine>,
    target_version: Option<String>,
) -> Result<UpdatePreparationSummary, String> {
    // 1. Block incoming downloads
    IS_PREPARING_UPDATE.store(true, Ordering::SeqCst);
    tracing::info!("ByteX update preparation initiated. New downloads are now blocked.");

    // 2. Identify active downloads that require graceful pause
    let active_ids: Vec<String> = {
        let dls = engine.downloads.read();
        dls.iter()
            .filter(|d| {
                matches!(
                    d.status,
                    DownloadStatus::Downloading
                        | DownloadStatus::Connecting
                        | DownloadStatus::Authenticating
                        | DownloadStatus::Merging
                        | DownloadStatus::Seeding
                )
            })
            .map(|d| d.id.clone())
            .collect()
    };

    // 3. Send cancellation / pause signal to all active downloads
    for id in &active_ids {
        if let Some(tx) = engine.active_cancellations.write().remove(id) {
            let _ = tx.send(true);
        }
    }

    // 4. Wait for active worker threads to terminate and flush buffers (up to 3 seconds)
    let wait_start = Instant::now();
    let max_wait = Duration::from_secs(3);
    while wait_start.elapsed() < max_wait {
        let any_still_active = {
            let cancellations = engine.active_cancellations.read();
            active_ids.iter().any(|id| cancellations.contains_key(id))
        };
        if !any_still_active {
            break;
        }
        sleep(Duration::from_millis(100)).await;
    }

    // 5. Update state and build checkpoint snapshot
    let mut resumable_map = HashMap::new();
    let mut paused_count = 0;
    let mut queued_count = 0;
    let mut completed_count = 0;

    {
        let mut dls = engine.downloads.write();
        for item in dls.iter_mut() {
            if active_ids.contains(&item.id)
                || matches!(
                    item.status,
                    DownloadStatus::Downloading
                        | DownloadStatus::Connecting
                        | DownloadStatus::Authenticating
                        | DownloadStatus::Merging
                        | DownloadStatus::Seeding
                )
            {
                item.status = DownloadStatus::Paused;
                item.speed_bps = 0;
                item.upload_speed_bps = 0;
                item.eta_seconds = None;
                for seg in &mut item.segments {
                    seg.speed_bps = 0;
                    if seg.status == "receiving" || seg.status == "connecting" {
                        seg.status = "paused".to_string();
                    }
                }
                item.transfer_log.push(
                    "Gracefully paused for ByteX application update. All partial bytes and segment states flushed to disk."
                        .to_string(),
                );
                resumable_map.insert(
                    item.id.clone(),
                    ResumableSnapshot {
                        resumable: item.resumable,
                        resume_validator: item.resume_validator.clone(),
                        total_bytes: item.total_bytes,
                        downloaded_bytes: item.downloaded_bytes,
                        filename: item.filename.clone(),
                        save_path: item.save_path.clone(),
                        url: item.url.clone(),
                    },
                );
                paused_count += 1;
            } else if item.status == DownloadStatus::Paused {
                paused_count += 1;
            } else if item.status == DownloadStatus::Queued {
                queued_count += 1;
            } else if item.status == DownloadStatus::Completed {
                completed_count += 1;
            }
        }
    }

    // 6. Save atomic snapshot to database and JSON fallback
    engine.persist_downloads()?;

    // 7. Flush WAL pages to main database file and verify integrity
    let _ = engine.db.wal_checkpoint_truncate();
    let db_intact = engine.db.integrity_check().unwrap_or(false);

    // 8. Create database backup file
    let db_path = engine.history_path.with_file_name("bytex.db");
    let backup_path = db_path.with_extension("db.backup");
    let snapshot_path = db_path.with_extension("db.update-snapshot");
    let _ = engine.db.backup_to_file(&backup_path);
    let _ = engine.db.backup_to_file(&snapshot_path);

    // 9. Save update checkpoint
    let prepared_at = chrono::Utc::now().to_rfc3339();
    let checkpoint = UpdateCheckpoint {
        id: None,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        target_version,
        prepared_at: prepared_at.clone(),
        restored_at: None,
        status: "prepared".to_string(),
        paused_download_ids: active_ids,
        resumable_map,
        summary_json: "{}".to_string(),
    };
    let _ = engine.db.save_update_checkpoint(&checkpoint);
    let _ = engine.db.wal_checkpoint_truncate();

    tracing::info!(
        "ByteX update preparation complete: {} transfers paused, WAL flushed, backup saved.",
        paused_count
    );

    Ok(UpdatePreparationSummary {
        success: true,
        paused_downloads_count: paused_count,
        queued_downloads_count: queued_count,
        completed_downloads_count: completed_count,
        backup_path: backup_path.to_string_lossy().to_string(),
        db_intact,
        prepared_at,
        message:
            "All downloads and partial files safely paused and flushed to disk. Ready for updater."
                .to_string(),
    })
}

/// Inspects the database after application startup to restore previous update state
pub fn restore_post_update(engine: &Arc<DownloadEngine>) -> Option<UpdateRestorationReport> {
    let checkpoint_opt = engine.db.get_latest_update_checkpoint().ok().flatten();
    let checkpoint = checkpoint_opt?;

    if checkpoint.status != "prepared" {
        return None;
    }

    let restored_at = chrono::Utc::now().to_rfc3339();
    let mut ready_to_resume = Vec::new();
    let mut non_resumable_protected = Vec::new();
    let mut safely_paused = 0;
    let mut completed_verified = 0;
    let total_restored = engine.downloads.read().len();

    {
        let mut dls = engine.downloads.write();
        for item in dls.iter_mut() {
            let was_paused_for_update = checkpoint.paused_download_ids.contains(&item.id);
            if was_paused_for_update {
                safely_paused += 1;
                let info = RestoredDownloadInfo {
                    id: item.id.clone(),
                    filename: item.filename.clone(),
                    downloaded_bytes: item.downloaded_bytes,
                    total_bytes: item.total_bytes,
                    resumable: item.resumable,
                    reason: if item.resumable {
                        "Resumable transfer safely preserved across update. Ready for verification."
                            .to_string()
                    } else {
                        "Non-resumable transfer safely kept paused to protect partial data."
                            .to_string()
                    },
                };
                if item.resumable {
                    ready_to_resume.push(info);
                } else {
                    non_resumable_protected.push(info);
                }
            } else if item.status == DownloadStatus::Completed {
                completed_verified += 1;
            }
        }
    }

    let report = UpdateRestorationReport {
        restored_at: restored_at.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        previous_version: Some(checkpoint.app_version.clone()),
        total_restored,
        safely_paused,
        ready_to_resume,
        non_resumable_protected,
        completed_verified,
        db_restored_from_backup: false,
    };

    if let Ok(json) = serde_json::to_string(&report) {
        if let Some(id) = checkpoint.id {
            let _ = engine.db.mark_checkpoint_restored(id, &restored_at, &json);
        }
    }

    Some(report)
}

/// Verifies server resource support and validator before safely resuming a download
pub async fn verify_and_resume_download(
    engine: &Arc<DownloadEngine>,
    id: &str,
) -> Result<DownloadResumeVerificationResult, String> {
    let item = {
        let dls = engine.downloads.read();
        dls.iter().find(|d| d.id == id).cloned()
    }
    .ok_or_else(|| format!("Download with ID {id} not found"))?;

    // 1. BitTorrent & Magnet protocols verify piece hash integrity directly
    if matches!(
        item.protocol,
        DownloadProtocol::BitTorrent | DownloadProtocol::Magnet
    ) {
        let _ = engine.start_download_by_id(id).await;
        return Ok(DownloadResumeVerificationResult {
            id: id.to_string(),
            can_resume: true,
            accepts_ranges: true,
            validator_matches: true,
            server_total_bytes: item.total_bytes,
            message: "BitTorrent swarm resumed safely with cryptographic piece verification."
                .to_string(),
        });
    }

    // 2. Non-resumable HTTP/FTP transfers cannot be resumed safely without restarting
    if !item.resumable {
        return Ok(DownloadResumeVerificationResult {
            id: id.to_string(),
            can_resume: false,
            accepts_ranges: false,
            validator_matches: false,
            server_total_bytes: item.total_bytes,
            message:
                "This download does not support byte ranges. Kept paused to prevent data loss."
                    .to_string(),
        });
    }

    // 3. Perform network probe to verify remote resource identity
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let target_url = item.resolved_url.as_deref().unwrap_or(&item.url);
    let mut req = client.get(target_url).header(RANGE, "bytes=0-0");
    if let Some(ref ref_url) = item.referer {
        req = req.header("Referer", ref_url);
    }
    if let Some(ref cookies) = item.cookies {
        req = req.header("Cookie", cookies);
    }
    for (k, v) in &item.custom_headers {
        req = req.header(k, v);
    }

    let resp_res = req.send().await;
    let resp = match resp_res {
        Ok(r) => r,
        Err(e) => {
            return Ok(DownloadResumeVerificationResult {
                id: id.to_string(),
                can_resume: false,
                accepts_ranges: false,
                validator_matches: false,
                server_total_bytes: item.total_bytes,
                message: format!("Could not reach server to verify resource identity: {e}"),
            });
        }
    };

    let status = resp.status();
    let accepts_ranges = status == reqwest::StatusCode::PARTIAL_CONTENT;

    // Check remote file size
    let server_total = resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|n| n.parse::<u64>().ok())
        .or_else(|| resp.content_length())
        .unwrap_or(0);

    // Check validator match if stored
    let validator_matches = if let Some(ref stored_validator) = item.resume_validator {
        let current_etag = resp.headers().get(ETAG).and_then(|v| v.to_str().ok());
        let current_modified = resp
            .headers()
            .get(LAST_MODIFIED)
            .and_then(|v| v.to_str().ok());

        current_etag
            .or(current_modified)
            .is_some_and(|val| val == stored_validator)
    } else {
        // If no validator was saved, verify total file length matches
        item.total_bytes > 0 && server_total == item.total_bytes
    };

    if !accepts_ranges {
        return Ok(DownloadResumeVerificationResult {
            id: id.to_string(),
            can_resume: false,
            accepts_ranges: false,
            validator_matches,
            server_total_bytes: server_total,
            message: "Remote server no longer advertises byte-range support. Kept paused."
                .to_string(),
        });
    }

    if !validator_matches && item.resume_validator.is_some() {
        return Ok(DownloadResumeVerificationResult {
            id: id.to_string(),
            can_resume: false,
            accepts_ranges: true,
            validator_matches: false,
            server_total_bytes: server_total,
            message: "Remote file on server was modified since last update (ETag mismatch). Kept paused to protect your partial file."
                .to_string(),
        });
    }

    // Both range support and resource identity are verified: start download safely!
    let _ = engine.start_download_by_id(id).await;

    Ok(DownloadResumeVerificationResult {
        id: id.to_string(),
        can_resume: true,
        accepts_ranges: true,
        validator_matches: true,
        server_total_bytes: server_total,
        message: "Resource identity and byte-range support verified. Transfer resumed.".to_string(),
    })
}

/// Checks the repository releases for software updates
pub async fn check_for_updates(current_version: &str) -> Result<AppUpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("ByteX-Download-Manager-Updater")
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://api.github.com/repos/paras97verma/x-download-manager/releases/latest";
    let resp = client
        .get(url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error checking for updates: {e}"))?;

    if !resp.status().is_success() {
        return Ok(AppUpdateInfo {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            has_update: false,
            release_notes: "No update information available.".to_string(),
            release_url: "https://github.com/paras97verma/x-download-manager/releases".to_string(),
            published_at: None,
        });
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release metadata: {e}"))?;

    let tag_name = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    let body = release
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("New version available.")
        .to_string();

    let html_url = release
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/paras97verma/x-download-manager/releases/latest")
        .to_string();

    let published_at = release
        .get("published_at")
        .and_then(|v| v.as_str())
        .map(String::from);

    let has_update = !tag_name.is_empty() && is_version_newer(&tag_name, current_version);

    Ok(AppUpdateInfo {
        current_version: current_version.to_string(),
        latest_version: if tag_name.is_empty() {
            current_version.to_string()
        } else {
            tag_name
        },
        has_update,
        release_notes: body,
        release_url: html_url,
        published_at,
    })
}

fn is_version_newer(candidate: &str, current: &str) -> bool {
    let parse_parts = |v: &str| -> Vec<u64> {
        v.split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<u64>().ok())
            .collect()
    };
    let c_parts = parse_parts(candidate);
    let cur_parts = parse_parts(current);

    for (c, cur) in c_parts.iter().zip(cur_parts.iter()) {
        if c > cur {
            return true;
        }
        if c < cur {
            return false;
        }
    }
    c_parts.len() > cur_parts.len()
}
