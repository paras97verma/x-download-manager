//! Queue Scheduler & Bandwidth Speed Limiter for X Download Manager
//! Evaluates time-of-day queue windows (e.g., Night Off-Peak Queue), concurrency limits,
//! and post-queue completion actions.

use chrono::{Datelike, Local, Timelike};
use std::process::Child;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use crate::engine::{DownloadEngine, DownloadStatus};

static SLEEP_INHIBITOR: Mutex<Option<Child>> = Mutex::new(None);

pub fn update_sleep_prevention(is_downloading: bool, prevent_sleep_setting: bool) {
    if let Ok(mut lock) = SLEEP_INHIBITOR.lock() {
        if is_downloading && prevent_sleep_setting {
            if lock.is_none() {
                #[cfg(target_os = "macos")]
                {
                    if let Ok(child) = std::process::Command::new("caffeinate")
                        .args(["-d", "-i", "-m"])
                        .spawn()
                    {
                        *lock = Some(child);
                    }
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

        // 1. Maintain active OS sleep inhibitor while transfers are running
        let is_downloading = {
            let dls = engine.downloads.read();
            dls.iter().any(|d| d.status == DownloadStatus::Downloading)
        };
        let prevent_sleep = engine.settings.read().prevent_system_sleep;
        update_sleep_prevention(is_downloading, prevent_sleep);

        // 2. Evaluate scheduled queue windows & promotion
        let now = Local::now();
        let current_hhmm = format!("{:02}:{:02}", now.hour(), now.minute());
        let queues = engine.settings.read().queues.clone();
        for q in queues {
            if queue_window_is_active(&q, now) {
                let _ = engine.start_queued_downloads(Some(q.id.clone())).await;
            }

            if q.stop_time_enabled
                && q.stop_time_hhmm == current_hhmm
                && q.days_of_week
                    .contains(&(now.weekday().num_days_from_sunday() as u8))
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
                                "Scheduled queue '{}' paused download at stop window",
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
    }
}
