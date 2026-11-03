//! Media Download Pipeline Subsystem (`docs/YouTube_Download_Integration_Codex_Prompt.md`)
//!
//! Handles:
//! - YouTube video ID and URL parsing.
//! - Quality ranking and preset selection (Best Quality, Maximum Resolution, Balanced, Audio Only).
//! - Dual-track download orchestration (separate video & audio streams).
//! - Stream-copy remuxing (combining video & audio streams into MP4/MKV/WebM without re-encoding).
//! - SQLite `media_jobs` tracking and lifecycle synchronization.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use uuid::Uuid;

use crate::db::MediaJobRecord;
use crate::engine::{DownloadEngine, NewDownloadRequest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFormatOption {
    pub format_id: String,
    pub media_type: String, // "video_audio", "video_only", "audio_only"
    pub container: String,  // "mp4", "webm", "m4a", "opus", "mkv"
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub video_bitrate: Option<u64>,
    pub audio_bitrate: Option<u64>,
    pub estimated_size_bytes: Option<u64>,
    pub requires_muxing: bool,
    pub video_stream_url: Option<String>,
    pub audio_stream_url: Option<String>,
    pub combined_stream_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaMetadataResponse {
    pub video_id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_seconds: Option<u64>,
    pub thumbnail_url: Option<String>,
    pub license_type: String, // "creative_commons", "standard", "public_domain", "studio_own"
    pub formats: Vec<MediaFormatOption>,
    pub best_quality_format_id: Option<String>,
    pub max_resolution_format_id: Option<String>,
    pub audio_only_format_id: Option<String>,
    pub balanced_format_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownloadRequest {
    pub video_id: String,
    pub source_url: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub duration_seconds: Option<u64>,
    pub thumbnail_url: Option<String>,
    pub license_type: Option<String>,
    pub format_id: String,
    pub container: String,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub video_stream_url: Option<String>,
    pub audio_stream_url: Option<String>,
    pub combined_stream_url: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub output_filename: Option<String>,
    pub queue_id: Option<String>,
    pub save_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownloadResponse {
    pub accepted: bool,
    pub media_job_id: String,
    pub video_download_id: Option<String>,
    pub audio_download_id: Option<String>,
    pub message: String,
}

/// Extracts the 11-character YouTube video ID from various URL formats:
/// - https://www.youtube.com/watch?v=dQw4w9WgXcQ
/// - https://youtu.be/dQw4w9WgXcQ
/// - https://www.youtube.com/shorts/dQw4w9WgXcQ
/// - https://www.youtube.com/embed/dQw4w9WgXcQ
pub fn extract_youtube_video_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();

    if host.contains("youtu.be") {
        let path = parsed.path().trim_start_matches('/');
        let id = path.split('/').next()?;
        if id.len() == 11 {
            return Some(id.to_string());
        }
    }

    if host.contains("youtube.com") {
        if parsed.path() == "/watch" {
            for (k, v) in parsed.query_pairs() {
                if k == "v" && v.len() == 11 {
                    return Some(v.to_string());
                }
            }
        }
        if parsed.path().starts_with("/shorts/") {
            let id = parsed
                .path()
                .trim_start_matches("/shorts/")
                .split('/')
                .next()?;
            if id.len() == 11 {
                return Some(id.to_string());
            }
        }
        if parsed.path().starts_with("/embed/") {
            let id = parsed
                .path()
                .trim_start_matches("/embed/")
                .split('/')
                .next()?;
            if id.len() == 11 {
                return Some(id.to_string());
            }
        }
    }

    None
}

/// Calculates the quality ranking score for a media format option
pub fn calculate_format_score(format: &MediaFormatOption, compatibility_first: bool) -> u64 {
    let mut score = 0u64;

    // 1. Resolution score (height * 10,000)
    if let Some(ref res) = format.resolution {
        let clean = res.trim().to_lowercase();
        let height: u64 = if clean.contains("4320") || clean.contains("8k") {
            4320
        } else if clean.contains("2160") || clean.contains("4k") {
            2160
        } else if clean.contains("1440") || clean.contains("2k") {
            1440
        } else if clean.contains("1080") {
            1080
        } else if clean.contains("720") {
            720
        } else if clean.contains("480") {
            480
        } else if clean.contains("360") {
            360
        } else if clean.contains("240") {
            240
        } else if clean.contains("144") {
            144
        } else {
            clean
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        };
        score += height * 10_000;
    }

    // 2. FPS score (fps * 100)
    if let Some(fps) = format.fps {
        score += (fps as u64) * 100;
    }

    // 3. Codec and Container weighting
    if compatibility_first {
        if format
            .video_codec
            .as_deref()
            .is_some_and(|c| c.to_lowercase().contains("h264") || c.to_lowercase().contains("avc"))
        {
            score += 500;
        }
        if format.container.eq_ignore_ascii_case("mp4") {
            score += 200;
        }
        if format
            .audio_codec
            .as_deref()
            .is_some_and(|c| c.to_lowercase().contains("aac"))
        {
            score += 200;
        }
    } else {
        if format
            .video_codec
            .as_deref()
            .is_some_and(|c| c.to_lowercase().contains("av1"))
        {
            score += 600;
        } else if format
            .video_codec
            .as_deref()
            .is_some_and(|c| c.to_lowercase().contains("vp9"))
        {
            score += 400;
        }
        if format
            .audio_codec
            .as_deref()
            .is_some_and(|c| c.to_lowercase().contains("opus"))
        {
            score += 300;
        }
    }

    // 4. Bitrate tie-breaker
    if let Some(vb) = format.video_bitrate {
        score += vb.min(100_000_000) / 100_000;
    } else if let Some(ab) = format.audio_bitrate {
        score += ab.min(1_000_000) / 1_000;
    }

    score
}

/// Deterministically ranks formats and selects preset format IDs
pub fn rank_media_formats(
    formats: &mut [MediaFormatOption],
    compatibility_first: bool,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    if formats.is_empty() {
        return (None, None, None, None);
    }

    // Sort descending by score
    formats.sort_by(|a, b| {
        let score_b = calculate_format_score(b, compatibility_first);
        let score_a = calculate_format_score(a, compatibility_first);
        score_b.cmp(&score_a)
    });

    let mut best_quality_id = None;
    let mut max_res_id = None;
    let mut audio_only_id = None;
    let mut balanced_id = None;

    let mut max_height = 0u64;
    let mut max_audio_bitrate = 0u64;

    for f in formats.iter() {
        if f.media_type == "audio_only" {
            let ab = f.audio_bitrate.unwrap_or(0);
            if audio_only_id.is_none() || ab > max_audio_bitrate {
                max_audio_bitrate = ab;
                audio_only_id = Some(f.format_id.clone());
            }
            continue;
        }

        // For video streams:
        if best_quality_id.is_none() {
            best_quality_id = Some(f.format_id.clone());
        }

        let height = f
            .resolution
            .as_deref()
            .and_then(|r| {
                r.chars()
                    .filter(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .ok()
            })
            .unwrap_or(0);

        if height > max_height {
            max_height = height;
            max_res_id = Some(f.format_id.clone());
        }

        if balanced_id.is_none() && (height == 720 || height == 1080) {
            balanced_id = Some(f.format_id.clone());
        }
    }

    if balanced_id.is_none() {
        balanced_id = best_quality_id.clone();
    }

    (best_quality_id, max_res_id, audio_only_id, balanced_id)
}

/// Locates the ffmpeg executable on the host system if available
pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    // 1. Check PATH
    if let Ok(output) = Command::new("which").arg("ffmpeg").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() && Path::new(&path_str).exists() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    // 2. Check well-known installation paths
    let candidates = [
        "/usr/local/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/bin/ffmpeg",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
    ];

    for c in &candidates {
        let p = Path::new(c);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }

    None
}

/// Losslessly muxes video and audio streams into a combined output container using stream-copy (`-c copy`)
pub fn mux_media_tracks(
    video_path: &Path,
    audio_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    if !video_path.exists() {
        return Err(format!("Video track not found on disk at {:?}", video_path));
    }
    if !audio_path.exists() {
        return Err(format!("Audio track not found on disk at {:?}", audio_path));
    }

    let ffmpeg_bin = find_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg binary is not found on this system. Please install ffmpeg to enable lossless stream muxing.".to_string())?;

    if let Some(parent) = output_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let status = Command::new(&ffmpeg_bin)
        .arg("-y")
        .arg("-i")
        .arg(video_path)
        .arg("-i")
        .arg(audio_path)
        .arg("-c")
        .arg("copy")
        .arg(output_path)
        .status()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    if !status.success() {
        return Err(format!(
            "FFmpeg stream-copy remux failed with status {:?}",
            status
        ));
    }

    if !output_path.exists() {
        return Err(format!(
            "Muxed output file was not created at {:?}",
            output_path
        ));
    }

    Ok(())
}

/// Submits a parent media job and schedules the necessary video and/or audio download tasks
pub async fn submit_media_download_job(
    engine: &Arc<DownloadEngine>,
    req: &MediaDownloadRequest,
) -> Result<MediaDownloadResponse, String> {
    let media_job_id = format!("mj-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();

    let save_dir = req
        .save_dir
        .clone()
        .unwrap_or_else(|| engine.settings.read().default_download_dir.clone());
    let save_dir_buf = crate::config::resolve_path(&save_dir);
    let _ = std::fs::create_dir_all(&save_dir_buf);

    let clean_title = req
        .title
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = &req.container;
    let final_filename = req.output_filename.clone().unwrap_or_else(|| {
        if let Some(ref res) = req.resolution {
            format!("{} ({}).{}", clean_title, res, ext)
        } else {
            format!("{}.{}", clean_title, ext)
        }
    });
    let final_output_path = save_dir_buf
        .join(&final_filename)
        .to_string_lossy()
        .to_string();

    let queue_id = req
        .queue_id
        .clone()
        .unwrap_or_else(|| "main-queue".to_string());

    let mut video_download_id = None;
    let mut audio_download_id = None;

    if let Some(ref combined_url) = req.combined_stream_url {
        // Single combined stream (does not require separate track muxing)
        let dl_req = NewDownloadRequest {
            url: combined_url.clone(),
            final_url: Some(combined_url.clone()),
            redirect_chain: Vec::new(),
            filename: Some(final_filename.clone()),
            category: Some("Video".to_string()),
            save_path: Some(final_output_path.clone()),
            threads_count: Some(8),
            queue_id: Some(queue_id.clone()),
            start_immediately: true,
            source_browser: Some("YouTube Integration".to_string()),
            referer: Some(req.source_url.clone()),
            cookies: None,
            user_agent: None,
            custom_headers: req.custom_headers.clone(),
            request_method: "GET".to_string(),
            request_body: None,
            browser_intercepted: true,
            auth_username: None,
            auth_password: None,
            sequential_torrent: None,
            torrent_file_data: None,
            torrent_selected_files: None,
            scheduled_start: None,
            scheduled_stop: None,
        };

        let item = engine.add_download(dl_req.clone());
        let _started = engine.start_download_execution(item.clone(), &dl_req).await;
        video_download_id = Some(item.id);
    } else {
        // Separate video and/or audio tracks
        if let Some(ref v_url) = req.video_stream_url {
            let v_filename = format!("{}.video.part", final_filename);
            let v_path = save_dir_buf.join(&v_filename).to_string_lossy().to_string();

            let v_req = NewDownloadRequest {
                url: v_url.clone(),
                final_url: Some(v_url.clone()),
                redirect_chain: Vec::new(),
                filename: Some(v_filename),
                category: Some("Video".to_string()),
                save_path: Some(v_path),
                threads_count: Some(8),
                queue_id: Some(queue_id.clone()),
                start_immediately: true,
                source_browser: Some("YouTube Integration".to_string()),
                referer: Some(req.source_url.clone()),
                cookies: None,
                user_agent: None,
                custom_headers: req.custom_headers.clone(),
                request_method: "GET".to_string(),
                request_body: None,
                browser_intercepted: true,
                auth_username: None,
                auth_password: None,
                sequential_torrent: None,
                torrent_file_data: None,
                torrent_selected_files: None,
                scheduled_start: None,
                scheduled_stop: None,
            };

            let v_item = engine.add_download(v_req.clone());
            let _started = engine
                .start_download_execution(v_item.clone(), &v_req)
                .await;
            video_download_id = Some(v_item.id);
        }

        if let Some(ref a_url) = req.audio_stream_url {
            let a_filename = if req.video_stream_url.is_some() {
                format!("{}.audio.part", final_filename)
            } else {
                final_filename.clone()
            };
            let a_path = save_dir_buf.join(&a_filename).to_string_lossy().to_string();

            let a_req = NewDownloadRequest {
                url: a_url.clone(),
                final_url: Some(a_url.clone()),
                redirect_chain: Vec::new(),
                filename: Some(a_filename),
                category: Some("Music".to_string()),
                save_path: Some(a_path),
                threads_count: Some(4),
                queue_id: Some(queue_id.clone()),
                start_immediately: true,
                source_browser: Some("YouTube Integration".to_string()),
                referer: Some(req.source_url.clone()),
                cookies: None,
                user_agent: None,
                custom_headers: req.custom_headers.clone(),
                request_method: "GET".to_string(),
                request_body: None,
                browser_intercepted: true,
                auth_username: None,
                auth_password: None,
                sequential_torrent: None,
                torrent_file_data: None,
                torrent_selected_files: None,
                scheduled_start: None,
                scheduled_stop: None,
            };

            let a_item = engine.add_download(a_req.clone());
            let _started = engine
                .start_download_execution(a_item.clone(), &a_req)
                .await;
            audio_download_id = Some(a_item.id);
        }
    }

    let _ = engine.persist_downloads();

    let initial_status = if req.video_stream_url.is_some() && req.audio_stream_url.is_some() {
        "downloading"
    } else {
        "pending"
    };

    let record = MediaJobRecord {
        id: media_job_id.clone(),
        source_platform: "youtube".to_string(),
        source_url: req.source_url.clone(),
        video_id: req.video_id.clone(),
        title: req.title.clone(),
        channel_name: req.channel_name.clone(),
        duration_seconds: req.duration_seconds,
        thumbnail_url: req.thumbnail_url.clone(),
        license_type: req
            .license_type
            .clone()
            .unwrap_or_else(|| "standard".to_string()),
        selected_format: req.format_id.clone(),
        selected_resolution: req.resolution.clone(),
        selected_fps: req.fps,
        video_codec: req.video_codec.clone(),
        audio_codec: req.audio_codec.clone(),
        video_download_id: video_download_id.clone(),
        audio_download_id: audio_download_id.clone(),
        output_container: req.container.clone(),
        final_output_path,
        mux_status: initial_status.to_string(),
        mux_error: None,
        created_at: now,
        completed_at: None,
    };

    engine.db.save_media_job(&record)?;

    Ok(MediaDownloadResponse {
        accepted: true,
        media_job_id,
        video_download_id,
        audio_download_id,
        message: "Media download job registered and scheduled successfully in ByteX.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_youtube_video_id() {
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://example.com/not-youtube"),
            None
        );
    }

    #[test]
    fn test_quality_ranking_and_presets() {
        let mut formats = vec![
            MediaFormatOption {
                format_id: "720p".to_string(),
                media_type: "video_audio".to_string(),
                container: "mp4".to_string(),
                resolution: Some("720p".to_string()),
                fps: Some(30),
                video_codec: Some("h264".to_string()),
                audio_codec: Some("aac".to_string()),
                video_bitrate: Some(2_000_000),
                audio_bitrate: Some(128_000),
                estimated_size_bytes: Some(100_000_000),
                requires_muxing: false,
                video_stream_url: None,
                audio_stream_url: None,
                combined_stream_url: Some("https://example.com/720p.mp4".to_string()),
            },
            MediaFormatOption {
                format_id: "1080p60".to_string(),
                media_type: "video_audio".to_string(),
                container: "mp4".to_string(),
                resolution: Some("1080p".to_string()),
                fps: Some(60),
                video_codec: Some("h264".to_string()),
                audio_codec: Some("aac".to_string()),
                video_bitrate: Some(4_500_000),
                audio_bitrate: Some(160_000),
                estimated_size_bytes: Some(250_000_000),
                requires_muxing: true,
                video_stream_url: Some("https://example.com/1080v".to_string()),
                audio_stream_url: Some("https://example.com/1080a".to_string()),
                combined_stream_url: None,
            },
            MediaFormatOption {
                format_id: "4k60".to_string(),
                media_type: "video_audio".to_string(),
                container: "webm".to_string(),
                resolution: Some("2160p".to_string()),
                fps: Some(60),
                video_codec: Some("vp9".to_string()),
                audio_codec: Some("opus".to_string()),
                video_bitrate: Some(15_000_000),
                audio_bitrate: Some(160_000),
                estimated_size_bytes: Some(800_000_000),
                requires_muxing: true,
                video_stream_url: Some("https://example.com/4kv".to_string()),
                audio_stream_url: Some("https://example.com/4ka".to_string()),
                combined_stream_url: None,
            },
            MediaFormatOption {
                format_id: "audio-m4a".to_string(),
                media_type: "audio_only".to_string(),
                container: "m4a".to_string(),
                resolution: None,
                fps: None,
                video_codec: None,
                audio_codec: Some("aac".to_string()),
                video_bitrate: None,
                audio_bitrate: Some(160_000),
                estimated_size_bytes: Some(15_000_000),
                requires_muxing: false,
                video_stream_url: None,
                audio_stream_url: Some("https://example.com/audio.m4a".to_string()),
                combined_stream_url: None,
            },
        ];

        let (best, max_res, audio_only, balanced) = rank_media_formats(&mut formats, true);

        // 4K has the highest score
        assert_eq!(max_res.as_deref(), Some("4k60"));
        assert_eq!(best.as_deref(), Some("4k60"));
        assert_eq!(audio_only.as_deref(), Some("audio-m4a"));
        // Balanced should pick 720p or 1080p
        assert!(balanced == Some("1080p60".to_string()) || balanced == Some("720p".to_string()));
    }
}
