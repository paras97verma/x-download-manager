// X Download Manager (XDM) — Safari Background Service Worker & Script
// Features:
// 1. Receives intercepted link downloads and streaming media from content.js
// 2. Captures full authentication cookies, Referer, and User-Agent headers
// 3. Dispatches payload to XDM Desktop App via Local IPC Bridge (http://127.0.0.1:45678/api/v1/intercept)
//    with automatic fallback to Native Messaging (com.peivee.xdm).

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

// Periodically sync settings from running XDM Desktop App and record heartbeat
async function syncWithDesktopApp() {
  try {
    const res = await fetch(`${XDM_IPC_URL}/api/v1/status?browser=safari`);
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

// Create Context Menu Item ("Download with X Download Manager")
runtimeAPI.runtime.onInstalled.addListener(() => {
  if (runtimeAPI.contextMenus) {
    try {
      runtimeAPI.contextMenus.create({
        id: "xdm-download-link",
        title: "Download with X Download Manager",
        contexts: ["link", "video", "audio", "image"],
      });
    } catch (_) {}
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
    sendResponse({ received: true });
    return false;
  }

  if (msg.type === "XDM_MANUAL_CAPTURE") {
    dispatchToXdm({
      url: msg.url,
      filename: msg.filename || null,
      referer: msg.referer || (sender.tab ? sender.tab.url : ""),
      cookies: msg.cookies || null,
      tabTitle: msg.tabTitle || (sender.tab ? sender.tab.title : ""),
    })
      .then((ok) => {
        sendResponse({ success: ok });
      })
      .catch(() => {
        sendResponse({ success: false });
      });
    return true; // Keep message port open for async response
  }

  return false;
});

async function getCookieHeaderForUrl(url, referer, clientCookies) {
  const cookieMap = new Map();

  // Merge cookies sent directly by content script (document.cookie)
  if (clientCookies && typeof clientCookies === "string") {
    clientCookies.split(";").forEach((pair) => {
      const parts = pair.trim().split("=");
      if (parts[0]) {
        cookieMap.set(parts[0], parts.slice(1).join("="));
      }
    });
  }

  // Also query browser.cookies API if available
  if (runtimeAPI.cookies) {
    try {
      const cookies = await runtimeAPI.cookies.getAll({ url });
      if (Array.isArray(cookies)) {
        cookies.forEach((c) => {
          if (c && c.name) cookieMap.set(c.name, c.value);
        });
      }
    } catch (_) {}

    if (referer) {
      try {
        const refCookies = await runtimeAPI.cookies.getAll({ url: referer });
        if (Array.isArray(refCookies)) {
          refCookies.forEach((c) => {
            if (c && c.name && !cookieMap.has(c.name)) {
              cookieMap.set(c.name, c.value);
            }
          });
        }
      } catch (_) {}
    }
  }

  if (cookieMap.size === 0) return null;
  return Array.from(cookieMap.entries())
    .map(([name, val]) => `${name}=${val}`)
    .join("; ");
}

async function dispatchToXdm({ url, filename, fileSize, mimeType, referer, cookies, tabTitle }) {
  const resolvedCookies = await getCookieHeaderForUrl(url, referer, cookies);

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
    cookies: resolvedCookies || null,
    auth_username: authUser,
    auth_password: authPass,
    is_torrent: isTorrent,
    user_agent: navigator.userAgent,
    browser: "Safari",
    tab_title: tabTitle || null,
  };

  // 1. Try fast Localhost HTTP Bridge (http://127.0.0.1:45678)
  try {
    const resp = await fetch(`${XDM_IPC_URL}/api/v1/intercept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      return true;
    }
  } catch (err) {
    console.warn("XDM Safari bridge HTTP fetch failed:", err);
  }

  // 2. Fallback to Native Messaging Host (com.peivee.xdm)
  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      await runtimeAPI.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload);
      return true;
    } catch (_) {
      return false;
    }
  }

  return false;
}
