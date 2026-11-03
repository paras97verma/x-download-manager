import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  AppSettings,
  AppUpdateInfo,
  BrowserStatus,
  DownloadItem,
  DownloadResumeVerificationResult,
  DuplicateDownloadNotice,
  MediaStreamInfo,
  NewDownloadRequest,
  RemoteConnectionTestParams,
  RemoteConnectionTestResult,
  RestoredDownloadInfo,
  SchedulerQueueConfig,
  SiteCredential,
  ThreadSegment,
  UpdatePreparationSummary,
  UpdateRestorationReport,
} from "../types/xdm";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = (): boolean => {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
};

export async function onNativeMenuAction(
  callback: (actionId: string) => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauriRuntime()) return () => {};
  try {
    return await listen<string>("menu-action", (event) => {
      callback(event.payload);
    });
  } catch (err) {
    console.warn("Failed to listen for menu-action:", err);
    return () => {};
  }
}

export async function onDuplicateDownloadDetected(
  callback: (notice: DuplicateDownloadNotice) => void
): Promise<UnlistenFn | (() => void)> {
  if (!isTauriRuntime()) return () => {};
  try {
    return await listen<DuplicateDownloadNotice>("duplicate-download-detected", (event) => {
      callback(event.payload);
    });
  } catch (err) {
    console.warn("Failed to listen for duplicate-download-detected:", err);
    return () => {};
  }
}

export async function apiGetDownloads(): Promise<DownloadItem[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<DownloadItem[]>("get_downloads");
  } catch (err) {
    console.warn("Failed to get_downloads from Tauri backend:", err);
    return [];
  }
}

export async function apiAddDownload(req: NewDownloadRequest, keepBoth = false): Promise<DownloadItem | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<DownloadItem>("add_download_task", { req, keepBoth });
  } catch (err) {
    console.error("Failed to add_download_task via Tauri:", err);
    throw err;
  }
}

export async function apiUpdateDownloadUrl(id: string, url: string): Promise<DownloadItem> {
  if (!isTauriRuntime()) throw new Error("Changing a download URL requires the desktop app");
  return await invoke<DownloadItem>("update_download_url", { id, url });
}

export async function apiPauseDownload(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("pause_download", { id });
  } catch (err) {
    console.error("Failed to pause_download via Tauri:", err);
  }
}

export async function apiResumeDownload(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("resume_download", { id });
  } catch (err) {
    console.error("Failed to resume_download via Tauri:", err);
  }
}

export async function apiDeleteDownload(id: string, deleteFile = false): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("delete_download", { id, deleteFile });
}

export async function apiGetSettings(): Promise<AppSettings | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<AppSettings>("get_settings");
  } catch (err) {
    console.warn("Failed to get_settings from Tauri backend:", err);
    return null;
  }
}

export async function apiUpdateSettings(settings: AppSettings): Promise<AppSettings | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<AppSettings>("update_settings", { newSettings: settings });
  } catch (err) {
    console.error("Failed to update_settings via Tauri:", err);
    return null;
  }
}

export async function apiTestRemoteConnection(
  params: RemoteConnectionTestParams
): Promise<RemoteConnectionTestResult> {
  if (!isTauriRuntime()) {
    await new Promise((r) => setTimeout(r, 450));
    const isFtp = params.protocol === "ftp";
    return {
      success: true,
      protocol: params.protocol,
      host: params.host,
      port: params.port || (params.protocol === "sftp" ? 22 : params.protocol === "ftps" ? 990 : 21),
      banner: params.protocol === "sftp" ? "SSH-2.0-OpenSSH_9.3p1" : "220 ByteX Mock FTP Server Ready",
      authenticated: true,
      features: ["UTF8", "REST (STREAM)", "PASV", "EPSV", "MLSD"],
      remote_path_exists: params.remote_path ? true : null,
      message: `Connected successfully to ${params.host} as ${params.is_anonymous ? "anonymous" : (params.username || "anonymous")}.`,
      latency_ms: 32,
      security_warning: isFtp ? "⚠️ Plain FTP Warning: Plain FTP transmits credentials and files in plaintext without encryption." : null,
    };
  }
  return await invoke<RemoteConnectionTestResult>("test_remote_connection", { params });
}

export async function apiSaveRemoteCredential(
  credential: SiteCredential
): Promise<AppSettings | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<AppSettings>("save_remote_credential", { credential });
  } catch (err) {
    console.error("Failed to save_remote_credential via Tauri:", err);
    return null;
  }
}

export async function apiDeleteRemoteCredential(
  credentialId: string
): Promise<AppSettings | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<AppSettings>("delete_remote_credential", { credentialId });
  } catch (err) {
    console.error("Failed to delete_remote_credential via Tauri:", err);
    return null;
  }
}

export async function apiGetBrowserStatuses(): Promise<BrowserStatus[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<BrowserStatus[]>("get_browser_statuses");
  } catch (err) {
    console.warn("Failed to get_browser_statuses from Tauri backend:", err);
    return [];
  }
}

export async function apiToggleBrowserExtension(
  browserId: string,
  enable: boolean
): Promise<BrowserStatus | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<BrowserStatus>("toggle_browser_extension", { browserId, enable });
  } catch (err) {
    console.error("Failed to toggle_browser_extension via Tauri:", err);
    return null;
  }
}

export async function apiOpenFile(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    console.log("Mock: Opening file:", path);
    return;
  }
  try {
    await invoke("open_file", { path });
  } catch (err) {
    console.error("Failed to open_file via Tauri:", err);
  }
}

export async function apiShowInFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    console.log("Mock: Showing file in folder:", path);
    return;
  }
  try {
    await invoke("show_in_folder", { path });
  } catch (err) {
    console.error("Failed to show_in_folder via Tauri:", err);
  }
}

export async function apiOpenBrowserUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank");
    return;
  }
  try {
    await invoke("open_browser_url", { url });
  } catch (err) {
    console.error("Failed to open_browser_url via Tauri:", err);
  }
}

export async function apiOpenExtensionFolder(family: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string>("open_extension_folder", { family });
  } catch (err) {
    console.error("Failed to open_extension_folder via Tauri:", err);
    return null;
  }
}

export async function apiRestartDownload(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("restart_download", { id });
  } catch (err) {
    console.error("Failed to restart_download via Tauri:", err);
  }
}

export async function apiVerifyFileChecksum(path: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    // Generate mock SHA-256 for browser preview
    return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  }
  try {
    return await invoke<string>("verify_file_checksum", { path });
  } catch (err) {
    console.error("Failed to verify_file_checksum via Tauri:", err);
    return null;
  }
}

export async function apiMoveToQueue(
  id: string,
  queueId: string,
  forceRestart?: boolean
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("move_to_queue", {
      id,
      queue_id: queueId,
      queueId,
      force_restart: forceRestart,
      forceRestart,
    });
  } catch (err) {
    console.error("Failed to move_to_queue via Tauri:", err);
  }
}

export async function apiSetDownloadThreads(id: string, threads: number): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("set_download_threads", { id, threads });
  } catch (err) {
    console.error("Failed to set_download_threads via Tauri:", err);
  }
}

export async function apiSetDownloadPriority(
  id: string,
  priority: "high" | "normal" | "low"
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("set_download_priority", { id, priority });
  } catch (err) {
    console.error("Failed to set_download_priority via Tauri:", err);
  }
}

export async function apiSetDownloadSpeedLimit(
  id: string,
  speedLimitKbps?: number | null
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("set_download_speed_limit", {
      id,
      speed_limit_kbps: speedLimitKbps,
      speedLimitKbps,
    });
  } catch (err) {
    console.error("Failed to set_download_speed_limit via Tauri:", err);
  }
}

export async function apiStartQueueNow(queueId: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("start_queue_now", { queueId });
}

export async function apiCreateQueue(config: SchedulerQueueConfig): Promise<SchedulerQueueConfig> {
  if (!isTauriRuntime()) return config;
  return invoke<SchedulerQueueConfig>("create_queue", { config });
}

export async function apiUpdateQueue(config: SchedulerQueueConfig): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("update_queue", { config });
}

export async function apiDeleteQueue(queueId: string, reassignToQueueId?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("delete_queue", { queueId, reassignToQueueId: reassignToQueueId || null });
}

export async function apiToggleQueuePause(queueId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("toggle_queue_pause", { queueId });
}

export async function apiScheduleDownload(
  downloadId: string,
  startTime: string | null,
  stopTime: string | null
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("schedule_download", { downloadId, startTime, stopTime });
}

export async function apiPickDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return "~/Downloads/ByteX";
  }
  try {
    return await invoke<string | null>("pick_directory");
  } catch (err) {
    console.error("Failed to pick_directory via Tauri:", err);
    return null;
  }
}

export async function apiSetAutostart(enable: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return enable;
  try {
    return await invoke<boolean>("set_autostart", { enable });
  } catch (err) {
    console.error("Failed to set_autostart via Tauri:", err);
    throw err;
  }
}

export async function apiIsAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  try {
    return await invoke<boolean>("is_autostart_enabled");
  } catch (err) {
    console.error("Failed to query is_autostart_enabled via Tauri:", err);
    return false;
  }
}

export const DEFAULT_APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__ ? __APP_VERSION__ : "1.0.2";

export async function apiGetAppVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const ver = await invoke<string>("get_app_version");
      if (ver && ver.trim().length > 0) {
        return ver.trim();
      }
    } catch (err) {
      console.warn("Failed to query get_app_version via Tauri:", err);
    }
  }
  return DEFAULT_APP_VERSION;
}

export async function apiPrepareAppForUpdate(
  targetVersion?: string
): Promise<UpdatePreparationSummary> {
  if (isTauriRuntime()) {
    try {
      return await invoke<UpdatePreparationSummary>("prepare_app_for_update", {
        targetVersion: targetVersion || null,
      });
    } catch (err) {
      console.error("Failed to prepare app for update:", err);
      throw err;
    }
  }
  return {
    success: true,
    paused_downloads_count: 0,
    queued_downloads_count: 0,
    completed_downloads_count: 0,
    backup_path: "/mock/bytex.db.backup",
    db_intact: true,
    prepared_at: new Date().toISOString(),
    message: "Mock update preparation successful in browser preview.",
  };
}

export async function apiGetUpdateRestorationReport(): Promise<UpdateRestorationReport | null> {
  if (isTauriRuntime()) {
    try {
      return await invoke<UpdateRestorationReport | null>("get_update_restoration_report");
    } catch (err) {
      console.error("Failed to get update restoration report:", err);
      return null;
    }
  }
  return null;
}

export async function apiDismissUpdateRestorationReport(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke("dismiss_update_restoration_report");
    } catch (err) {
      console.error("Failed to dismiss update restoration report:", err);
    }
  }
}

export async function apiVerifyAndResumeDownload(
  id: string
): Promise<DownloadResumeVerificationResult> {
  if (isTauriRuntime()) {
    try {
      return await invoke<DownloadResumeVerificationResult>("verify_and_resume_download", { id });
    } catch (err) {
      console.error("Failed to verify and resume download:", err);
      throw err;
    }
  }
  return {
    id,
    can_resume: true,
    accepts_ranges: true,
    validator_matches: true,
    server_total_bytes: 0,
    message: "Mock verified and resumed in browser preview.",
  };
}

export async function apiCheckForUpdates(): Promise<AppUpdateInfo> {
  if (isTauriRuntime()) {
    try {
      return await invoke<AppUpdateInfo>("check_for_updates");
    } catch (err) {
      console.error("Failed to check for updates:", err);
      throw err;
    }
  }
  return {
    current_version: DEFAULT_APP_VERSION,
    latest_version: DEFAULT_APP_VERSION,
    has_update: false,
    release_notes: "Up to date (web preview mode).",
    release_url: "https://github.com/paras97verma/x-download-manager/releases",
    published_at: null,
  };
}

export async function apiPromptNotificationPermission(): Promise<boolean> {
  if (!isTauriRuntime()) {
    if (typeof Notification !== "undefined") {
      const res = await Notification.requestPermission();
      return res === "granted";
    }
    return true;
  }
  try {
    return await invoke<boolean>("request_notification_permission");
  } catch (err) {
    console.error("Failed to request_notification_permission via Tauri:", err);
    return false;
  }
}

export async function apiShowNotification(title: string, body: string): Promise<void> {
  if (!isTauriRuntime()) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
    return;
  }
  try {
    await invoke("show_notification", { title, body });
  } catch (err) {
    console.error("Failed to show_notification via Tauri:", err);
  }
}

export async function apiParseTorrentFile(
  filePath?: string,
  base64Data?: string
): Promise<any | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke("parse_torrent_file", { filePath, base64Data });
  } catch (err) {
    console.error("Failed to parse_torrent_file via Tauri:", err);
    return null;
  }
}

export function isVideoFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["mp4", "m4v", "webm", "mkv", "avi", "mov", "ts", "ogv"].includes(ext || "");
}

export function isAudioFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["mp3", "wav", "flac", "aac", "ogg", "oga", "m4a", "opus"].includes(ext || "");
}

export function isMediaFile(filename?: string): boolean {
  return isVideoFile(filename) || isAudioFile(filename);
}

export async function apiGetMediaStreamInfo(id: string): Promise<MediaStreamInfo | null> {
  if (!isTauriRuntime()) {
    return {
      download_id: id,
      filename: "sample-media.mp4",
      stream_url: `http://127.0.0.1:45678/api/v1/stream/${id}`,
      mime_type: "video/mp4",
      total_bytes: 50_000_000,
      downloaded_bytes: 25_000_000,
      is_video: true,
      is_audio: false,
      is_complete: false,
    };
  }
  try {
    return await invoke<MediaStreamInfo>("get_media_stream_info", { id });
  } catch (err) {
    console.error("Failed to get_media_stream_info via Tauri:", err);
    return null;
  }
}

export async function apiOpenInExternalPlayer(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(`http://127.0.0.1:45678/api/v1/stream/${id}`, "_blank");
    return;
  }
  try {
    await invoke("open_in_external_player", { id });
  } catch (err) {
    console.error("Failed to open_in_external_player via Tauri:", err);
  }
}

export function buildSegments(
  totalBytes: number,
  count: number,
  downloadedRatio: number,
  active: boolean
): ThreadSegment[] {
  const segSize = Math.floor(totalBytes / count);
  return Array.from({ length: count }, (_, idx) => {
    const start = idx * segSize;
    const end = idx === count - 1 ? totalBytes - 1 : (idx + 1) * segSize - 1;
    const len = end - start + 1;
    const segRatio = Math.min(1, Math.max(0, downloadedRatio + (idx % 3 === 0 ? 0.08 : -0.04)));
    const dl = Math.floor(len * segRatio);
    return {
      id: idx + 1,
      start_byte: start,
      end_byte: end,
      downloaded_bytes: dl,
      speed_bps: active && segRatio < 1 ? Math.floor(1_850_000 + (idx * 240_000) % 1_400_000) : 0,
      status: segRatio >= 1 ? "completed" : active ? "receiving" : "paused",
    };
  });
}

// Clean initial empty state for production releases
export const INITIAL_DOWNLOADS: DownloadItem[] = [];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  ui_mode: "simple",
  start_on_boot: true,
  minimize_to_tray: true,
  show_completion_dialog: true,
  show_detailed_segment_dialog: true,
  play_sound_on_complete: true,
  prevent_system_sleep: true,
  default_download_dir: "~/Downloads/ByteX",
  temp_segment_dir: "~/Downloads/ByteX/.bytex_temp",
  duplicate_file_action: "auto_rename",
  auto_verify_checksum: true,
  antivirus_command: "",

  default_threads_per_download: 16,
  max_threads_per_download: 32,
  max_concurrent_downloads: 5,
  min_segment_size_kb: 512,
  dynamic_segment_stealing: true,
  max_retries: 10,
  retry_delay_seconds: 5,
  connection_timeout_seconds: 30,
  custom_user_agent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 ByteX/1.0",

  speed_limiter_enabled: false,
  global_max_download_kbps: 20480,
  global_max_upload_kbps: 4096,

  categories: [
    { id: "compressed", name: "Compressed", icon: "Archive", extensions: ["zip", "rar", "7z", "tar", "gz", "xz"], default_subfolder: "Compressed" },
    { id: "programs", name: "Programs", icon: "Cpu", extensions: ["exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage", "iso"], default_subfolder: "Programs" },
    { id: "video", name: "Video", icon: "Film", extensions: ["mp4", "mkv", "webm", "avi", "mov", "ts"], default_subfolder: "Video" },
    { id: "music", name: "Music", icon: "Music", extensions: ["mp3", "flac", "wav", "aac", "ogg", "m4a"], default_subfolder: "Music" },
    { id: "documents", name: "Documents", icon: "FileText", extensions: ["pdf", "epub", "docx", "xlsx", "pptx", "txt"], default_subfolder: "Documents" },
  ],
  site_credentials: [],
  torrent: {
    enable_dht: true,
    enable_pex: true,
    enable_lpd: true,
    enable_upnp: true,
    listen_port: 51413,
    max_active_torrents: 5,
    max_peers_per_torrent: 100,
    seed_ratio_limit: 1.5,
    seed_time_limit_minutes: 120,
    sequential_download_default: false,
    encryption_mode: "prefer",
    default_trackers: [
      "udp://tracker.opentrackr.org:1337/announce",
      "udp://open.stealth.si:80/announce",
      "udp://tracker.torrent.eu.org:451/announce",
      "https://tracker.tamersunion.org:443/announce",
    ],
  },
  browser: {
    ipc_port: 45678,
    auto_install_extensions_on_startup: true,
    intercept_all_downloads: true,
    min_file_size_kb: 256,
    intercepted_extensions: [
      "ZIP", "RAR", "7Z", "TAR", "GZ", "EXE", "MSI", "DMG", "PKG",
      "DEB", "RPM", "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI",
      "MOV", "MP3", "FLAC", "WAV", "PDF", "DOCX", "XLSX", "PPTX", "TORRENT"
    ],
    ignored_domains: ["localhost", "127.0.0.1"],
    capture_streaming_media: true,
    bypass_key: "Alt",
    enabled_browsers: {
      chrome: true,
      brave: true,
      edge: true,
      opera: true,
      vivaldi: true,
      firefox: true,
      safari: true,
    },
  },
  proxy: {
    enabled: false,
    proxy_type: "http",
    host: "127.0.0.1",
    port: 8080,
    username: "",
    password: "",
    bypass_local: true,
  },
  queues: [
    {
      id: "main-queue",
      name: "Main Download Queue",
      max_concurrent: 4,
      start_time_enabled: false,
      start_time_hhmm: "00:00",
      stop_time_enabled: false,
      stop_time_hhmm: "08:00",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "none",
      download_dir: null,
      priority: "normal",
      preferred_connections: 8,
      manual_pause: false,
      date_schedule_enabled: false,
      date_schedule_start: null,
      date_schedule_stop: null,
      per_host_concurrency: 3,
    },
    {
      id: "high-priority-queue",
      name: "High Priority Queue",
      max_concurrent: 6,
      start_time_enabled: false,
      start_time_hhmm: "00:00",
      stop_time_enabled: false,
      stop_time_hhmm: "23:59",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "none",
      download_dir: null,
      priority: "high",
      preferred_connections: 16,
      manual_pause: false,
      date_schedule_enabled: false,
      date_schedule_start: null,
      date_schedule_stop: null,
      per_host_concurrency: 4,
    },
    {
      id: "night-queue",
      name: "Night Off-Peak Queue",
      max_concurrent: 8,
      start_time_enabled: true,
      start_time_hhmm: "01:00",
      stop_time_enabled: true,
      stop_time_hhmm: "07:00",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "sleep",
      download_dir: null,
      priority: "normal",
      preferred_connections: 8,
      manual_pause: false,
      date_schedule_enabled: false,
      date_schedule_start: null,
      date_schedule_stop: null,
      per_host_concurrency: null,
    },
    {
      id: "torrents-queue",
      name: "Torrents Queue",
      max_concurrent: 3,
      start_time_enabled: false,
      start_time_hhmm: "00:00",
      stop_time_enabled: false,
      stop_time_hhmm: "23:59",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "none",
      download_dir: null,
      priority: "normal",
      preferred_connections: null,
      manual_pause: false,
      date_schedule_enabled: false,
      date_schedule_start: null,
      date_schedule_stop: null,
      per_host_concurrency: null,
    },
  ],
  pause_on_battery: false,
  pause_on_metered_network: false,
  per_host_concurrency_limit: 4,
};

export const INITIAL_BROWSERS: BrowserStatus[] = [
  {
    id: "dia",
    display_name: "Dia Browser",
    family: "chromium",
    detected_installed: true,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: true,
    manifest_path: "~/Library/Application Support/Dia/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Active — intercepting downloads",
  },
  {
    id: "safari",
    display_name: "Apple Safari",
    family: "safari",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/ByteXDownloadManager/SafariExtension/com.peivee.xdm.json",
    extension_bundle_path: "extensions/safari (Safari Web Extension)",
    status_message: "Detecting...",
  },
  {
    id: "chrome",
    display_name: "Google Chrome",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "brave",
    display_name: "Brave Browser",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "edge",
    display_name: "Microsoft Edge",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "arc",
    display_name: "Arc Browser",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Arc/User Data/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "firefox",
    display_name: "Mozilla Firefox",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Mozilla/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Detecting...",
  },
  {
    id: "zen",
    display_name: "Zen Browser",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/zen/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Detecting...",
  },
  {
    id: "orion",
    display_name: "Orion Browser",
    family: "safari",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Orion/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "librewolf",
    display_name: "LibreWolf",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/LibreWolf/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Detecting...",
  },
  {
    id: "waterfox",
    display_name: "Waterfox",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Waterfox/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Detecting...",
  },
  {
    id: "floorp",
    display_name: "Floorp",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Floorp/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Detecting...",
  },
  {
    id: "chromium",
    display_name: "Chromium / Thorium",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Chromium/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "operagx",
    display_name: "Opera GX",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/com.operasoftware.OperaGX/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "opera",
    display_name: "Opera",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
  {
    id: "vivaldi",
    display_name: "Vivaldi",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    is_connected: false,
    manifest_path: "~/Library/Application Support/Vivaldi/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Detecting...",
  },
];

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return "0 B/s";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || seconds < 0) return "—";
  if (seconds === 0) return "Done";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
