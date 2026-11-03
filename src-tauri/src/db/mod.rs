use crate::engine::{
    DownloadItem, DownloadProtocol, DownloadStatus, ThreadSegment, TorrentFileEntry,
    TorrentMetadata,
};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub struct DatabaseManager {
    conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

impl DatabaseManager {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open SQLite database at {:?}: {}", path, e))?;

        let db = Self {
            conn: Mutex::new(conn),
            db_path: path.to_path_buf(),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite database: {}", e))?;

        let db = Self {
            conn: Mutex::new(conn),
            db_path: PathBuf::from(":memory:"),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock();

        // Enable Write-Ahead Logging and Foreign Key support for maximum ACID resilience
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(|e| format!("Failed to configure SQLite pragmas: {}", e))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                url TEXT NOT NULL,
                resolved_url TEXT,
                protocol TEXT NOT NULL,
                category TEXT NOT NULL,
                queue_id TEXT NOT NULL,
                save_path TEXT NOT NULL,
                total_bytes INTEGER NOT NULL,
                downloaded_bytes INTEGER NOT NULL,
                speed_bps INTEGER NOT NULL DEFAULT 0,
                upload_speed_bps INTEGER NOT NULL DEFAULT 0,
                eta_seconds INTEGER,
                status TEXT NOT NULL,
                resumable INTEGER NOT NULL DEFAULT 1,
                range_advertised INTEGER NOT NULL DEFAULT 0,
                resume_validator TEXT,
                threads_count INTEGER NOT NULL DEFAULT 8,
                priority TEXT NOT NULL DEFAULT 'normal',
                speed_limit_bps INTEGER,
                source_browser TEXT,
                referer TEXT,
                cookies TEXT,
                custom_headers_json TEXT NOT NULL DEFAULT '{}',
                request_method TEXT NOT NULL DEFAULT 'GET',
                browser_intercepted INTEGER NOT NULL DEFAULT 0,
                site_credential_id TEXT,
                checksum_sha256 TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                error_message TEXT,
                transfer_log_json TEXT NOT NULL DEFAULT '[]',
                torrent_file_path TEXT,
                torrent_selected_files_json TEXT,
                browser_context_redacted INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS download_segments (
                download_id TEXT NOT NULL,
                segment_id INTEGER NOT NULL,
                start_byte INTEGER NOT NULL,
                end_byte INTEGER NOT NULL,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                speed_bps INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'waiting',
                PRIMARY KEY (download_id, segment_id),
                FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS torrent_metadata (
                download_id TEXT PRIMARY KEY,
                info_hash TEXT NOT NULL,
                piece_length INTEGER NOT NULL,
                total_pieces INTEGER NOT NULL,
                completed_pieces INTEGER NOT NULL,
                peers_connected INTEGER NOT NULL DEFAULT 0,
                seeds_connected INTEGER NOT NULL DEFAULT 0,
                share_ratio REAL NOT NULL DEFAULT 0.0,
                uploaded_bytes INTEGER NOT NULL DEFAULT 0,
                sequential INTEGER NOT NULL DEFAULT 0,
                trackers_json TEXT NOT NULL DEFAULT '[]',
                files_json TEXT NOT NULL DEFAULT '[]',
                FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS queues (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                max_concurrent INTEGER NOT NULL DEFAULT 4,
                start_time_enabled INTEGER NOT NULL DEFAULT 0,
                start_time_hhmm TEXT NOT NULL DEFAULT '00:00',
                stop_time_enabled INTEGER NOT NULL DEFAULT 0,
                stop_time_hhmm TEXT NOT NULL DEFAULT '08:00',
                days_of_week_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
                speed_limit_kbps INTEGER,
                post_queue_action TEXT NOT NULL DEFAULT 'none'
            );

            CREATE TABLE IF NOT EXISTS site_credentials (
                id TEXT PRIMARY KEY,
                host_pattern TEXT NOT NULL,
                site_type TEXT NOT NULL,
                username TEXT NOT NULL,
                keyring_secret_ref TEXT NOT NULL,
                cookies TEXT,
                custom_headers_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1
            );",
        )
        .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

        Ok(())
    }

    /// Transactionally save an entire list of downloads and their segments into SQLite
    pub fn save_downloads(&self, downloads: &[DownloadItem]) -> Result<(), String> {
        let mut conn = self.conn.lock();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        for item in downloads {
            let protocol_str = serde_json::to_string(&item.protocol)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            let status_str = serde_json::to_string(&item.status)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            let custom_headers_json =
                serde_json::to_string(&item.custom_headers).unwrap_or_else(|_| "{}".to_string());
            let transfer_log_json =
                serde_json::to_string(&item.transfer_log).unwrap_or_else(|_| "[]".to_string());
            let torrent_selected_files_json = item
                .torrent_selected_files
                .as_ref()
                .map(|files| serde_json::to_string(files).unwrap_or_default());

            tx.execute(
                "INSERT INTO downloads (
                    id, filename, url, resolved_url, protocol, category, queue_id,
                    save_path, total_bytes, downloaded_bytes, speed_bps, upload_speed_bps,
                    eta_seconds, status, resumable, range_advertised, resume_validator,
                    threads_count, priority, speed_limit_bps,
                    source_browser, referer, cookies, custom_headers_json, request_method,
                    browser_intercepted, site_credential_id, checksum_sha256,
                    created_at, completed_at, error_message, transfer_log_json,
                    torrent_file_path, torrent_selected_files_json, browser_context_redacted
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    ?8, ?9, ?10, ?11, ?12,
                    ?13, ?14, ?15, ?16, ?17,
                    ?18, ?19, ?20,
                    ?21, ?22, ?23, ?24, ?25,
                    ?26, ?27, ?28,
                    ?29, ?30, ?31, ?32,
                    ?33, ?34, ?35
                ) ON CONFLICT(id) DO UPDATE SET
                    filename = excluded.filename,
                    url = excluded.url,
                    resolved_url = excluded.resolved_url,
                    protocol = excluded.protocol,
                    category = excluded.category,
                    queue_id = excluded.queue_id,
                    save_path = excluded.save_path,
                    total_bytes = excluded.total_bytes,
                    downloaded_bytes = excluded.downloaded_bytes,
                    speed_bps = excluded.speed_bps,
                    upload_speed_bps = excluded.upload_speed_bps,
                    eta_seconds = excluded.eta_seconds,
                    status = excluded.status,
                    resumable = excluded.resumable,
                    range_advertised = excluded.range_advertised,
                    resume_validator = excluded.resume_validator,
                    threads_count = excluded.threads_count,
                    priority = excluded.priority,
                    speed_limit_bps = excluded.speed_limit_bps,
                    source_browser = excluded.source_browser,
                    referer = excluded.referer,
                    cookies = excluded.cookies,
                    custom_headers_json = excluded.custom_headers_json,
                    request_method = excluded.request_method,
                    browser_intercepted = excluded.browser_intercepted,
                    site_credential_id = excluded.site_credential_id,
                    checksum_sha256 = excluded.checksum_sha256,
                    created_at = excluded.created_at,
                    completed_at = excluded.completed_at,
                    error_message = excluded.error_message,
                    transfer_log_json = excluded.transfer_log_json,
                    torrent_file_path = excluded.torrent_file_path,
                    torrent_selected_files_json = excluded.torrent_selected_files_json,
                    browser_context_redacted = excluded.browser_context_redacted",
                params![
                    item.id,
                    item.filename,
                    item.url,
                    item.resolved_url,
                    protocol_str,
                    item.category,
                    item.queue_id,
                    item.save_path,
                    item.total_bytes as i64,
                    item.downloaded_bytes as i64,
                    item.speed_bps as i64,
                    item.upload_speed_bps as i64,
                    item.eta_seconds.map(|s| s as i64),
                    status_str,
                    if item.resumable { 1 } else { 0 },
                    if item.range_advertised { 1 } else { 0 },
                    item.resume_validator,
                    item.threads_count as i64,
                    item.priority,
                    item.speed_limit_bps.map(|b| b as i64),
                    item.source_browser,
                    item.referer,
                    item.cookies,
                    custom_headers_json,
                    item.request_method,
                    if item.browser_intercepted { 1 } else { 0 },
                    item.site_credential_id,
                    item.checksum_sha256,
                    item.created_at,
                    item.completed_at,
                    item.error_message,
                    transfer_log_json,
                    item.torrent_file_path,
                    torrent_selected_files_json,
                    if item.browser_context_redacted { 1 } else { 0 },
                ],
            )
            .map_err(|e| format!("Failed to upsert download {}: {}", item.id, e))?;

            // Replace segments
            tx.execute(
                "DELETE FROM download_segments WHERE download_id = ?1",
                params![item.id],
            )
            .map_err(|e| format!("Failed to clear segments for {}: {}", item.id, e))?;

            for seg in &item.segments {
                tx.execute(
                    "INSERT INTO download_segments (
                        download_id, segment_id, start_byte, end_byte, downloaded_bytes, speed_bps, status
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        item.id,
                        seg.id as i64,
                        seg.start_byte as i64,
                        seg.end_byte as i64,
                        seg.downloaded_bytes as i64,
                        seg.speed_bps as i64,
                        seg.status,
                    ],
                )
                .map_err(|e| format!("Failed to insert segment for {}: {}", item.id, e))?;
            }

            // Upsert torrent metadata if present
            if let Some(ref meta) = item.torrent_meta {
                let trackers_json =
                    serde_json::to_string(&meta.trackers).unwrap_or_else(|_| "[]".to_string());
                let files_json =
                    serde_json::to_string(&meta.files).unwrap_or_else(|_| "[]".to_string());

                tx.execute(
                    "INSERT INTO torrent_metadata (
                        download_id, info_hash, piece_length, total_pieces, completed_pieces,
                        peers_connected, seeds_connected, share_ratio, uploaded_bytes,
                        sequential, trackers_json, files_json
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
                    ) ON CONFLICT(download_id) DO UPDATE SET
                        info_hash = excluded.info_hash,
                        piece_length = excluded.piece_length,
                        total_pieces = excluded.total_pieces,
                        completed_pieces = excluded.completed_pieces,
                        peers_connected = excluded.peers_connected,
                        seeds_connected = excluded.seeds_connected,
                        share_ratio = excluded.share_ratio,
                        uploaded_bytes = excluded.uploaded_bytes,
                        sequential = excluded.sequential,
                        trackers_json = excluded.trackers_json,
                        files_json = excluded.files_json",
                    params![
                        item.id,
                        meta.info_hash,
                        meta.piece_length as i64,
                        meta.total_pieces as i64,
                        meta.completed_pieces as i64,
                        meta.peers_connected as i64,
                        meta.seeds_connected as i64,
                        meta.share_ratio,
                        meta.uploaded_bytes as i64,
                        if meta.sequential { 1 } else { 0 },
                        trackers_json,
                        files_json,
                    ],
                )
                .map_err(|e| format!("Failed to upsert torrent metadata for {}: {}", item.id, e))?;
            }
        }

        // Remove downloads that are no longer in the list
        if !downloads.is_empty() {
            let placeholders = downloads.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("DELETE FROM downloads WHERE id NOT IN ({})", placeholders);
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|e| format!("Failed to prepare delete statement: {}", e))?;
            let params: Vec<&dyn rusqlite::ToSql> = downloads
                .iter()
                .map(|d| &d.id as &dyn rusqlite::ToSql)
                .collect();
            stmt.execute(&params[..])
                .map_err(|e| format!("Failed to clean up stale downloads: {}", e))?;
        } else {
            tx.execute("DELETE FROM downloads", [])
                .map_err(|e| format!("Failed to clear downloads table: {}", e))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit downloads transaction: {}", e))?;

        Ok(())
    }

    /// Load all downloads, segments, and metadata from SQLite
    pub fn load_downloads(&self) -> Result<Vec<DownloadItem>, String> {
        let conn = self.conn.lock();

        let mut stmt = conn
            .prepare(
                "SELECT
                    id, filename, url, resolved_url, protocol, category, queue_id,
                    save_path, total_bytes, downloaded_bytes, speed_bps, upload_speed_bps,
                    eta_seconds, status, resumable, range_advertised, resume_validator,
                    threads_count, priority, speed_limit_bps,
                    source_browser, referer, cookies, custom_headers_json, request_method,
                    browser_intercepted, site_credential_id, checksum_sha256,
                    created_at, completed_at, error_message, transfer_log_json,
                    torrent_file_path, torrent_selected_files_json, browser_context_redacted
                FROM downloads
                ORDER BY created_at DESC",
            )
            .map_err(|e| format!("Failed to prepare select downloads statement: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let filename: String = row.get(1)?;
                let url: String = row.get(2)?;
                let resolved_url: Option<String> = row.get(3)?;
                let protocol_str: String = row.get(4)?;
                let category: String = row.get(5)?;
                let queue_id: String = row.get(6)?;
                let save_path: String = row.get(7)?;
                let total_bytes: i64 = row.get(8)?;
                let downloaded_bytes: i64 = row.get(9)?;
                let speed_bps: i64 = row.get(10)?;
                let upload_speed_bps: i64 = row.get(11)?;
                let eta_seconds: Option<i64> = row.get(12)?;
                let status_str: String = row.get(13)?;
                let resumable: i64 = row.get(14)?;
                let range_advertised: i64 = row.get(15)?;
                let resume_validator: Option<String> = row.get(16)?;
                let threads_count: i64 = row.get(17)?;
                let priority: String = row.get(18)?;
                let speed_limit_bps: Option<i64> = row.get(19)?;
                let source_browser: Option<String> = row.get(20)?;
                let referer: Option<String> = row.get(21)?;
                let cookies: Option<String> = row.get(22)?;
                let custom_headers_json: String = row.get(23)?;
                let request_method: String = row.get(24)?;
                let browser_intercepted: i64 = row.get(25)?;
                let site_credential_id: Option<String> = row.get(26)?;
                let checksum_sha256: Option<String> = row.get(27)?;
                let created_at: String = row.get(28)?;
                let completed_at: Option<String> = row.get(29)?;
                let error_message: Option<String> = row.get(30)?;
                let transfer_log_json: String = row.get(31)?;
                let torrent_file_path: Option<String> = row.get(32)?;
                let torrent_selected_files_json: Option<String> = row.get(33)?;
                let browser_context_redacted: i64 = row.get(34)?;

                Ok((
                    id,
                    filename,
                    url,
                    resolved_url,
                    protocol_str,
                    category,
                    queue_id,
                    save_path,
                    total_bytes,
                    downloaded_bytes,
                    speed_bps,
                    upload_speed_bps,
                    eta_seconds,
                    status_str,
                    resumable,
                    range_advertised,
                    resume_validator,
                    threads_count,
                    priority,
                    speed_limit_bps,
                    source_browser,
                    referer,
                    cookies,
                    custom_headers_json,
                    request_method,
                    browser_intercepted,
                    site_credential_id,
                    checksum_sha256,
                    created_at,
                    completed_at,
                    error_message,
                    transfer_log_json,
                    torrent_file_path,
                    torrent_selected_files_json,
                    browser_context_redacted,
                ))
            })
            .map_err(|e| format!("Failed to query downloads: {}", e))?;

        let mut downloads = Vec::new();

        for row_res in rows {
            let (
                id,
                filename,
                url,
                resolved_url,
                protocol_str,
                category,
                queue_id,
                save_path,
                total_bytes,
                downloaded_bytes,
                speed_bps,
                upload_speed_bps,
                eta_seconds,
                status_str,
                resumable,
                range_advertised,
                resume_validator,
                threads_count,
                priority,
                speed_limit_bps,
                source_browser,
                referer,
                cookies,
                custom_headers_json,
                request_method,
                browser_intercepted,
                site_credential_id,
                checksum_sha256,
                created_at,
                completed_at,
                error_message,
                transfer_log_json,
                torrent_file_path,
                torrent_selected_files_json,
                browser_context_redacted,
            ) = row_res.map_err(|e| format!("Row conversion error: {}", e))?;

            let protocol: DownloadProtocol = serde_json::from_str(&format!("\"{}\"", protocol_str))
                .unwrap_or(DownloadProtocol::Http);
            let status: DownloadStatus = serde_json::from_str(&format!("\"{}\"", status_str))
                .unwrap_or(DownloadStatus::Paused);
            let custom_headers: HashMap<String, String> =
                serde_json::from_str(&custom_headers_json).unwrap_or_default();
            let transfer_log: Vec<String> =
                serde_json::from_str(&transfer_log_json).unwrap_or_default();
            let torrent_selected_files: Option<Vec<usize>> =
                torrent_selected_files_json.and_then(|s| serde_json::from_str(&s).ok());

            // Load segments
            let mut seg_stmt = conn
                .prepare(
                    "SELECT segment_id, start_byte, end_byte, downloaded_bytes, speed_bps, status
                     FROM download_segments
                     WHERE download_id = ?1
                     ORDER BY segment_id ASC",
                )
                .map_err(|e| format!("Failed to prepare segments statement: {}", e))?;

            let segments = seg_stmt
                .query_map(params![id], |s_row| {
                    let seg_id: i64 = s_row.get(0)?;
                    let start_byte: i64 = s_row.get(1)?;
                    let end_byte: i64 = s_row.get(2)?;
                    let downloaded: i64 = s_row.get(3)?;
                    let speed: i64 = s_row.get(4)?;
                    let seg_status: String = s_row.get(5)?;
                    Ok(ThreadSegment {
                        id: seg_id as usize,
                        start_byte: start_byte as u64,
                        end_byte: end_byte as u64,
                        downloaded_bytes: downloaded as u64,
                        speed_bps: speed as u64,
                        status: seg_status,
                    })
                })
                .map_err(|e| format!("Failed to query segments for {}: {}", id, e))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();

            // Load torrent metadata if present
            let mut torrent_meta = None;
            let mut tm_stmt = conn
                .prepare(
                    "SELECT info_hash, piece_length, total_pieces, completed_pieces,
                            peers_connected, seeds_connected, share_ratio, uploaded_bytes,
                            sequential, trackers_json, files_json
                     FROM torrent_metadata
                     WHERE download_id = ?1",
                )
                .map_err(|e| format!("Failed to prepare torrent metadata statement: {}", e))?;

            let tm_row = tm_stmt
                .query_row(params![id], |row| {
                    let info_hash: String = row.get(0)?;
                    let piece_length: i64 = row.get(1)?;
                    let total_pieces: i64 = row.get(2)?;
                    let completed_pieces: i64 = row.get(3)?;
                    let peers_connected: i64 = row.get(4)?;
                    let seeds_connected: i64 = row.get(5)?;
                    let share_ratio: f64 = row.get(6)?;
                    let uploaded_bytes: i64 = row.get(7)?;
                    let sequential: i64 = row.get(8)?;
                    let trackers_json: String = row.get(9)?;
                    let files_json: String = row.get(10)?;
                    Ok((
                        info_hash,
                        piece_length,
                        total_pieces,
                        completed_pieces,
                        peers_connected,
                        seeds_connected,
                        share_ratio,
                        uploaded_bytes,
                        sequential,
                        trackers_json,
                        files_json,
                    ))
                })
                .optional()
                .map_err(|e| format!("Failed to query torrent metadata for {}: {}", id, e))?;

            if let Some((
                info_hash,
                piece_length,
                total_pieces,
                completed_pieces,
                peers_connected,
                seeds_connected,
                share_ratio,
                uploaded_bytes,
                sequential,
                trackers_json,
                files_json,
            )) = tm_row
            {
                let trackers: Vec<String> =
                    serde_json::from_str(&trackers_json).unwrap_or_default();
                let files: Vec<TorrentFileEntry> =
                    serde_json::from_str(&files_json).unwrap_or_default();
                torrent_meta = Some(TorrentMetadata {
                    info_hash,
                    piece_length: piece_length as u64,
                    total_pieces: total_pieces as usize,
                    completed_pieces: completed_pieces as usize,
                    peers_connected: peers_connected as usize,
                    seeds_connected: seeds_connected as usize,
                    share_ratio,
                    uploaded_bytes: uploaded_bytes as u64,
                    sequential: sequential != 0,
                    trackers,
                    peers: Vec::new(),
                    files,
                });
            }

            downloads.push(DownloadItem {
                id,
                filename,
                url,
                resolved_url,
                protocol,
                category,
                queue_id,
                save_path,
                total_bytes: total_bytes as u64,
                downloaded_bytes: downloaded_bytes as u64,
                speed_bps: speed_bps as u64,
                upload_speed_bps: upload_speed_bps as u64,
                eta_seconds: eta_seconds.map(|s| s as u64),
                status,
                resumable: resumable != 0,
                range_advertised: range_advertised != 0,
                resume_validator,
                threads_count: threads_count as usize,
                priority,
                speed_limit_bps: speed_limit_bps.map(|b| b as u64),
                segments,
                torrent_meta,
                source_browser,
                referer,
                cookies,
                custom_headers,
                request_method,
                request_body: None,
                redirect_chain: Vec::new(),
                browser_intercepted: browser_intercepted != 0,
                browser_context_redacted: browser_context_redacted != 0,
                site_credential_id,
                checksum_sha256,
                created_at,
                completed_at,
                error_message,
                transfer_log,
                torrent_file_path,
                torrent_selected_files,
            });
        }

        Ok(downloads)
    }

    /// Delete a single download and its cascade relations from the database
    pub fn delete_download(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete download {}: {}", id, e))?;
        Ok(())
    }

    /// Perform a zero-data-loss migration from legacy downloads.json into SQLite
    pub fn migrate_from_json_if_needed(&self, json_path: &Path) -> Result<bool, String> {
        let existing = self.load_downloads()?;
        if !existing.is_empty() {
            // Already has data in SQLite
            return Ok(false);
        }

        if !json_path.exists() {
            return Ok(false);
        }

        let Ok(raw) = fs::read_to_string(json_path) else {
            return Ok(false);
        };

        // Try reading legacy format
        #[derive(serde::Deserialize)]
        struct LegacyHistory {
            #[serde(default)]
            downloads: Vec<DownloadItem>,
        }

        let Ok(parsed) = serde_json::from_str::<LegacyHistory>(&raw) else {
            return Ok(false);
        };

        if parsed.downloads.is_empty() {
            return Ok(false);
        }

        tracing::info!(
            "Migrating {} downloads from JSON to SQLite database at {:?}",
            parsed.downloads.len(),
            self.db_path
        );

        self.save_downloads(&parsed.downloads)?;

        // Rename legacy file to .migrated to preserve backup
        let migrated_path = json_path.with_extension("json.migrated");
        let _ = fs::rename(json_path, migrated_path);

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_download(id: &str) -> DownloadItem {
        DownloadItem {
            id: id.to_string(),
            filename: "ubuntu.iso".to_string(),
            url: "https://releases.ubuntu.com/24.04/ubuntu.iso".to_string(),
            resolved_url: None,
            protocol: DownloadProtocol::Https,
            category: "programs".to_string(),
            queue_id: "main-queue".to_string(),
            save_path: "/tmp/ubuntu.iso".to_string(),
            total_bytes: 4_000_000_000,
            downloaded_bytes: 1_000_000_000,
            speed_bps: 10_000_000,
            upload_speed_bps: 0,
            eta_seconds: Some(300),
            status: DownloadStatus::Downloading,
            resumable: true,
            range_advertised: true,
            resume_validator: Some("W/\"etag-xyz-123\"".to_string()),
            threads_count: 8,
            priority: "high".to_string(),
            speed_limit_bps: Some(20_000_000),
            segments: vec![ThreadSegment {
                id: 1,
                start_byte: 0,
                end_byte: 1_000_000_000,
                downloaded_bytes: 500_000_000,
                speed_bps: 5_000_000,
                status: "receiving".to_string(),
            }],
            torrent_meta: None,
            source_browser: Some("dia".to_string()),
            referer: None,
            cookies: None,
            custom_headers: HashMap::new(),
            request_method: "GET".to_string(),
            request_body: None,
            redirect_chain: Vec::new(),
            browser_intercepted: true,
            browser_context_redacted: false,
            site_credential_id: None,
            checksum_sha256: Some("abcdef123456".to_string()),
            created_at: "2026-11-03T00:00:00Z".to_string(),
            completed_at: None,
            error_message: None,
            transfer_log: vec!["Download started".to_string()],
            torrent_file_path: None,
            torrent_selected_files: None,
        }
    }

    #[test]
    fn test_sqlite_database_roundtrip() {
        let db = DatabaseManager::open_in_memory().expect("in-memory db open failed");
        let item1 = dummy_download("dl-1");
        let item2 = dummy_download("dl-2");

        // Save
        db.save_downloads(&[item1.clone(), item2.clone()])
            .expect("save downloads failed");

        // Load
        let loaded = db.load_downloads().expect("load downloads failed");
        assert_eq!(loaded.len(), 2);
        let found = loaded.iter().find(|d| d.id == "dl-1").unwrap();
        assert_eq!(found.filename, "ubuntu.iso");
        assert_eq!(found.total_bytes, 4_000_000_000);
        assert_eq!(found.priority, "high");
        assert_eq!(
            found.resume_validator,
            Some("W/\"etag-xyz-123\"".to_string())
        );
        assert!(found.range_advertised);
        assert!(found.browser_intercepted);
        assert_eq!(found.segments.len(), 1);
        assert_eq!(found.segments[0].downloaded_bytes, 500_000_000);

        // Delete single
        db.delete_download("dl-1").expect("delete failed");
        let after_del = db.load_downloads().expect("load failed");
        assert_eq!(after_del.len(), 1);
        assert_eq!(after_del[0].id, "dl-2");
    }
}
