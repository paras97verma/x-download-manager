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
try {
  const cleanup = runtimeAPI.storage.local.remove?.("lastHandoff");
  cleanup?.catch?.(() => {});
} catch (_) {}
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

function showHandoffIndicator(filename) {
  const action = runtimeAPI.action || runtimeAPI.browserAction;
  if (!action) return;
  const label = String(filename || "Download").replace(/\\/g, "/").split("/").pop() || "Download";
  try { action.setBadgeBackgroundColor?.({ color: "#0ea5e9" }); } catch (_) {}
  try { action.setBadgeText?.({ text: "BX" }); } catch (_) {}
  try { action.setTitle?.({ title: `${label} is downloading in ByteX` }); } catch (_) {}
  setTimeout(() => {
    try { action.setBadgeText?.({ text: "" }); } catch (_) {}
    try { action.setTitle?.({ title: "ByteX Download Manager" }); } catch (_) {}
  }, 8000);
}

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
        if (success) showHandoffIndicator(msg.filename || "Download");
        sendResponse({ success, duplicate: Boolean(result?.duplicate) });
      })
      .catch(() => {
        sendResponse({ success: false });
      });
    return true; // Keep message port open for async response
  }

  if (msg.type === "YOUTUBE_GET_METADATA") {
    (async () => {
      try {
        const query = new URLSearchParams({
          url: msg.url || "",
          title: msg.tabTitle || (sender.tab ? sender.tab.title : "") || "",
        });
        const resp = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/media/metadata?${query.toString()}`, {}, 4000);
        if (resp.ok) return await resp.json();
      } catch (err) {
        return { error: "Failed to connect to ByteX desktop application." };
      }
      return { error: "Media metadata unavailable." };
    })().then(sendResponse).catch((err) => sendResponse({ error: err?.message || String(err) }));
    return true;
  }

  if (msg.type === "YOUTUBE_START_DOWNLOAD") {
    (async () => {
      try {
        const resp = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/media/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg.jobPayload),
        }, 5000);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.accepted) showHandoffIndicator(msg.jobPayload?.title || "Video Download");
          return data;
        }
      } catch (err) {
        return { accepted: false, error: "Failed to connect to ByteX desktop application." };
      }
      return { accepted: false, error: "Could not start media download." };
    })().then(sendResponse).catch((err) => sendResponse({ accepted: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});

async function getCookieHeaderForUrl(url) {
  if (runtimeAPI.cookies) {
    try {
      const cookies = await runtimeAPI.cookies.getAll({ url });
      return Array.isArray(cookies)
        ? cookies.filter((cookie) => cookie?.name).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") || null
        : null;
    } catch (_) {}
  }
  return null;
}

async function dispatchToXdm({ url, filename, fileSize, mimeType, referer, tabTitle }) {
  const resolvedCookies = await getCookieHeaderForUrl(url);

  let authUser = null;
  let authPass = null;
  let safeUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.username) authUser = decodeURIComponent(parsed.username);
    if (parsed.password) authPass = decodeURIComponent(parsed.password);
    parsed.username = "";
    parsed.password = "";
    safeUrl = parsed.toString();
  } catch (_) {}

  const isTorrent =
    (filename && filename.toLowerCase().endsWith(".torrent")) ||
    (url && url.toLowerCase().split("?")[0].endsWith(".torrent")) ||
    mimeType === "application/x-bittorrent";

  const payload = {
    url: safeUrl,
    filename: filename || null,
    file_size: fileSize || null,
    mime_type: mimeType || null,
    referer: referer || null,
    cookies: resolvedCookies,
    auth_username: authUser,
    auth_password: authPass,
    is_torrent: isTorrent,
    user_agent: navigator.userAgent,
    browser: /orion/i.test(navigator.userAgent || "") ? "Orion" : "Safari",
    tab_title: tabTitle || null,
  };

  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      const result = await runtimeAPI.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload);
      return result?.accepted === true
        ? { duplicate: Boolean(result.duplicate) }
        : null;
    } catch (_) {}
  }

  // Fallback to HTTP IPC bridge
  try {
    const response = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/intercept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 5000);
    if (response.ok) {
      const result = await response.json();
      return result?.accepted === true ? { duplicate: Boolean(result.duplicate) } : null;
    }
  } catch (_) {}

  return false;
}
