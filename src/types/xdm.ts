export type DownloadProtocol =
  | "http"
  | "https"
  | "bit_torrent"
  | "magnet"
  | "ftp"
  | "ftps"
  | "sftp"
  | "usersdrive"
  | "file_host_auth";

export type DownloadStatus =
  | "queued"
  | "connecting"
  | "authenticating"
  | "downloading"
  | "merging"
  | "seeding"
  | "paused"
  | "completed"
  | "failed";

export interface ThreadSegment {
  id: number;
  start_byte: number;
  end_byte: number;
  downloaded_bytes: number;
  speed_bps: number;
  status: "waiting" | "connecting" | "receiving" | "paused" | "completed" | "error";
}

export interface TorrentPeerInfo {
  ip_port: string;
  client: string;
  flags: string;
  progress_pct: number;
  down_speed_bps: number;
  up_speed_bps: number;
}

export interface TorrentFileEntry {
  index: number;
  path: string;
  size_bytes: number;
  downloaded_bytes: number;
  priority: "high" | "normal" | "skip";
}

export interface TorrentMetadata {
  info_hash: string;
  piece_length: number;
  total_pieces: number;
  completed_pieces: number;
  peers_connected: number;
  seeds_connected: number;
  share_ratio: number;
  uploaded_bytes: number;
  sequential: boolean;
  trackers: string[];
  peers: TorrentPeerInfo[];
  files: TorrentFileEntry[];
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  resolved_url?: string | null;
  protocol: DownloadProtocol;
  category: string;
  queue_id: string;
  save_path: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bps: number;
  upload_speed_bps: number;
  eta_seconds?: number | null;
  status: DownloadStatus;
  resumable: boolean;
  threads_count: number;
  segments: ThreadSegment[];
  torrent_meta?: TorrentMetadata | null;
  source_browser?: string | null;
  referer?: string | null;
  cookies?: string | null;
  custom_headers: Record<string, string>;
  site_credential_id?: string | null;
  checksum_sha256?: string | null;
  created_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  transfer_log: string[];
}

export interface SiteCredential {
  id: string;
  host_pattern: string;
  site_type: "usersdrive" | "1fichier" | "mediafire" | "ftp" | "sftp" | "http_basic" | "bearer" | "cookie";
  username: string;
  password_or_token: string;
  cookies?: string | null;
  custom_headers: Record<string, string>;
  enabled: boolean;
}

export interface CategoryRule {
  id: string;
  name: string;
  icon: string;
  extensions: string[];
  default_subfolder: string;
}

export interface SchedulerQueueConfig {
  id: string;
  name: string;
  max_concurrent: number;
  start_time_enabled: boolean;
  start_time_hhmm: string;
  stop_time_enabled: boolean;
  stop_time_hhmm: string;
  days_of_week: number[];
  speed_limit_kbps?: number | null;
  post_queue_action: "none" | "exit_app" | "sleep" | "shutdown";
}

export interface BrowserStatus {
  id: string;
  display_name: string;
  family: "chromium" | "firefox" | "safari";
  detected_installed: boolean;
  executable_path?: string | null;
  extension_enabled: boolean;
  native_host_registered: boolean;
  manifest_path: string;
  extension_bundle_path: string;
  status_message: string;
}

export interface AppSettings {
  theme: "dark" | "light" | "midnight";
  ui_mode: "simple" | "advanced";
  start_on_boot: boolean;
  minimize_to_tray: boolean;
  show_completion_dialog: boolean;
  show_detailed_segment_dialog: boolean;
  play_sound_on_complete: boolean;
  prevent_system_sleep: boolean;
  default_download_dir: string;
  temp_segment_dir: string;
  duplicate_file_action: "auto_rename" | "overwrite" | "prompt";
  auto_verify_checksum: boolean;
  antivirus_command: string;

  default_threads_per_download: number;
  max_threads_per_download: number;
  max_concurrent_downloads: number;
  min_segment_size_kb: number;
  dynamic_segment_stealing: boolean;
  max_retries: number;
  retry_delay_seconds: number;
  connection_timeout_seconds: number;
  custom_user_agent: string;

  speed_limiter_enabled: boolean;
  global_max_download_kbps: number;
  global_max_upload_kbps: number;

  categories: CategoryRule[];
  site_credentials: SiteCredential[];
  torrent: {
    enable_dht: boolean;
    enable_pex: boolean;
    enable_lpd: boolean;
    enable_upnp: boolean;
    listen_port: number;
    max_active_torrents: number;
    max_peers_per_torrent: number;
    seed_ratio_limit: number;
    seed_time_limit_minutes: number;
    sequential_download_default: boolean;
    encryption_mode: "prefer" | "require" | "disable";
    default_trackers: string[];
  };
  browser: {
    ipc_port: number;
    auto_install_extensions_on_startup: boolean;
    intercept_all_downloads: boolean;
    min_file_size_kb: number;
    intercepted_extensions: string[];
    ignored_domains: string[];
    capture_streaming_media: boolean;
    bypass_key: "Alt" | "Shift" | "Ctrl";
    enabled_browsers: Record<string, boolean>;
  };
  proxy: {
    enabled: boolean;
    proxy_type: "http" | "https" | "socks5";
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
    bypass_local: boolean;
  };
  queues: SchedulerQueueConfig[];
}

export interface NewDownloadRequest {
  url: string;
  filename?: string;
  category?: string;
  save_path?: string;
  threads_count?: number;
  queue_id?: string;
  start_immediately: boolean;
  source_browser?: string;
  referer?: string;
  cookies?: string;
  user_agent?: string;
  custom_headers?: Record<string, string>;
  auth_username?: string;
  auth_password?: string;
  sequential_torrent?: boolean;
}
