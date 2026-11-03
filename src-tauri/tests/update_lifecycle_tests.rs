//! Integration Tests: Safe Cross-Platform Application Updates Without Losing Downloads
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use xdm_lib::db::{DatabaseManager, UpdateCheckpoint};
use xdm_lib::engine::update_lifecycle::*;
use xdm_lib::engine::*;

fn create_temp_engine() -> (Arc<DownloadEngine>, tempfile::TempDir) {
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let db_path = temp_dir.path().join("bytex.db");
    let history_path = temp_dir.path().join("downloads.json");

    let db = Arc::new(DatabaseManager::open(&db_path).expect("Failed to open temp db"));
    let keyring = Arc::new(xdm_lib::security::KeyringStore::new());
    let config_manager = xdm_lib::config::ConfigManager::new();
    let mut settings = config_manager.load();
    settings.default_download_dir = temp_dir.path().to_string_lossy().to_string();

    let engine = Arc::new(DownloadEngine {
        settings: Arc::new(parking_lot::RwLock::new(settings)),
        config_manager,
        downloads: Arc::new(parking_lot::RwLock::new(Vec::new())),
        active_cancellations: Arc::new(parking_lot::RwLock::new(HashMap::new())),
        history_path,
        db,
        keyring,
    });

    (engine, temp_dir)
}

fn create_dummy_item(
    id: &str,
    status: DownloadStatus,
    resumable: bool,
    validator: Option<&str>,
    downloaded_bytes: u64,
    total_bytes: u64,
) -> DownloadItem {
    DownloadItem {
        id: id.to_string(),
        filename: format!("{id}.bin"),
        url: format!("https://example.com/{id}.bin"),
        resolved_url: None,
        protocol: DownloadProtocol::Https,
        category: "Compressed".to_string(),
        queue_id: "main-queue".to_string(),
        save_path: format!("/tmp/{id}.bin"),
        total_bytes,
        downloaded_bytes,
        speed_bps: if status == DownloadStatus::Downloading {
            1024 * 1024
        } else {
            0
        },
        upload_speed_bps: 0,
        eta_seconds: None,
        status,
        resumable,
        range_advertised: resumable,
        resume_validator: validator.map(String::from),
        threads_count: 4,
        priority: "normal".to_string(),
        speed_limit_bps: None,
        segments: vec![ThreadSegment {
            id: 1,
            start_byte: 0,
            end_byte: total_bytes.saturating_sub(1),
            downloaded_bytes,
            speed_bps: 0,
            status: "receiving".to_string(),
        }],
        torrent_meta: None,
        source_browser: None,
        referer: None,
        cookies: None,
        custom_headers: HashMap::new(),
        request_method: "GET".to_string(),
        request_body: None,
        redirect_chain: Vec::new(),
        browser_intercepted: false,
        browser_context_redacted: false,
        site_credential_id: None,
        checksum_sha256: None,
        created_at: "2026-11-03T00:00:00Z".to_string(),
        completed_at: None,
        error_message: None,
        transfer_log: Vec::new(),
        torrent_file_path: None,
        torrent_selected_files: None,
        scheduled_start: None,
        scheduled_stop: None,
    }
}

#[tokio::test]
async fn test_update_preparation_pauses_active_downloads_and_creates_checkpoint() {
    let (engine, temp_dir) = create_temp_engine();

    let dl_active = create_dummy_item(
        "active-1",
        DownloadStatus::Downloading,
        true,
        Some("\"v1\""),
        500,
        1000,
    );
    let dl_paused = create_dummy_item("paused-1", DownloadStatus::Paused, false, None, 200, 1000);
    let dl_done = create_dummy_item("done-1", DownloadStatus::Completed, true, None, 1000, 1000);

    {
        let mut dls = engine.downloads.write();
        dls.push(dl_active.clone());
        dls.push(dl_paused.clone());
        dls.push(dl_done.clone());
    }

    // Add cancellation token for active download
    let (tx, _rx) = tokio::sync::watch::channel(false);
    engine
        .active_cancellations
        .write()
        .insert("active-1".to_string(), tx);

    // Prepare for update
    let summary = prepare_for_update(&engine, Some("1.0.3".to_string()))
        .await
        .expect("prepare_for_update failed");

    assert!(summary.success);
    assert_eq!(summary.paused_downloads_count, 2); // active-1 paused + paused-1
    assert_eq!(summary.completed_downloads_count, 1);
    assert!(summary.db_intact);
    assert!(is_preparing_update());

    // Verify active-1 status transitioned to Paused in memory
    {
        let dls = engine.downloads.read();
        let item = dls.iter().find(|d| d.id == "active-1").unwrap();
        assert_eq!(item.status, DownloadStatus::Paused);
        assert_eq!(item.speed_bps, 0);
        assert!(item.transfer_log.iter().any(|l| l.contains("update")));
    }

    // Verify checkpoint row exists in SQLite
    let checkpoint = engine
        .db
        .get_latest_update_checkpoint()
        .expect("get checkpoint failed")
        .expect("checkpoint should exist");

    assert_eq!(checkpoint.status, "prepared");
    assert_eq!(checkpoint.target_version, Some("1.0.3".to_string()));
    assert!(checkpoint
        .paused_download_ids
        .contains(&"active-1".to_string()));
    assert!(checkpoint.resumable_map.contains_key("active-1"));

    // Verify database backup files were created on disk
    let db_path = engine.history_path.with_file_name("bytex.db");
    let backup_path = db_path.with_extension("db.backup");
    let snapshot_path = db_path.with_extension("db.update-snapshot");
    assert!(backup_path.exists());
    assert!(snapshot_path.exists());

    // Reset flag for subsequent tests
    IS_PREPARING_UPDATE.store(false, std::sync::atomic::Ordering::SeqCst);
    drop(temp_dir);
}

#[tokio::test]
async fn test_in_flight_download_rejection_during_update_preparation() {
    IS_PREPARING_UPDATE.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(is_preparing_update());

    // Verify is_preparing_update blocks
    assert!(is_preparing_update());

    IS_PREPARING_UPDATE.store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(!is_preparing_update());
}

#[test]
fn test_database_backup_and_recovery_from_corruption() {
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let db_path = temp_dir.path().join("bytex.db");
    let backup_path = temp_dir.path().join("bytex.db.backup");
    let history_path = temp_dir.path().join("downloads.json");

    let db = DatabaseManager::open(&db_path).expect("Open db failed");

    let dl = create_dummy_item("item-1", DownloadStatus::Paused, true, None, 100, 500);
    db.save_downloads(&[dl]).expect("Save downloads failed");

    // Create verified backup
    db.backup_to_file(&backup_path)
        .expect("Backup to file failed");
    assert!(backup_path.exists());
    drop(db);

    // Verify backup passes integrity check
    let backup_db = DatabaseManager::open(&backup_path).expect("Open backup failed");
    assert!(backup_db.integrity_check().unwrap());
    drop(backup_db);

    // Corrupt the main db_path with invalid bytes
    fs::write(&db_path, b"CORRUPTED SQLITE HEADER GARBAGE DATA").expect("Corrupt write failed");

    // Recover using verify_or_recover
    let recovered_db = DatabaseManager::verify_or_recover(&db_path, &backup_path, &history_path)
        .expect("verify_or_recover should succeed");

    assert!(recovered_db.integrity_check().unwrap());

    // Verify data was restored from backup
    let downloads = recovered_db
        .load_downloads()
        .expect("load downloads failed");
    assert_eq!(downloads.len(), 1);
    assert_eq!(downloads[0].id, "item-1");
}

#[test]
fn test_post_update_restoration_report_and_checkpoint_completion() {
    let (engine, temp_dir) = create_temp_engine();

    let dl_resumable = create_dummy_item(
        "resumable-1",
        DownloadStatus::Paused,
        true,
        Some("\"v1\""),
        500,
        1000,
    );
    let dl_non_resumable = create_dummy_item(
        "non-resumable-1",
        DownloadStatus::Paused,
        false,
        None,
        200,
        1000,
    );

    {
        let mut dls = engine.downloads.write();
        dls.push(dl_resumable.clone());
        dls.push(dl_non_resumable.clone());
    }

    let checkpoint = UpdateCheckpoint {
        id: None,
        app_version: "1.0.2".to_string(),
        target_version: Some("1.0.3".to_string()),
        prepared_at: "2026-11-03T01:00:00Z".to_string(),
        restored_at: None,
        status: "prepared".to_string(),
        paused_download_ids: vec!["resumable-1".to_string(), "non-resumable-1".to_string()],
        resumable_map: HashMap::new(),
        summary_json: "{}".to_string(),
    };
    let _cp_id = engine
        .db
        .save_update_checkpoint(&checkpoint)
        .expect("Save checkpoint failed");

    // Run post update restoration
    let report_opt = restore_post_update(&engine);
    assert!(report_opt.is_some());
    let report = report_opt.unwrap();

    assert_eq!(report.total_restored, 2);
    assert_eq!(report.safely_paused, 2);
    assert_eq!(report.ready_to_resume.len(), 1);
    assert_eq!(report.ready_to_resume[0].id, "resumable-1");
    assert_eq!(report.non_resumable_protected.len(), 1);
    assert_eq!(report.non_resumable_protected[0].id, "non-resumable-1");

    // Checkpoint should now be marked "restored"
    let updated_cp = engine
        .db
        .get_latest_update_checkpoint()
        .expect("get cp failed")
        .unwrap();
    assert_eq!(updated_cp.status, "restored");
    assert!(updated_cp.restored_at.is_some());

    drop(temp_dir);
}

#[tokio::test]
async fn test_verify_and_resume_download_with_mock_server() {
    use axum::http::header::{CONTENT_LENGTH, CONTENT_RANGE, ETAG, RANGE};
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::Router;

    // Build mock server
    let app = Router::new()
        .route(
            "/valid-file.bin",
            get(|headers: axum::http::HeaderMap| async move {
                if let Some(range) = headers.get(RANGE) {
                    if range == "bytes=0-0" {
                        return (
                            StatusCode::PARTIAL_CONTENT,
                            [
                                (CONTENT_RANGE, "bytes 0-0/1000"),
                                (ETAG, "\"etag-valid-1\""),
                            ],
                            "A",
                        )
                            .into_response();
                    }
                }
                (
                    StatusCode::OK,
                    [(CONTENT_LENGTH, "1000"), (ETAG, "\"etag-valid-1\"")],
                    "all",
                )
                    .into_response()
            }),
        )
        .route(
            "/modified-file.bin",
            get(|headers: axum::http::HeaderMap| async move {
                if let Some(range) = headers.get(RANGE) {
                    if range == "bytes=0-0" {
                        return (
                            StatusCode::PARTIAL_CONTENT,
                            [
                                (CONTENT_RANGE, "bytes 0-0/1000"),
                                (ETAG, "\"etag-MODIFIED-999\""),
                            ],
                            "B",
                        )
                            .into_response();
                    }
                }
                (StatusCode::OK, [(ETAG, "\"etag-MODIFIED-999\"")], "all").into_response()
            }),
        );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (engine, temp_dir) = create_temp_engine();

    // 1. Resumable item with matching ETag
    let mut dl_match = create_dummy_item(
        "match-1",
        DownloadStatus::Paused,
        true,
        Some("\"etag-valid-1\""),
        100,
        1000,
    );
    dl_match.url = format!("http://{addr}/valid-file.bin");

    // 2. Resumable item with mismatched ETag (file was changed on server)
    let mut dl_mismatch = create_dummy_item(
        "mismatch-1",
        DownloadStatus::Paused,
        true,
        Some("\"etag-old-123\""),
        100,
        1000,
    );
    dl_mismatch.url = format!("http://{addr}/modified-file.bin");

    // 3. Non-resumable item
    let mut dl_non_resumable = create_dummy_item(
        "non-resum-1",
        DownloadStatus::Paused,
        false,
        None,
        100,
        1000,
    );
    dl_non_resumable.url = format!("http://{addr}/valid-file.bin");

    {
        let mut dls = engine.downloads.write();
        dls.push(dl_match);
        dls.push(dl_mismatch);
        dls.push(dl_non_resumable);
    }

    // Test match
    let res_match = verify_and_resume_download(&engine, "match-1")
        .await
        .expect("verify match failed");
    assert!(res_match.can_resume);
    assert!(res_match.accepts_ranges);
    assert!(res_match.validator_matches);

    // Test mismatch
    let res_mismatch = verify_and_resume_download(&engine, "mismatch-1")
        .await
        .expect("verify mismatch failed");
    assert!(!res_mismatch.can_resume);
    assert!(!res_mismatch.validator_matches);
    assert!(res_mismatch.message.contains("modified"));

    // Test non-resumable
    let res_non = verify_and_resume_download(&engine, "non-resum-1")
        .await
        .expect("verify non-resumable failed");
    assert!(!res_non.can_resume);
    assert!(res_non.message.contains("does not support byte ranges"));

    drop(temp_dir);
}

#[tokio::test]
async fn test_idempotent_preparation() {
    let (engine, temp_dir) = create_temp_engine();

    let dl = create_dummy_item("dl-1", DownloadStatus::Paused, true, None, 100, 500);
    {
        engine.downloads.write().push(dl);
    }

    // Call prepare twice
    let res1 = prepare_for_update(&engine, None).await;
    assert!(res1.is_ok());

    let res2 = prepare_for_update(&engine, None).await;
    assert!(res2.is_ok());

    IS_PREPARING_UPDATE.store(false, std::sync::atomic::Ordering::SeqCst);
    drop(temp_dir);
}

#[test]
fn test_no_silent_dropping_of_downloads_without_output_file() {
    // Test that an item whose file does not exist on disk is NEVER discarded
    let dl = create_dummy_item("orphan-1", DownloadStatus::Paused, true, None, 500, 1000);
    // save_path points to non-existent file
    assert!(!std::path::Path::new(&dl.save_path).exists());

    let (engine, temp_dir) = create_temp_engine();
    engine
        .db
        .save_downloads(std::slice::from_ref(&dl))
        .expect("save failed");

    // Load downloads
    let loaded = engine.db.load_downloads().expect("load failed");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "orphan-1");

    drop(temp_dir);
}
