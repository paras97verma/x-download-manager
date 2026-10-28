//! Queue Scheduler & Bandwidth Speed Limiter for X Download Manager
//! Evaluates time-of-day queue windows (e.g., Night Off-Peak Queue), concurrency limits,
//! and post-queue completion actions.

use chrono::{Datelike, Local, Timelike};
use std::sync::Arc;
use std::time::Duration;

use crate::engine::{DownloadEngine, DownloadStatus};

pub async fn run_scheduler_loop(engine: Arc<DownloadEngine>) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));
    loop {
        interval.tick().await;
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
