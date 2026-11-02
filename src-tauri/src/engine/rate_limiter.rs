//! Shared, process-wide throttling for non-torrent transfers.
//! Torrent traffic uses librqbit's session-level limiter.

use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

static NEXT_DOWNLOAD_SLOT: OnceLock<Mutex<tokio::time::Instant>> = OnceLock::new();

fn is_downloading(download: &super::DownloadItem) -> bool {
    matches!(
        &download.status,
        super::DownloadStatus::Connecting
            | super::DownloadStatus::Authenticating
            | super::DownloadStatus::Downloading
    )
}

fn is_torrent(download: &super::DownloadItem) -> bool {
    matches!(
        &download.protocol,
        super::DownloadProtocol::BitTorrent | super::DownloadProtocol::Magnet
    )
}

pub fn download_rate_limit_bps(
    enabled: bool,
    limit_kbps: u64,
    downloads: &[super::DownloadItem],
    torrent_transfer: bool,
) -> u64 {
    if !enabled || limit_kbps == 0 {
        return 0;
    }
    let cap = limit_kbps.saturating_mul(1024);
    let active_torrents = downloads
        .iter()
        .filter(|download| is_downloading(download) && is_torrent(download))
        .count() as u64;
    if torrent_transfer {
        let active_other = downloads
            .iter()
            .any(|download| is_downloading(download) && !is_torrent(download));
        (if active_other { cap / 2 } else { cap }) / active_torrents.max(1)
    } else if active_torrents > 0 {
        cap / 2
    } else {
        cap
    }
}

pub fn upload_rate_limit_bps(
    enabled: bool,
    limit_kbps: u64,
    downloads: &[super::DownloadItem],
) -> u64 {
    if !enabled || limit_kbps == 0 {
        return 0;
    }
    let active_torrents = downloads
        .iter()
        .filter(|download| {
            is_torrent(download)
                && matches!(
                    &download.status,
                    super::DownloadStatus::Connecting
                        | super::DownloadStatus::Authenticating
                        | super::DownloadStatus::Downloading
                        | super::DownloadStatus::Seeding
                )
        })
        .count() as u64;
    limit_kbps.saturating_mul(1024) / active_torrents.max(1)
}

/// Reserves part of the global download bandwidth window and waits until that
/// reservation is available. A zero rate means unlimited.
pub async fn throttle_download(bytes: usize, limit_bps: u64) {
    if bytes == 0 {
        return;
    }

    if limit_bps == 0 {
        if let Some(next) = NEXT_DOWNLOAD_SLOT.get() {
            *next.lock().await = tokio::time::Instant::now();
        }
        return;
    }

    let delay = Duration::from_secs_f64(bytes as f64 / limit_bps as f64);
    let next_slot = NEXT_DOWNLOAD_SLOT.get_or_init(|| Mutex::new(tokio::time::Instant::now()));
    let deadline = {
        let mut next = next_slot.lock().await;
        let start = (*next).max(tokio::time::Instant::now());
        let deadline = start + delay;
        *next = deadline;
        deadline
    };
    tokio::time::sleep_until(deadline).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn download(
        protocol: super::super::DownloadProtocol,
        status: super::super::DownloadStatus,
    ) -> super::super::DownloadItem {
        super::super::DownloadItem {
            id: uuid::Uuid::new_v4().to_string(),
            filename: String::new(),
            url: String::new(),
            resolved_url: None,
            protocol,
            category: String::new(),
            queue_id: String::new(),
            save_path: String::new(),
            total_bytes: 0,
            downloaded_bytes: 0,
            speed_bps: 0,
            upload_speed_bps: 0,
            eta_seconds: None,
            status,
            resumable: true,
            threads_count: 1,
            segments: Vec::new(),
            torrent_meta: None,
            source_browser: None,
            referer: None,
            cookies: None,
            custom_headers: HashMap::new(),
            site_credential_id: None,
            checksum_sha256: None,
            created_at: String::new(),
            completed_at: None,
            error_message: None,
            transfer_log: Vec::new(),
            torrent_file_path: None,
            torrent_selected_files: None,
        }
    }

    #[tokio::test]
    async fn throttle_waits_for_reserved_bandwidth() {
        let start = tokio::time::Instant::now();
        throttle_download(1024, 1024).await;
        assert!(start.elapsed() >= Duration::from_millis(900));
    }

    #[tokio::test]
    async fn zero_rate_is_unlimited() {
        let start = tokio::time::Instant::now();
        throttle_download(1024, 0).await;
        assert!(start.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn download_limit_is_shared_between_http_and_multiple_torrents() {
        use super::super::{DownloadProtocol as Protocol, DownloadStatus as Status};
        let active = vec![
            download(Protocol::Https, Status::Downloading),
            download(Protocol::BitTorrent, Status::Downloading),
            download(Protocol::Magnet, Status::Downloading),
        ];
        assert_eq!(download_rate_limit_bps(true, 10, &active, false), 5 * 1024);
        assert_eq!(
            download_rate_limit_bps(true, 10, &active, true),
            5 * 1024 / 2
        );
        assert_eq!(upload_rate_limit_bps(true, 10, &active), 5 * 1024);
    }

    #[test]
    fn disabled_or_zero_limits_are_unlimited() {
        assert_eq!(download_rate_limit_bps(false, 10, &[], false), 0);
        assert_eq!(download_rate_limit_bps(true, 0, &[], false), 0);
        assert_eq!(upload_rate_limit_bps(false, 10, &[]), 0);
    }
}
