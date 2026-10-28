import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  BrowserStatus,
  DownloadItem,
  NewDownloadRequest,
  ThreadSegment,
} from "../types/xdm";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = (): boolean => {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
};

export async function apiGetDownloads(): Promise<DownloadItem[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<DownloadItem[]>("get_downloads");
  } catch (err) {
    console.warn("Failed to get_downloads from Tauri backend:", err);
    return [];
  }
}

export async function apiAddDownload(req: NewDownloadRequest): Promise<DownloadItem | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<DownloadItem>("add_download_task", { req });
  } catch (err) {
    console.error("Failed to add_download_task via Tauri:", err);
    throw err;
  }
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
  try {
    await invoke("delete_download", { id, deleteFile });
  } catch (err) {
    console.error("Failed to delete_download via Tauri:", err);
  }
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
  start_on_boot: true,
  minimize_to_tray: true,
  show_completion_dialog: true,
  show_detailed_segment_dialog: true,
  play_sound_on_complete: true,
  prevent_system_sleep: true,
  default_download_dir: "~/Downloads/XDM",
  temp_segment_dir: "~/Downloads/XDM/.xdm_temp",
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
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 XDM/1.0",

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
  site_credentials: [
    {
      id: "cred-usersdrive-default",
      host_pattern: "*.usersdrive.com",
      site_type: "usersdrive",
      username: "peivee_premium",
      password_or_token: "••••••••••••",
      cookies: "xfss=9b81e2c7a4f019d3e; lang=english",
      custom_headers: {},
      enabled: true,
    },
    {
      id: "cred-1fichier",
      host_pattern: "*.1fichier.com",
      site_type: "1fichier",
      username: "peivee@xdm.local",
      password_or_token: "Bearer_API_Key_99412a",
      cookies: "SID=a8f9102c4d",
      custom_headers: {},
      enabled: true,
    },
    {
      id: "cred-ftp-mirror",
      host_pattern: "ftp.nluug.nl",
      site_type: "ftp",
      username: "anonymous",
      password_or_token: "anonymous@xdm.local",
      cookies: null,
      custom_headers: {},
      enabled: true,
    },
  ],
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
    },
  ],
};

export const INITIAL_BROWSERS: BrowserStatus[] = [
  {
    id: "chrome",
    display_name: "Google Chrome",
    family: "chromium",
    detected_installed: true,
    executable_path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "brave",
    display_name: "Brave Browser",
    family: "chromium",
    detected_installed: true,
    executable_path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "edge",
    display_name: "Microsoft Edge",
    family: "chromium",
    detected_installed: true,
    executable_path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "firefox",
    display_name: "Mozilla Firefox",
    family: "firefox",
    detected_installed: true,
    executable_path: "/Applications/Firefox.app/Contents/MacOS/firefox",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/Mozilla/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "safari",
    display_name: "Apple Safari",
    family: "safari",
    detected_installed: true,
    executable_path: "/Applications/Safari.app/Contents/MacOS/Safari",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/XDownloadManager/SafariExtension/com.peivee.xdm.json",
    extension_bundle_path: "extensions/safari (Safari App Extension)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "arc",
    display_name: "Arc Browser",
    family: "chromium",
    detected_installed: true,
    executable_path: "/Applications/Arc.app/Contents/MacOS/Arc",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/Arc/User Data/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "dia",
    display_name: "Dia Browser",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Dia/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Ready — Click Install/Repair to register Native Host",
  },
  {
    id: "zen",
    display_name: "Zen Browser",
    family: "firefox",
    detected_installed: true,
    executable_path: "/Applications/Zen Browser.app/Contents/MacOS/zen",
    extension_enabled: true,
    native_host_registered: true,
    manifest_path: "~/Library/Application Support/zen/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Connected & Intercepting Downloads",
  },
  {
    id: "orion",
    display_name: "Orion Browser",
    family: "safari",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Orion/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Ready — Click Install/Repair to register Native Host",
  },
  {
    id: "librewolf",
    display_name: "LibreWolf",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/LibreWolf/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "waterfox",
    display_name: "Waterfox",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Waterfox/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "floorp",
    display_name: "Floorp",
    family: "firefox",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Floorp/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/firefox (WebExtension XPI)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "chromium",
    display_name: "Chromium / Thorium",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: true,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Chromium/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "operagx",
    display_name: "Opera GX",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/com.operasoftware.OperaGX/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "opera",
    display_name: "Opera",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Browser not detected on this system",
  },
  {
    id: "vivaldi",
    display_name: "Vivaldi",
    family: "chromium",
    detected_installed: false,
    executable_path: null,
    extension_enabled: false,
    native_host_registered: false,
    manifest_path: "~/Library/Application Support/Vivaldi/NativeMessagingHosts/com.peivee.xdm.json",
    extension_bundle_path: "extensions/chromium (MV3)",
    status_message: "Browser not detected on this system",
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
