// ByteX Download Manager (XDM) — Background Service Worker / WebExtension Script
// Works across Chromium (Chrome, Brave, Edge, Opera, Vivaldi), Mozilla Firefox, and Apple Safari.
// Features:
// 1. Intercepts browser downloads (`downloads.onCreated`) matching configured extensions or size threshold
// 2. Captures site cookies (including `xfss` for Usersdrive, session tokens for FTP/private hosts), Referer, and User-Agent
// 3. Dispatches payload to XDM Desktop App via Local IPC Bridge (`http://127.0.0.1:45678/api/v1/intercept`)
//    with automatic fallback to Native Messaging (`com.peivee.xdm`).

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
  minFileSizeKb: 256,
  interceptedExtensions: [
    "ZIP", "RAR", "7Z", "TAR", "GZ", "XZ", "EXE", "MSI", "DMG", "PKG",
    "DEB", "RPM", "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI",
    "MOV", "MP3", "FLAC", "WAV", "PDF", "DOCX", "XLSX", "PPTX", "TORRENT"
  ],
  ignoredDomains: ["localhost", "127.0.0.1"],
  detectedBrowser: null,
};
const bypassTabs = new Set();

runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
  state.interceptEnabled = settings.interceptEnabled !== false;
});
runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes.interceptEnabled) {
    state.interceptEnabled = changes.interceptEnabled.newValue !== false;
  }
});
runtimeAPI.tabs?.onRemoved?.addListener((tabId) => bypassTabs.delete(tabId));

// Periodically sync settings from running XDM Desktop App
async function syncWithDesktopApp() {
  try {
    const browser = detectBrowserFamily();
    const res = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/status?browser=${encodeURIComponent(browser)}`, {}, 2000);
    if (res.ok) {
      const cfg = await res.json();
      state.minFileSizeKb = cfg.min_file_size_kb ?? state.minFileSizeKb;
      state.interceptedExtensions = cfg.intercepted_extensions ?? state.interceptedExtensions;
      state.ignoredDomains = cfg.ignored_domains ?? state.ignoredDomains;
      state.detectedBrowser = cfg.browser_name || state.detectedBrowser;
    }
  } catch (_) {
    // Desktop app will be woken via Native Messaging when a download occurs
  }
}

syncWithDesktopApp();
setInterval(syncWithDesktopApp, 15000);

// Create Context Menu Item ("Download with ByteX")
runtimeAPI.runtime.onInstalled.addListener(() => {
  if (runtimeAPI.contextMenus) {
    runtimeAPI.contextMenus.removeAll(() => {
      if (runtimeAPI.runtime.lastError) return;
      runtimeAPI.contextMenus.create({
        id: "xdm-download-link",
        title: "Download with ByteX",
        contexts: ["link", "video", "audio"],
      }, () => {
        // Read lastError in the callback so an unsupported context is harmless.
        void runtimeAPI.runtime.lastError;
      });
    });
  }
});

if (runtimeAPI.contextMenus) {
  runtimeAPI.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "xdm-download-link") {
      const targetUrl = info.linkUrl || info.srcUrl;
      if (targetUrl) {
        dispatchToXdm({
          url: targetUrl,
          referer: info.pageUrl || (tab ? tab.url : ""),
          tabTitle: tab ? tab.title : "",
        }).then((result) => recordTransferResult(Boolean(result), targetUrl, result?.duplicate))
          .catch(() => recordTransferResult(false, targetUrl));
      }
    }
  });
}

// Listen for messages from content script or popup
runtimeAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "XDM_BYPASS_STATE") {
    const tabId = sender.tab && sender.tab.id;
    if (Number.isInteger(tabId)) {
      if (msg.bypass) bypassTabs.add(tabId);
      else bypassTabs.delete(tabId);
    }
  } else if (msg.type === "XDM_MANUAL_CAPTURE") {
    dispatchToXdm({
      url: msg.url,
      referer: msg.referer || (sender.tab ? sender.tab.url : ""),
      tabTitle: msg.tabTitle || (sender.tab ? sender.tab.title : ""),
    }).then(async (result) => {
      const ok = Boolean(result);
      recordTransferResult(ok, msg.filename || msg.url, result?.duplicate);
      sendResponse({ success: ok, duplicate: Boolean(result?.duplicate) });
    }).catch(async () => {
      recordTransferResult(false, msg.filename || msg.url);
      sendResponse({ success: false });
    });
    return true;
  }
});

function shouldInterceptDownload(downloadItem) {
  if (!state.interceptEnabled || bypassTabs.has(downloadItem.tabId)) return false;
  const url = downloadItem.finalUrl || downloadItem.url || "";
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;

  const mime = (downloadItem.mime || "").toLowerCase();
  const filename = (downloadItem.filename || "").toLowerCase();

  // "Intercept late, not early":
  // Never intercept HTML pages, landing templates, countdowns, captcha challenges, or error pages!
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return false;
  }
  if (filename.endsWith(".html") || filename.endsWith(".htm")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (state.ignoredDomains.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return false;
    }

    // Guard against intercepting web page navigations masquerading as downloads
    const path = parsed.pathname.toLowerCase();
    if (
      (path === "" ||
        path === "/" ||
        path.endsWith(".php") ||
        path.endsWith(".asp") ||
        path.endsWith(".aspx") ||
        path.endsWith(".jsp")) &&
      (!mime || mime.includes("text") || !filename)
    ) {
      return false;
    }

    const extension = filename.split(".").pop().toUpperCase();
    const extensionMatch = state.interceptedExtensions.some((value) => value.toUpperCase() === extension);
    const sizeMatch = Number(downloadItem.totalBytes) >= state.minFileSizeKb * 1024;
    return extensionMatch || sizeMatch;
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
  await syncWithDesktopApp();
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

  const url = downloadItem.finalUrl || downloadItem.url;
  const result = await dispatchToXdm({
    url,
    filename: downloadItem.filename || null,
    fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : null,
    mimeType: downloadItem.mime || null,
    referer: downloadItem.referrer || null,
  });

  if (result) {
    recordTransferResult(true, downloadItem.filename, result.duplicate);
    // Cancel only after ByteX confirms acceptance, and avoid extra browser
    // download state transitions during the handoff.
    if (downloadItem.id && downloadItem.state === "in_progress" && runtimeAPI.downloads.cancel) {
      try { await runtimeAPI.downloads.cancel(downloadItem.id); } catch (_) {}
    }
    return true;
  } else {
    // On failed handoff the original browser download remains untouched.
    recordTransferResult(false, downloadItem.filename);
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
        recordTransferResult(false, downloadItem.filename);
      });
    });
  }
}

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

function recordTransferResult(success, filename, duplicate = false) {
  const transfer = {
    status: success ? (duplicate ? "duplicate" : "sent") : "failed",
    filename: filename || "Download",
    timestamp: Date.now(),
  };
  try {
    const saved = runtimeAPI.storage.local.set({ lastTransfer: transfer });
    saved?.catch?.(() => {});
  } catch (_) {}

}
