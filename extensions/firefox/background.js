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

let state = {
  interceptEnabled: true,
  bypassActive: false,
  minFileSizeKb: 256,
  interceptedExtensions: [
    "ZIP", "RAR", "7Z", "TAR", "GZ", "XZ", "EXE", "MSI", "DMG", "PKG",
    "DEB", "RPM", "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI",
    "MOV", "MP3", "FLAC", "WAV", "PDF", "DOCX", "XLSX", "PPTX", "TORRENT"
  ],
  ignoredDomains: ["localhost", "127.0.0.1"],
};

// Periodically sync settings from running XDM Desktop App
async function syncWithDesktopApp() {
  try {
    const browser = detectBrowserFamily();
    const res = await fetch(`${XDM_IPC_URL}/api/v1/status?browser=${encodeURIComponent(browser)}`);
    if (res.ok) {
      const cfg = await res.json();
      state.minFileSizeKb = cfg.min_file_size_kb ?? state.minFileSizeKb;
      state.interceptedExtensions = cfg.intercepted_extensions ?? state.interceptedExtensions;
      state.ignoredDomains = cfg.ignored_domains ?? state.ignoredDomains;
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
    runtimeAPI.contextMenus.create({
      id: "xdm-download-link",
      title: "Download with ByteX",
      contexts: ["link", "video", "audio"],
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
        });
      }
    }
  });
}

// Listen for messages from content script or popup
runtimeAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "XDM_BYPASS_STATE") {
    state.bypassActive = Boolean(msg.bypass);
  } else if (msg.type === "XDM_MANUAL_CAPTURE") {
    dispatchToXdm({
      url: msg.url,
      referer: msg.referer || (sender.tab ? sender.tab.url : ""),
      tabTitle: msg.tabTitle || (sender.tab ? sender.tab.title : ""),
    }).then(async (ok) => {
      await notifyCaptureResult(sender.tab && sender.tab.id, ok, msg.filename || msg.url);
      sendResponse({ success: ok });
    }).catch(async () => {
      await notifyCaptureResult(sender.tab && sender.tab.id, false, msg.filename || msg.url);
      sendResponse({ success: false });
    });
    return true;
  }
});

function shouldInterceptDownload(downloadItem) {
  if (!state.interceptEnabled || state.bypassActive) return false;
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
    if (state.ignoredDomains.some((d) => parsed.hostname.endsWith(d))) {
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

    return true;
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

    try {
      const u = new URL(targetUrl);
      const parts = u.hostname.split(".");
      if (parts.length >= 2) {
        // Collect domain-wide cookies (e.g. ".mediafire.com", ".1fichier.com", ".usersdrive.com")
        const rootDomain = parts.slice(-2).join(".");
        const domainCookies = await runtimeAPI.cookies.getAll({ domain: rootDomain });
        if (domainCookies && Array.isArray(domainCookies)) {
          for (const c of domainCookies) {
            if (c && c.name && !cookieMap.has(c.name)) {
              cookieMap.set(c.name, c.value);
            }
          }
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
    browser: detectBrowserFamily(),
    tab_title: tabTitle || null,
  };

  // 1. Try fast Localhost HTTP Bridge (`127.0.0.1:45678`)
  try {
    const resp = await fetch(`${XDM_IPC_URL}/api/v1/intercept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const result = await resp.json().catch(() => null);
      return result?.accepted === true && Boolean(result?.download_id);
    }
  } catch (_) {
    // Fallback to Native Messaging
  }

  // 2. Fallback to Native Messaging Host (`com.peivee.xdm`) which launches XDM if closed
  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      const result = await runtimeAPI.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload);
      return result?.accepted === true && Boolean(result?.download_id);
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

  // Stage 2 (Headers received): Immediately pause the browser download to freeze
  // socket transmission before Stage 3 (Body streaming) can consume network bandwidth!
  if (downloadItem.id && runtimeAPI.downloads && runtimeAPI.downloads.pause) {
    try {
      await runtimeAPI.downloads.pause(downloadItem.id);
    } catch (_) {}
  }

  const url = downloadItem.finalUrl || downloadItem.url;
  const accepted = await dispatchToXdm({
    url,
    filename: downloadItem.filename || null,
    fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : null,
    mimeType: downloadItem.mime || null,
    referer: downloadItem.referrer || null,
  });

  if (accepted) {
    await notifyCaptureResult(downloadItem.tabId, true, downloadItem.filename);
    try {
      runtimeAPI.downloads.cancel(downloadItem.id);
      if (runtimeAPI.downloads.erase) {
        runtimeAPI.downloads.erase({ id: downloadItem.id });
      }
    } catch (_) {}
    return true;
  } else {
    // If desktop XDM was unreachable or disabled, unpause to let the browser resume seamlessly
    await notifyCaptureResult(downloadItem.tabId, false, downloadItem.filename);
    if (downloadItem.id && runtimeAPI.downloads && runtimeAPI.downloads.resume) {
      try {
        await runtimeAPI.downloads.resume(downloadItem.id);
      } catch (_) {}
    }
  }
  return false;
}

// "Intercept late, not early":
// Prefer `downloads.onDeterminingFilename` if supported, fallback to `downloads.onCreated`.
if (runtimeAPI.downloads) {
  if (runtimeAPI.downloads.onDeterminingFilename) {
    runtimeAPI.downloads.onDeterminingFilename.addListener((downloadItem) => {
      handleDownloadInterception(downloadItem);
    });
  } else if (runtimeAPI.downloads.onCreated) {
    runtimeAPI.downloads.onCreated.addListener((downloadItem) => {
      handleDownloadInterception(downloadItem);
    });
  }
}

function detectBrowserFamily() {
  const ua = navigator.userAgent;
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

async function notifyCaptureResult(tabId, success, filename) {
  const message = {
    type: "XDM_CAPTURE_RESULT",
    success,
    filename: filename || "Download",
  };
  let delivered = false;

  if (Number.isInteger(tabId) && tabId >= 0 && runtimeAPI.tabs?.sendMessage) {
    try {
      const response = await runtimeAPI.tabs.sendMessage(tabId, message);
      delivered = response?.received === true;
    } catch (_) {
      // A page may not have a live content script. Inject the toast below.
    }

    if (!delivered && runtimeAPI.scripting?.executeScript) {
      try {
        const result = await runtimeAPI.scripting.executeScript({
          target: { tabId },
          func: renderCaptureToast,
          args: [message],
        });
        delivered = result?.some((frame) => frame.result === true) === true;
      } catch (_) {
        // Restricted browser pages do not permit content-script injection.
      }
    }
  }

  if (!delivered && runtimeAPI.notifications?.create) {
    const status = success
      ? "Download started with ByteX"
      : "ByteX could not start; the browser download continues";
    try {
      await runtimeAPI.notifications.create(`bytex-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/128x128.png",
        title: "ByteX Download Manager",
        message: `${status}: ${filename || "Download"}`,
      });
    } catch (_) {}
  }
}

function renderCaptureToast(message) {
  const root = document.documentElement || document.body;
  if (!root) return false;

  document.getElementById("bytex-capture-toast")?.remove();
  const host = document.createElement("div");
  host.id = "bytex-capture-toast";
  host.style.cssText = "all:initial;display:block;position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "closed" });
  const toast = document.createElement("div");
  const filename = (message.filename || "Download").split(/[\\/]/).pop();
  const status = message.success
    ? "Download started with ByteX"
    : "ByteX could not start; browser download continues";
  toast.textContent = `${message.success ? "✓" : "⚠"} ${status} · ${filename}`;
  toast.style.cssText = "box-sizing:border-box;background:#102038;color:#f7fbff;border:1px solid #45d9cf;border-radius:10px;padding:12px 16px;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px #0008;max-width:min(420px,calc(100vw - 40px));overflow-wrap:anywhere";
  shadow.appendChild(toast);
  root.appendChild(host);
  setTimeout(() => host.remove(), 5000);
  return true;
}
