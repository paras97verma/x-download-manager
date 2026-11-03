//! Integration Tests: YouTube Video/Audio Pipeline, Media Job Persistence & Stream-Copy Remuxing

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use xdm_lib::engine::media_pipeline::*;
use xdm_lib::engine::DownloadEngine;

fn create_temp_engine() -> (Arc<DownloadEngine>, tempfile::TempDir) {
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let db_path = temp_dir.path().join("bytex.db");
    let history_path = temp_dir.path().join("downloads.json");

    let db =
        Arc::new(xdm_lib::db::DatabaseManager::open(&db_path).expect("Failed to open temp db"));
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

#[test]
fn test_youtube_video_id_extraction_all_variants() {
    // Standard watch URL
    assert_eq!(
        extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Watch URL with extra query params
    assert_eq!(
        extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&t=42s"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Short youtu.be URL
    assert_eq!(
        extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Mobile YouTube URL
    assert_eq!(
        extract_youtube_video_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Shorts URL
    assert_eq!(
        extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Embed URL
    assert_eq!(
        extract_youtube_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );

    // Invalid or foreign domains
    assert_eq!(
        extract_youtube_video_id("https://vimeo.com/123456789"),
        None
    );
    assert_eq!(
        extract_youtube_video_id("https://example.com/watch?v=dQw4w9WgXcQ"),
        None
    );
    assert_eq!(
        extract_youtube_video_id("https://www.youtube.com/feed/subscriptions"),
        None
    );
    assert_eq!(extract_youtube_video_id("not-a-url"), None);
}

#[test]
fn test_quality_score_ranking_and_presets() {
    let mut formats = vec![
        MediaFormatOption {
            format_id: "audio-m4a".to_string(),
            media_type: "audio_only".to_string(),
            container: "m4a".to_string(),
            resolution: None,
            fps: None,
            video_codec: None,
            audio_codec: Some("aac".to_string()),
            video_bitrate: None,
            audio_bitrate: Some(128_000),
            estimated_size_bytes: Some(12_000_000),
            requires_muxing: false,
            video_stream_url: None,
            audio_stream_url: None,
            combined_stream_url: None,
        },
        MediaFormatOption {
            format_id: "720p-mp4".to_string(),
            media_type: "video_audio_combined".to_string(),
            container: "mp4".to_string(),
            resolution: Some("720p".to_string()),
            fps: Some(30),
            video_codec: Some("avc1.4d401f".to_string()),
            audio_codec: Some("mp4a.40.2".to_string()),
            video_bitrate: Some(2_000_000),
            audio_bitrate: Some(128_000),
            estimated_size_bytes: Some(85_000_000),
            requires_muxing: false,
            video_stream_url: None,
            audio_stream_url: None,
            combined_stream_url: None,
        },
        MediaFormatOption {
            format_id: "1080p60-mp4".to_string(),
            media_type: "video_only".to_string(),
            container: "mp4".to_string(),
            resolution: Some("1080p".to_string()),
            fps: Some(60),
            video_codec: Some("avc1.64002a".to_string()),
            audio_codec: None,
            video_bitrate: Some(4_500_000),
            audio_bitrate: None,
            estimated_size_bytes: Some(220_000_000),
            requires_muxing: true,
            video_stream_url: None,
            audio_stream_url: None,
            combined_stream_url: None,
        },
        MediaFormatOption {
            format_id: "4k-webm".to_string(),
            media_type: "video_only".to_string(),
            container: "webm".to_string(),
            resolution: Some("2160p".to_string()),
            fps: Some(60),
            video_codec: Some("vp9".to_string()),
            audio_codec: None,
            video_bitrate: Some(18_000_000),
            audio_bitrate: None,
            estimated_size_bytes: Some(950_000_000),
            requires_muxing: true,
            video_stream_url: None,
            audio_stream_url: None,
            combined_stream_url: None,
        },
    ];

    let (best, max_res, audio_only, balanced) = rank_media_formats(&mut formats, true);

    // In preferred MP4 mode:
    // Max resolution should select 4k-webm (2160p)
    assert_eq!(max_res.as_deref(), Some("4k-webm"));

    // Best quality should pick 4k-webm (highest scored format)
    assert_eq!(best.as_deref(), Some("4k-webm"));

    // Audio only should pick audio-m4a
    assert_eq!(audio_only.as_deref(), Some("audio-m4a"));

    // Balanced should pick 720p-mp4 or 1080p60-mp4
    assert!(
        balanced == Some("720p-mp4".to_string()) || balanced == Some("1080p60-mp4".to_string())
    );
}

#[tokio::test]
async fn test_submit_media_download_job_dual_track() {
    let (engine, _temp_dir) = create_temp_engine();

    let req = MediaDownloadRequest {
        video_id: "dQw4w9WgXcQ".to_string(),
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
        title: "Rick Astley - Never Gonna Give You Up (Official Music Video)".to_string(),
        channel_name: Some("Rick Astley".to_string()),
        duration_seconds: Some(213),
        thumbnail_url: Some("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg".to_string()),
        license_type: Some("standard".to_string()),
        format_id: "1080p-avc1".to_string(),
        container: "mp4".to_string(),
        resolution: Some("1080p".to_string()),
        fps: Some(60),
        video_codec: Some("avc1.64002a".to_string()),
        audio_codec: Some("aac".to_string()),
        video_stream_url: Some("https://example.com/video_stream.mp4".to_string()),
        audio_stream_url: Some("https://example.com/audio_stream.m4a".to_string()),
        combined_stream_url: None,
        custom_headers: Some(HashMap::new()),
        output_filename: Some("rick_astley_1080p.mp4".to_string()),
        queue_id: Some("main-queue".to_string()),
        save_dir: None,
    };

    let resp = submit_media_download_job(&engine, &req)
        .await
        .expect("Submitting dual-track media job must succeed");

    assert!(resp.accepted);
    assert!(!resp.media_job_id.is_empty());
    assert!(resp.video_download_id.is_some());
    assert!(resp.audio_download_id.is_some());

    // Verify downloads in engine
    let dls = engine.downloads.read().clone();
    assert!(dls
        .iter()
        .any(|d| d.id == resp.video_download_id.clone().unwrap()));
    assert!(dls
        .iter()
        .any(|d| d.id == resp.audio_download_id.clone().unwrap()));

    // Verify record in SQLite database
    let job_opt = engine
        .db
        .get_media_job(&resp.media_job_id)
        .expect("Querying media job from DB must succeed");
    assert!(job_opt.is_some());

    let job = job_opt.unwrap();
    assert_eq!(job.video_id, "dQw4w9WgXcQ");
    assert_eq!(job.selected_format, "1080p-avc1");
    assert_eq!(job.output_container, "mp4");
    assert_eq!(job.mux_status, "downloading");
    assert_eq!(job.video_download_id, resp.video_download_id);
    assert_eq!(job.audio_download_id, resp.audio_download_id);

    // Test query by video ID
    let by_vid = engine
        .db
        .get_media_job_by_video_id("dQw4w9WgXcQ")
        .expect("Query by video id must succeed");
    assert!(by_vid.is_some());
    assert_eq!(by_vid.unwrap().id, resp.media_job_id);

    // Test status update
    engine
        .db
        .update_media_job_mux_status(&resp.media_job_id, "muxing", None, None)
        .expect("Update status must succeed");

    let updated = engine
        .db
        .get_media_job(&resp.media_job_id)
        .unwrap()
        .unwrap();
    assert_eq!(updated.mux_status, "muxing");

    let now = chrono::Utc::now().to_rfc3339();
    engine
        .db
        .update_media_job_mux_status(&resp.media_job_id, "completed", None, Some(&now))
        .expect("Update status to completed must succeed");

    let completed_job = engine
        .db
        .get_media_job(&resp.media_job_id)
        .unwrap()
        .unwrap();
    assert_eq!(completed_job.mux_status, "completed");
    assert!(completed_job.completed_at.is_some());
}

#[tokio::test]
async fn test_submit_media_download_job_single_stream() {
    let (engine, _temp_dir) = create_temp_engine();

    let req = MediaDownloadRequest {
        video_id: "jNQXAC9IVRw".to_string(), // Me at the zoo (first YouTube video)
        source_url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string(),
        title: "Me at the zoo".to_string(),
        channel_name: Some("jawed".to_string()),
        duration_seconds: Some(19),
        thumbnail_url: Some("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg".to_string()),
        license_type: Some("public_domain".to_string()),
        format_id: "audio-only-aac".to_string(),
        container: "m4a".to_string(),
        resolution: None,
        fps: None,
        video_codec: None,
        audio_codec: Some("aac".to_string()),
        video_stream_url: None,
        audio_stream_url: Some("https://example.com/audio.m4a".to_string()),
        combined_stream_url: None,
        custom_headers: None,
        output_filename: Some("me_at_the_zoo_audio.m4a".to_string()),
        queue_id: Some("main-queue".to_string()),
        save_dir: None,
    };

    let resp = submit_media_download_job(&engine, &req)
        .await
        .expect("Submitting single-track audio job must succeed");

    assert!(resp.accepted);
    assert!(resp.audio_download_id.is_some());
    assert!(resp.video_download_id.is_none());

    let all_jobs = engine
        .db
        .list_media_jobs()
        .expect("Listing media jobs must succeed");
    assert!(all_jobs.iter().any(|j| j.id == resp.media_job_id));
}

#[test]
fn test_mux_media_tracks_error_handling_for_missing_files() {
    let video_path = PathBuf::from("/tmp/nonexistent_video_track_12345.mp4");
    let audio_path = PathBuf::from("/tmp/nonexistent_audio_track_12345.m4a");
    let output_path = PathBuf::from("/tmp/nonexistent_output_12345.mp4");

    let result = mux_media_tracks(&video_path, &audio_path, &output_path);
    assert!(
        result.is_err(),
        "Muxing nonexistent files must return an error without panicking"
    );
}

#[test]
fn test_ffmpeg_binary_finder() {
    // find_ffmpeg_binary should safely check PATH and well-known locations
    let ffmpeg = find_ffmpeg_binary();
    if let Some(ref path) = ffmpeg {
        assert!(!path.is_empty());
    }
}
