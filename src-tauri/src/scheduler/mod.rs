//! Queue Scheduler & Bandwidth Speed Limiter for ByteX Download Manager
//! Evaluates time-of-day queue windows (e.g., Night Off-Peak Queue), concurrency limits,
//! and post-queue completion actions.

use chrono::{Datelike, Local, Timelike};
use std::process::Child;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use crate::engine::{DownloadEngine, DownloadStatus};

static SLEEP_INHIBITOR: Mutex<Option<Child>> = Mutex::new(None);

fn spawn_sleep_inhibitor() -> std::io::Result<Child> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("caffeinate");
        command.args(["-i", "-s"]);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "$src='using System.Runtime.InteropServices; public static class ByteXPower { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint state); }'; Add-Type -TypeDefinition $src; while ($true) { [ByteXPower]::SetThreadExecutionState(0x80000001); Start-Sleep -Seconds 30 }",
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
    } else if cfg!(target_os = "linux") {
        let mut command = std::process::Command::new("systemd-inhibit");
        command.args([
            "--what=sleep:idle",
            "--mode=block",
            "--who=ByteX Download Manager",
            "--why=Download or upload is active",
            "sleep",
            "infinity",
        ]);
        command
    } else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Sleep prevention is not supported on this operating system",
        ));
    };

    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
}

pub fn update_sleep_prevention(is_downloading: bool, prevent_sleep_setting: bool) {
    if let Ok(mut lock) = SLEEP_INHIBITOR.lock() {
        if is_downloading && prevent_sleep_setting {
            let child_exited = lock
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(Some(_)) | Err(_)));
            if child_exited {
                lock.take();
            }
            if lock.is_none() {
                match spawn_sleep_inhibitor() {
                    Ok(child) => *lock = Some(child),
                    Err(error) => tracing::warn!(%error, "Could not start the OS sleep inhibitor"),
                }
            }
        } else if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn execute_system_action(action: &str) {
    match action {
        "sleep" => {
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("pmset").arg("sleepnow").spawn();
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("rundll32.exe")
                .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                .spawn();
            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("systemctl")
                .arg("suspend")
                .spawn();
        }
        "shutdown" => {
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("osascript")
                .args(["-e", "tell app \"System Events\" to shut down"])
                .spawn();
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("shutdown")
                .args(["/s", "/t", "0"])
                .spawn();
            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("systemctl")
                .arg("poweroff")
                .spawn();
        }
        _ => {}
    }
}

fn queue_window_is_active(
    queue: &crate::config::SchedulerQueueConfig,
    now: chrono::DateTime<Local>,
) -> bool {
    // 1. Manual pause takes absolute precedence
    if queue.manual_pause == Some(true) {
        return false;
    }

    // 2. Date schedule check (specific start date/time and stop date/time)
    if queue.date_schedule_enabled == Some(true) {
        if let Some(ref start_str) = queue.date_schedule_start {
            if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(start_str) {
                if now < start_dt {
                    return false;
                }
            } else if let Ok(naive) =
                chrono::NaiveDateTime::parse_from_str(start_str, "%Y-%m-%dT%H:%M")
            {
                if now.naive_local() < naive {
                    return false;
                }
            }
        }
        if let Some(ref stop_str) = queue.date_schedule_stop {
            if let Ok(stop_dt) = chrono::DateTime::parse_from_rfc3339(stop_str) {
                if now > stop_dt {
                    return false;
                }
            } else if let Ok(naive) =
                chrono::NaiveDateTime::parse_from_str(stop_str, "%Y-%m-%dT%H:%M")
            {
                if now.naive_local() > naive {
                    return false;
                }
            }
        }
    }

    // 3. Weekly / Daily time-of-day window check
    let weekday = now.weekday().num_days_from_sunday() as u8;
    let minute = (now.hour() * 60 + now.minute()) as u16;
    let scheduled = queue.start_time_enabled || queue.stop_time_enabled;
    if !scheduled {
        return true;
    }
    let start = queue
        .start_time_hhmm
        .parse::<chrono::NaiveTime>()
        .ok()
        .map(|time| (time.hour() * 60 + time.minute()) as u16)
        .unwrap_or(0);
    let stop = queue
        .stop_time_hhmm
        .parse::<chrono::NaiveTime>()
        .ok()
        .map(|time| (time.hour() * 60 + time.minute()) as u16)
        .unwrap_or(1439);
    let runs_today = queue.days_of_week.contains(&weekday);

    match (queue.start_time_enabled, queue.stop_time_enabled) {
        (true, true) if start > stop => {
            (runs_today && minute >= start)
                || (queue.days_of_week.contains(&((weekday + 6) % 7)) && minute <= stop)
        }
        (true, true) => runs_today && minute >= start && minute <= stop,
        (true, false) => runs_today && minute >= start,
        (false, true) => runs_today && minute <= stop,
        (false, false) => true,
    }
}

pub async fn run_scheduler_loop(engine: Arc<DownloadEngine>) {
    let mut interval = tokio::time::interval(Duration::from_secs(3));
    loop {
        interval.tick().await;

        if let Err(error) = engine.persist_downloads() {
            tracing::warn!(%error, "Could not persist download history");
        }

        // 1. Maintain active OS sleep inhibitor while transfers are running
        let is_downloading = {
            let dls = engine.downloads.read();
            dls.iter().any(|d| {
                matches!(
                    d.status,
                    DownloadStatus::Connecting
                        | DownloadStatus::Authenticating
                        | DownloadStatus::Downloading
                        | DownloadStatus::Merging
                        | DownloadStatus::Seeding
                )
            })
        };
        let prevent_sleep = engine.settings.read().prevent_system_sleep;
        update_sleep_prevention(is_downloading, prevent_sleep);

        // 2. Evaluate scheduled queue windows & promotion
        let now = Local::now();
        let current_hhmm = format!("{:02}:{:02}", now.hour(), now.minute());
        let queues = engine.settings.read().queues.clone();
        for q in &queues {
            let active = queue_window_is_active(q, now);
            if active {
                let _ = engine.start_queued_downloads(Some(q.id.clone())).await;
            } else if q.manual_pause == Some(true)
                || (q.stop_time_enabled
                    && q.stop_time_hhmm == current_hhmm
                    && q.days_of_week
                        .contains(&(now.weekday().num_days_from_sunday() as u8)))
            {
                let active_ids = {
                    let mut dls = engine.downloads.write();
                    let mut ids = Vec::new();
                    for d in dls.iter_mut() {
                        if d.queue_id == q.id
                            && matches!(
                                d.status,
                                DownloadStatus::Connecting
                                    | DownloadStatus::Downloading
                                    | DownloadStatus::Authenticating
                                    | DownloadStatus::Merging
                                    | DownloadStatus::Seeding
                            )
                        {
                            d.status = DownloadStatus::Paused;
                            d.speed_bps = 0;
                            d.transfer_log.push(format!(
                                "Queue '{}' inactive or paused; download halted",
                                q.name
                            ));
                            ids.push(d.id.clone());
                        }
                    }
                    ids
                };
                for id in active_ids {
                    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
                        let _ = tx.send(true);
                    }
                }
            }
        }

        // 3. Evaluate Individual Download Schedules
        {
            let mut to_start_queues = Vec::new();
            let mut to_pause_ids = Vec::new();

            {
                let dls = engine.downloads.read();
                for d in dls.iter() {
                    // Check individual stop time
                    if let Some(ref stop_str) = d.scheduled_stop {
                        let reached_stop =
                            if let Ok(stop_dt) = chrono::DateTime::parse_from_rfc3339(stop_str) {
                                now >= stop_dt
                            } else if let Ok(naive) =
                                chrono::NaiveDateTime::parse_from_str(stop_str, "%Y-%m-%dT%H:%M")
                            {
                                now.naive_local() >= naive
                            } else {
                                false
                            };

                        if reached_stop
                            && matches!(
                                d.status,
                                DownloadStatus::Connecting
                                    | DownloadStatus::Downloading
                                    | DownloadStatus::Authenticating
                                    | DownloadStatus::Merging
                                    | DownloadStatus::Seeding
                            )
                        {
                            to_pause_ids.push(d.id.clone());
                        }
                    }

                    // Check individual start time
                    if let Some(ref start_str) = d.scheduled_start {
                        let reached_start =
                            if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(start_str) {
                                now >= start_dt
                            } else if let Ok(naive) =
                                chrono::NaiveDateTime::parse_from_str(start_str, "%Y-%m-%dT%H:%M")
                            {
                                now.naive_local() >= naive
                            } else {
                                false
                            };

                        if reached_start
                            && matches!(d.status, DownloadStatus::Queued | DownloadStatus::Paused)
                        {
                            to_start_queues.push(d.queue_id.clone());
                        }
                    }
                }
            }

            // Pause downloads that reached stop time
            if !to_pause_ids.is_empty() {
                {
                    let mut dls = engine.downloads.write();
                    for d in dls.iter_mut() {
                        if to_pause_ids.contains(&d.id) {
                            d.status = DownloadStatus::Paused;
                            d.speed_bps = 0;
                            d.transfer_log
                                .push("Scheduled stop time reached; download paused".into());
                        }
                    }
                }
                for id in to_pause_ids {
                    if let Some(tx) = engine.active_cancellations.write().remove(&id) {
                        let _ = tx.send(true);
                    }
                }
            }

            // Promote queues that have items whose start time was reached
            for qid in to_start_queues {
                let _ = engine.start_queued_downloads(Some(qid)).await;
            }
        }

        // 4. BitTorrent Seeding Ratio & Duration Limits
        {
            let seed_limits = {
                let st = engine.settings.read();
                (
                    st.torrent.seed_ratio_limit,
                    st.torrent.seed_time_limit_minutes,
                )
            };
            let (ratio_limit, time_limit_mins) = seed_limits;

            let mut finished_seeding_ids = Vec::new();
            {
                let mut dls = engine.downloads.write();
                for d in dls.iter_mut() {
                    if d.status == DownloadStatus::Seeding {
                        let ratio_reached = d
                            .torrent_meta
                            .as_ref()
                            .map(|m| m.share_ratio >= ratio_limit)
                            .unwrap_or(false);

                        let time_reached = if time_limit_mins > 0 {
                            if let Some(ref comp_at) = d.completed_at {
                                if let Ok(completed_dt) =
                                    chrono::DateTime::parse_from_rfc3339(comp_at)
                                {
                                    let seeded_seconds =
                                        (now.to_utc() - completed_dt.to_utc()).num_seconds().max(0)
                                            as u64;
                                    seeded_seconds >= time_limit_mins * 60
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        if ratio_reached || time_reached {
                            d.status = DownloadStatus::Completed;
                            d.speed_bps = 0;
                            d.upload_speed_bps = 0;
                            let reason = if ratio_reached {
                                format!(
                                    "Seeding finished: reached target ratio ({:.2})",
                                    ratio_limit
                                )
                            } else {
                                format!(
                                    "Seeding finished: reached max duration ({} mins)",
                                    time_limit_mins
                                )
                            };
                            d.transfer_log.push(reason);
                            finished_seeding_ids.push(d.id.clone());
                        }
                    }
                }
            }

            for id in finished_seeding_ids {
                if let Some(tx) = engine.active_cancellations.write().remove(&id) {
                    let _ = tx.send(true);
                }
            }
        }
    }
}
