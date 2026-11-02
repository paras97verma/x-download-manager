// ByteX Download Manager (XDM) — Background Service Worker / WebExtension Script
// Works across Chromium (Chrome, Brave, Edge, Opera, Vivaldi), Mozilla Firefox, and Apple Safari.
// Intercepts browser-managed network downloads, sends them to ByteX, and resumes
// the browser transfer if the app declines or cannot receive the handoff.

const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
const XDM_IPC_URL = "http://127.0.0.1:45678";
const NATIVE_HOST_NAME = "com.peivee.xdm";

function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

let state = {
  interceptEnabled: true,
  desktopIntegrationEnabled: true,
  interceptedExtensions: [
    "ZIP", "RAR", "7Z", "TAR", "GZ", "EXE", "MSI", "DMG", "PKG", "DEB", "RPM",
    "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI", "MOV", "MP3", "FLAC", "WAV",
    "PDF", "DOCX", "XLSX", "PPTX", "TORRENT",
  ],
  ignoredDomains: ["localhost", "127.0.0.1"],
  detectedBrowser: null,
};
runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
  state.interceptEnabled = settings.interceptEnabled !== false;
});
runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes.interceptEnabled) {
    state.interceptEnabled = changes.interceptEnabled.newValue !== false;
  }
});

// Periodically sync app integration state and the detected browser name.
let lastSettingsSyncAt = 0;
let settingsSyncPromise = null;
async function syncWithDesktopApp() {
  if (settingsSyncPromise) return settingsSyncPromise;
  if (Date.now() - lastSettingsSyncAt < 3000) return;
  settingsSyncPromise = (async () => {
    try {
      const browser = detectBrowserFamily();
      const res = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/status?browser=${encodeURIComponent(browser)}`, {}, 2000);
      if (res.ok) {
        const cfg = await res.json();
        state.desktopIntegrationEnabled = cfg.intercept_enabled !== false;
        if (Array.isArray(cfg.intercepted_extensions)) {
          state.interceptedExtensions = cfg.intercepted_extensions.map((ext) => String(ext).replace(/^\./, "").toUpperCase());
        }
        if (Array.isArray(cfg.ignored_domains)) state.ignoredDomains = cfg.ignored_domains;
        state.detectedBrowser = cfg.browser_name || state.detectedBrowser;
      }
    } catch (_) {
      // Leave the app state unchanged while the desktop app is unavailable.
    } finally {
      lastSettingsSyncAt = Date.now();
    }
  })();
  try { await settingsSyncPromise; } finally { settingsSyncPromise = null; }
}

syncWithDesktopApp();
setInterval(syncWithDesktopApp, 5000);

// Make a successful handoff visible in Dia and other Chromium browsers. The
// badge and title work even if the browser suppresses desktop notifications.
function showHandoffIndicator(filename) {
  const label = filename || "Download";
  const action = runtimeAPI.action || runtimeAPI.browserAction;
  try { action?.setBadgeBackgroundColor?.({ color: "#0ea5e9" }); } catch (_) {}
  try { action?.setBadgeText?.({ text: "BX" }); } catch (_) {}
  try { action?.setTitle?.({ title: `${label} is downloading in ByteX` }); } catch (_) {}

  try {
    const stored = runtimeAPI.storage.local.set({ lastHandoff: { filename: label, at: Date.now() } });
    stored?.catch?.(() => {});
  } catch (_) {}

  try {
    const notification = runtimeAPI.notifications?.create?.(`bytex-handoff-${Date.now()}`, {
      type: "basic",
      iconUrl: runtimeAPI.runtime.getURL("icons/128x128.png"),
      title: "Download intercepted by ByteX",
      message: `${label} is downloading in ByteX.`,
    });
    notification?.catch?.(() => {});
  } catch (_) {}

  setTimeout(() => {
    try { action?.setBadgeText?.({ text: "" }); } catch (_) {}
    try { action?.setTitle?.({ title: "ByteX Download Manager" }); } catch (_) {}
  }, 15000);
}

function showHandoffInTab(tabId, filename) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  try {
    const result = runtimeAPI.tabs?.sendMessage?.(tabId, {
      type: "XDM_HANDOFF_CONFIRMED",
      filename: filename || "Download",
    });
    result?.catch?.(() => {});
  } catch (_) {}
}

function shouldInterceptDownload(downloadItem) {
  if (!state.interceptEnabled || !state.desktopIntegrationEnabled) return false;
  const url = downloadItem.finalUrl || downloadItem.url || "";
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (state.ignoredDomains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) return false;
    // Only browser-managed network downloads can be fetched again by ByteX.
    // Blob/data downloads are page-local and cannot be replayed by the app.
    if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) return false;
    const itemFilename = downloadItem.filename || decodeURIComponent(parsed.pathname.split("/").pop() || "");
    const extension = itemFilename.split(/[\\/]/).pop()?.split(".").pop()?.toUpperCase();
    return Boolean(extension && state.interceptedExtensions.includes(extension));
  } catch (_) {
    return false;
  }
}

async function getCookieHeaderForUrl(url, referer) {
  if (!runtimeAPI.cookies) return "";
  const cookieMap = new Map();

  async function collectCookies(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return;
    try {
      const direct = await runtimeAPI.cookies.getAll({ url: targetUrl });
      if (direct && Array.isArray(direct)) {
        for (const c of direct) {
          if (c && c.name) cookieMap.set(c.name, c.value);
        }
      }
    } catch (_) {}
  }

  // Intercept late: merge cookies from landing page (Referer) and resolved CDN stream URL
  if (referer) {
    await collectCookies(referer);
  }
  if (url) {
    await collectCookies(url);
  }

  if (cookieMap.size === 0) return "";
  return Array.from(cookieMap.entries())
    .map(([name, val]) => `${name}=${val}`)
    .join("; ");
}

async function dispatchToXdm({ url, filename, fileSize, mimeType, referer, tabTitle }) {
  const cookies = await getCookieHeaderForUrl(url, referer);

  // Extract embedded FTP/HTTP user:password credentials if present
  let authUser = null;
  let authPass = null;
  try {
    const parsed = new URL(url);
    if (parsed.username) authUser = decodeURIComponent(parsed.username);
    if (parsed.password) authPass = decodeURIComponent(parsed.password);
  } catch (_) {}

  const isTorrent =
    (filename && filename.toLowerCase().endsWith(".torrent")) ||
    (url && url.toLowerCase().split("?")[0].endsWith(".torrent")) ||
    mimeType === "application/x-bittorrent";

  const payload = {
    url,
    filename: filename || null,
    file_size: fileSize || null,
    mime_type: mimeType || null,
    referer: referer || null,
    cookies: cookies || null,
    auth_username: authUser,
    auth_password: authPass,
    is_torrent: isTorrent,
    user_agent: navigator.userAgent,
    browser: state.detectedBrowser || detectBrowserFamily(),
    tab_title: tabTitle || null,
  };

  // 1. Try fast Localhost HTTP Bridge (`127.0.0.1:45678`)
  try {
    const resp = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/intercept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 5000);
    if (resp.ok) {
      const result = await resp.json().catch(() => null);
      return result?.accepted === true
        ? { duplicate: Boolean(result.duplicate) }
        : null;
    }
  } catch (_) {
    // Fallback to Native Messaging
  }

  // 2. Fallback to Native Messaging Host (`com.peivee.xdm`) which launches XDM if closed
  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      const result = await runtimeAPI.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload);
      return result?.accepted === true
        ? { duplicate: Boolean(result.duplicate) }
        : null;
    } catch (_) {
      return false;
    }
  }
  return false;
}

const interceptedDownloadIds = new Set();

async function handleDownloadInterception(downloadItem) {
  if (downloadItem.id && interceptedDownloadIds.has(downloadItem.id)) return false;
  // Pause immediately onCreated; syncing first left time for the browser to
  // create a second transfer while ByteX was being contacted.
  if (!shouldInterceptDownload(downloadItem)) {
    await syncWithDesktopApp();
    if (!shouldInterceptDownload(downloadItem)) return false;
  }

  if (downloadItem.id) {
    interceptedDownloadIds.add(downloadItem.id);
    if (interceptedDownloadIds.size > 500) {
      const first = interceptedDownloadIds.values().next().value;
      interceptedDownloadIds.delete(first);
    }
  }

  // Freeze the browser transfer while ByteX confirms the handoff. If ByteX is
  // disabled or unreachable, resume it so the browser still completes it.
  if (downloadItem.id && runtimeAPI.downloads.pause) {
    try { await runtimeAPI.downloads.pause(downloadItem.id); } catch (_) {}
  }

  const url = downloadItem.finalUrl || downloadItem.url;
  const result = await dispatchToXdm({
    url,
    filename: downloadItem.filename || null,
    fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : null,
    mimeType: downloadItem.mime || null,
    referer: downloadItem.referrer || null,
  });

  if (result) {
    const filename = downloadItem.filename || "Download";
    showHandoffIndicator(filename);
    showHandoffInTab(downloadItem.tabId, filename);
    if (downloadItem.id && runtimeAPI.downloads.cancel) {
      try { await runtimeAPI.downloads.cancel(downloadItem.id); } catch (_) {}
      try {
        const matches = await runtimeAPI.downloads.search({ id: downloadItem.id });
        if (matches?.[0]?.state === "complete") {
          await runtimeAPI.downloads.removeFile?.(downloadItem.id);
        }
      } catch (_) {}
      try { await runtimeAPI.downloads.erase?.({ id: downloadItem.id }); } catch (_) {}
    }
    return true;
  } else {
    if (downloadItem.id && runtimeAPI.downloads.resume) {
      try { await runtimeAPI.downloads.resume(downloadItem.id); } catch (_) {}
    }
  }
  return false;
}

// "Intercept late, not early":
// Use onCreated for handoff so the browser's filename-determination event can complete
// normally. The DownloadItem includes the resolved URL on supported browsers.
if (runtimeAPI.downloads) {
  if (runtimeAPI.downloads.onCreated) {
    runtimeAPI.downloads.onCreated.addListener((downloadItem) => {
      handleDownloadInterception(downloadItem).catch(() => {
        if (downloadItem.id && runtimeAPI.downloads.resume) {
          runtimeAPI.downloads.resume(downloadItem.id).catch(() => {});
        }
      });
    });
  }
}

runtimeAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "XDM_MANUAL_CAPTURE") return false;
  (async () => {
    await syncWithDesktopApp();
    if (!state.interceptEnabled || !state.desktopIntegrationEnabled) return false;
    const result = await dispatchToXdm({
      url: message.url,
      filename: message.filename || null,
      referer: message.referer || sender.tab?.url || "",
      tabTitle: message.tabTitle || sender.tab?.title || "",
    });
    if (result) showHandoffIndicator(message.filename || "Download");
    return result;
  })().then((result) => {
    sendResponse({ success: Boolean(result), duplicate: Boolean(result?.duplicate) });
  }).catch(() => sendResponse({ success: false }));
  return true;
});

function detectBrowserFamily() {
  const ua = navigator.userAgent || "";
  const appVer = navigator.appVersion || "";
  const brands = navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)
    ? navigator.userAgentData.brands.map((b) => b.brand)
    : [];
  if (/dia/i.test(ua) || /dia/i.test(appVer) || brands.some((brand) => /dia/i.test(brand))) return "Dia";
  if (/whale/i.test(ua) || brands.some((brand) => /whale/i.test(brand))) return "NAVER Whale";
  if (/thorium/i.test(ua) || brands.some((brand) => /thorium/i.test(brand))) return "Thorium";
  if (/helium/i.test(ua) || brands.some((brand) => /helium/i.test(brand))) return "Helium";
  if (/ungoogled/i.test(ua) || brands.some((brand) => /ungoogled/i.test(brand))) return "Ungoogled Chromium";
  if (ua.includes("Arc/")) return "Arc";
  if (/OPRGX\//i.test(ua)) return "Opera GX";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Brave") || navigator.brave) return "Brave";
  if (ua.includes("Vivaldi")) return "Vivaldi";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("YaBrowser")) return "Yandex";
  if (brands.some((brand) => /google chrome/i.test(brand))) return "Chrome";
  if (brands.some((brand) => /^chromium$/i.test(brand))) return "Chromium";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Zen")) return "Zen";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
  return "Chromium";
}
