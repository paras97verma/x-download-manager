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
        let weekday = now.weekday().num_days_from_sunday() as u8;

        let queues = engine.settings.read().queues.clone();
        for q in queues {
            if !q.days_of_week.contains(&weekday) {
                continue;
            }
            if q.start_time_enabled && q.start_time_hhmm == current_hhmm {
                // Promote queued downloads in this queue up to max_concurrent
                let mut dls = engine.downloads.write();
                let active_in_q = dls
                    .iter()
                    .filter(|d| d.queue_id == q.id && d.status == DownloadStatus::Downloading)
                    .count();

                let mut slots = q.max_concurrent.saturating_sub(active_in_q);
                for d in dls.iter_mut() {
                    if slots == 0 {
                        break;
                    }
                    if d.queue_id == q.id && d.status == DownloadStatus::Queued {
                        d.status = DownloadStatus::Downloading;
                        d.transfer_log
                            .push(format!("Scheduled queue '{}' started download", q.name));
                        slots -= 1;
                    }
                }
            }

            if q.stop_time_enabled && q.stop_time_hhmm == current_hhmm {
                let mut dls = engine.downloads.write();
                for d in dls.iter_mut() {
                    if d.queue_id == q.id && d.status == DownloadStatus::Downloading {
                        d.status = DownloadStatus::Paused;
                        d.speed_bps = 0;
                        d.transfer_log.push(format!(
                            "Scheduled queue '{}' paused download at stop window",
                            q.name
                        ));
                    }
                }
            }
        }
    }
}
