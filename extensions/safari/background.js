// ByteX Download Manager (XDM) — Safari Background Service Worker & Script
// Receives download links from the small Safari content script, sends them to
// ByteX, and falls back to Safari if the app declines or cannot receive them.

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
};

runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
  state.interceptEnabled = settings.interceptEnabled !== false;
});
runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes.interceptEnabled) {
    state.interceptEnabled = changes.interceptEnabled.newValue !== false;
  }
});

// Periodically sync whether app integration is enabled.
async function syncWithDesktopApp() {
  try {
    const res = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/status?browser=safari`, {}, 2000);
    if (res.ok) {
      const cfg = await res.json();
      state.desktopIntegrationEnabled = cfg.intercept_enabled !== false;
      if (Array.isArray(cfg.intercepted_extensions)) {
        state.interceptedExtensions = cfg.intercepted_extensions.map((ext) => String(ext).replace(/^\./, "").toUpperCase());
      }
      if (Array.isArray(cfg.ignored_domains)) state.ignoredDomains = cfg.ignored_domains;
      const saved = runtimeAPI.storage.local.set({
        appInterceptedExtensions: state.interceptedExtensions,
        appIgnoredDomains: state.ignoredDomains,
      });
      saved?.catch?.(() => {});
    }
  } catch (_) {
    // Desktop app will be woken via Native Messaging when a download occurs
  }
}

syncWithDesktopApp();
setInterval(syncWithDesktopApp, 5000);

// Listen for messages from content script or popup
runtimeAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_INTERCEPT_SETTINGS") {
    sendResponse({
      interceptEnabled: state.interceptEnabled,
      desktopIntegrationEnabled: state.desktopIntegrationEnabled,
      interceptedExtensions: state.interceptedExtensions,
      ignoredDomains: state.ignoredDomains,
    });
    return false;
  }
  if (msg.type === "XDM_MANUAL_CAPTURE") {
    if (!state.interceptEnabled || !state.desktopIntegrationEnabled) {
      sendResponse({ success: false, disabled: true });
      return false;
    }
    dispatchToXdm({
      url: msg.url,
      filename: msg.filename || null,
      referer: msg.referer || (sender.tab ? sender.tab.url : ""),
      cookies: msg.cookies || null,
      tabTitle: msg.tabTitle || (sender.tab ? sender.tab.title : ""),
    })
      .then((result) => {
        const success = Boolean(result);
        sendResponse({ success, duplicate: Boolean(result?.duplicate) });
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
    browser: /orion/i.test(navigator.userAgent || "") ? "Orion" : "Safari",
    tab_title: tabTitle || null,
  };

  // 1. Try fast Localhost HTTP Bridge (http://127.0.0.1:45678)
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
  } catch (err) {
    console.warn("XDM Safari bridge HTTP fetch failed:", err);
  }

  // 2. Fallback to Native Messaging Host (com.peivee.xdm)
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
