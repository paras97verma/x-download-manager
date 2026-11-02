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
async function syncWithDesktopApp() {
  try {
    const browser = detectBrowserFamily();
    const res = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/status?browser=${encodeURIComponent(browser)}`, {}, 2000);
    if (res.ok) {
      const cfg = await res.json();
      state.desktopIntegrationEnabled = cfg.intercept_enabled !== false;
      state.detectedBrowser = cfg.browser_name || state.detectedBrowser;
    }
  } catch (_) {
    // Leave the app state unchanged while the desktop app is unavailable.
  }
}

syncWithDesktopApp();
setInterval(syncWithDesktopApp, 15000);

function shouldInterceptDownload(downloadItem) {
  if (!state.interceptEnabled || !state.desktopIntegrationEnabled) return false;
  const url = downloadItem.finalUrl || downloadItem.url || "";
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "ftp:"].includes(parsed.protocol);
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
      return result?.accepted === true && result?.download_id
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
      return result?.accepted === true && result?.download_id
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
  if (!shouldInterceptDownload(downloadItem)) return false;

  if (downloadItem.id) {
    interceptedDownloadIds.add(downloadItem.id);
    if (interceptedDownloadIds.size > 500) {
      const first = interceptedDownloadIds.values().next().value;
      interceptedDownloadIds.delete(first);
    }
  }

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
    if (downloadItem.id && runtimeAPI.downloads.cancel) {
      try {
        await runtimeAPI.downloads.cancel(downloadItem.id);
        await runtimeAPI.downloads.erase?.({ id: downloadItem.id });
      } catch (_) {}
    }
    return true;
  } else {
    if (downloadItem.id && runtimeAPI.downloads.resume) {
      try { await runtimeAPI.downloads.resume(downloadItem.id); } catch (_) {}
    }
  }
  return false;
}

// Let filename determination complete normally, then process the created download.
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

function detectBrowserFamily() {
  const ua = navigator.userAgent;
  if (/TorBrowser|Tor Browser/i.test(ua)) return "Tor Browser";
  if (/Mullvad/i.test(ua)) return "Mullvad Browser";
  if (ua.includes("Zen")) return "Zen";
  if (ua.includes("LibreWolf")) return "LibreWolf";
  if (ua.includes("Waterfox")) return "Waterfox";
  if (ua.includes("Floorp")) return "Floorp";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("OPR/")) return "Opera";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
  return "Chromium";
}
