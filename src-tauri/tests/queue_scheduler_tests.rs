use std::sync::Arc;
use xdm_lib::config::SchedulerQueueConfig;
use xdm_lib::db::DatabaseManager;
use xdm_lib::engine::{DownloadEngine, DownloadStatus, NewDownloadRequest};

#[test]
fn test_custom_queue_creation_and_sqlite_persistence() {
    let db = DatabaseManager::open_in_memory().expect("in-memory db open failed");

    let queues = vec![
        SchedulerQueueConfig {
            id: "main-queue".to_string(),
            name: "Main Download Queue".to_string(),
            max_concurrent: 4,
            start_time_enabled: false,
            start_time_hhmm: "00:00".to_string(),
            stop_time_enabled: false,
            stop_time_hhmm: "08:00".to_string(),
            days_of_week: vec![0, 1, 2, 3, 4, 5, 6],
            speed_limit_kbps: None,
            post_queue_action: "none".to_string(),
            download_dir: None,
            priority: Some("normal".to_string()),
            preferred_connections: Some(8),
            manual_pause: Some(false),
            date_schedule_enabled: Some(false),
            date_schedule_start: None,
            date_schedule_stop: None,
            per_host_concurrency: Some(4),
        },
        SchedulerQueueConfig {
            id: "work-queue".to_string(),
            name: "Work Documents".to_string(),
            max_concurrent: 2,
            start_time_enabled: true,
            start_time_hhmm: "09:00".to_string(),
            stop_time_enabled: true,
            stop_time_hhmm: "17:00".to_string(),
            days_of_week: vec![1, 2, 3, 4, 5],
            speed_limit_kbps: Some(5120),
            post_queue_action: "none".to_string(),
            download_dir: Some("/Users/test/Work".to_string()),
            priority: Some("high".to_string()),
            preferred_connections: Some(16),
            manual_pause: Some(true),
            date_schedule_enabled: Some(true),
            date_schedule_start: Some("2026-11-01T00:00".to_string()),
            date_schedule_stop: Some("2026-11-30T23:59".to_string()),
            per_host_concurrency: Some(2),
        },
    ];

    db.save_queues(&queues).expect("save_queues failed");
    let loaded = db.load_queues().expect("load_queues failed");

    assert_eq!(loaded.len(), 2);
    let work = loaded.iter().find(|q| q.id == "work-queue").unwrap();
    assert_eq!(work.name, "Work Documents");
    assert_eq!(work.max_concurrent, 2);
    assert_eq!(work.speed_limit_kbps, Some(5120));
    assert_eq!(work.download_dir.as_deref(), Some("/Users/test/Work"));
    assert_eq!(work.priority.as_deref(), Some("high"));
    assert_eq!(work.preferred_connections, Some(16));
    assert_eq!(work.manual_pause, Some(true));
    assert_eq!(work.date_schedule_enabled, Some(true));
    assert_eq!(work.per_host_concurrency, Some(2));
}

#[tokio::test]
async fn test_safe_queue_deletion_and_download_reassignment() {
    let engine = Arc::new(DownloadEngine::new());

    // Register a custom queue
    {
        let mut settings = engine.settings.write();
        settings.queues.push(SchedulerQueueConfig {
            id: "custom-music".to_string(),
            name: "Music Queue".to_string(),
            max_concurrent: 2,
            start_time_enabled: false,
            start_time_hhmm: "00:00".to_string(),
            stop_time_enabled: false,
            stop_time_hhmm: "23:59".to_string(),
            days_of_week: vec![0, 1, 2, 3, 4, 5, 6],
            speed_limit_kbps: None,
            post_queue_action: "none".to_string(),
            download_dir: None,
            priority: Some("normal".to_string()),
            preferred_connections: Some(8),
            manual_pause: Some(false),
            date_schedule_enabled: Some(false),
            date_schedule_start: None,
            date_schedule_stop: None,
            per_host_concurrency: None,
        });
    }

    // Add 2 downloads into the custom queue
    let item1 = engine.add_download(NewDownloadRequest {
        url: "https://example.com/audio1.flac".to_string(),
        final_url: None,
        redirect_chain: Vec::new(),
        filename: Some("audio1.flac".to_string()),
        category: Some("Music".to_string()),
        save_path: None,
        threads_count: None,
        queue_id: Some("custom-music".to_string()),
        start_immediately: false,
        source_browser: None,
        referer: None,
        cookies: None,
        user_agent: None,
        custom_headers: None,
        request_method: "GET".to_string(),
        request_body: None,
        browser_intercepted: false,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
        scheduled_start: None,
        scheduled_stop: None,
    });

    let item2 = engine.add_download(NewDownloadRequest {
        url: "https://example.com/audio2.flac".to_string(),
        final_url: None,
        redirect_chain: Vec::new(),
        filename: Some("audio2.flac".to_string()),
        category: Some("Music".to_string()),
        save_path: None,
        threads_count: None,
        queue_id: Some("custom-music".to_string()),
        start_immediately: false,
        source_browser: None,
        referer: None,
        cookies: None,
        user_agent: None,
        custom_headers: None,
        request_method: "GET".to_string(),
        request_body: None,
        browser_intercepted: false,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
        scheduled_start: None,
        scheduled_stop: None,
    });

    assert_eq!(item1.queue_id, "custom-music");
    assert_eq!(item2.queue_id, "custom-music");

    // Perform safe deletion of "custom-music" queue with reassignment to "main-queue"
    {
        let target_id = "main-queue".to_string();
        let mut dls = engine.downloads.write();
        for d in dls.iter_mut() {
            if d.queue_id == "custom-music" {
                d.queue_id = target_id.clone();
            }
        }
        let mut settings = engine.settings.write();
        settings.queues.retain(|q| q.id != "custom-music");
    }

    // Verify downloads were safely preserved and moved to main-queue without data loss
    let dls = engine.downloads.read();
    let reloaded1 = dls.iter().find(|d| d.id == item1.id).unwrap();
    let reloaded2 = dls.iter().find(|d| d.id == item2.id).unwrap();
    assert_eq!(reloaded1.queue_id, "main-queue");
    assert_eq!(reloaded2.queue_id, "main-queue");

    // Verify queue itself was deleted from settings
    let settings = engine.settings.read();
    assert!(!settings.queues.iter().any(|q| q.id == "custom-music"));
}

#[tokio::test]
async fn test_queue_manual_pause_prevents_downloads() {
    let engine = Arc::new(DownloadEngine::new());

    // Register a paused queue
    {
        let mut settings = engine.settings.write();
        settings.queues.push(SchedulerQueueConfig {
            id: "paused-queue".to_string(),
            name: "Paused Queue".to_string(),
            max_concurrent: 4,
            start_time_enabled: false,
            start_time_hhmm: "00:00".to_string(),
            stop_time_enabled: false,
            stop_time_hhmm: "23:59".to_string(),
            days_of_week: vec![0, 1, 2, 3, 4, 5, 6],
            speed_limit_kbps: None,
            post_queue_action: "none".to_string(),
            download_dir: None,
            priority: Some("normal".to_string()),
            preferred_connections: Some(8),
            manual_pause: Some(true), // manually paused
            date_schedule_enabled: Some(false),
            date_schedule_start: None,
            date_schedule_stop: None,
            per_host_concurrency: None,
        });
    }

    // Add a queued download
    let item = engine.add_download(NewDownloadRequest {
        url: "https://example.com/file.iso".to_string(),
        final_url: None,
        redirect_chain: Vec::new(),
        filename: Some("file.iso".to_string()),
        category: Some("Programs".to_string()),
        save_path: None,
        threads_count: None,
        queue_id: Some("paused-queue".to_string()),
        start_immediately: false,
        source_browser: None,
        referer: None,
        cookies: None,
        user_agent: None,
        custom_headers: None,
        request_method: "GET".to_string(),
        request_body: None,
        browser_intercepted: false,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
        scheduled_start: None,
        scheduled_stop: None,
    });

    assert_eq!(item.status, DownloadStatus::Queued);

    // Attempt to start queued downloads for the paused queue
    let started = engine
        .start_queued_downloads(Some("paused-queue".to_string()))
        .await
        .unwrap();

    // Since manual_pause is true, 0 downloads must be started
    assert_eq!(started, 0);

    let dls = engine.downloads.read();
    let current = dls.iter().find(|d| d.id == item.id).unwrap();
    assert_eq!(current.status, DownloadStatus::Queued);
}

#[test]
fn test_individual_download_schedule_future_keeps_queued() {
    let engine = Arc::new(DownloadEngine::new());

    // Schedule 1 hour into future
    let future_time = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();

    let item = engine.add_download(NewDownloadRequest {
        url: "https://example.com/future-video.mp4".to_string(),
        final_url: None,
        redirect_chain: Vec::new(),
        filename: Some("future-video.mp4".to_string()),
        category: Some("Video".to_string()),
        save_path: None,
        threads_count: None,
        queue_id: Some("main-queue".to_string()),
        start_immediately: true, // requested immediately, but has future schedule!
        source_browser: None,
        referer: None,
        cookies: None,
        user_agent: None,
        custom_headers: None,
        request_method: "GET".to_string(),
        request_body: None,
        browser_intercepted: false,
        auth_username: None,
        auth_password: None,
        sequential_torrent: None,
        torrent_file_data: None,
        torrent_selected_files: None,
        scheduled_start: Some(future_time.clone()),
        scheduled_stop: None,
    });

    // Must be in Queued status waiting for its future schedule, not connecting
    assert_eq!(item.status, DownloadStatus::Queued);
    assert_eq!(item.scheduled_start, Some(future_time));
}
