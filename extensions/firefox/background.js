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
  ignoredDomains: ["localhost", "127.0.0.1"],
  detectedBrowser: null,
};
const interceptSettingsReady = new Promise((resolve) => runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
  state.interceptEnabled = settings.interceptEnabled !== false;
  resolve();
}));
try {
  const cleanup = runtimeAPI.storage.local.remove?.("lastHandoff");
  cleanup?.catch?.(() => {});
} catch (_) {}
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

function showHandoffIndicator(filename) {
  const action = runtimeAPI.action || runtimeAPI.browserAction;
  const label = displayFilename(filename);
  try { action?.setBadgeBackgroundColor?.({ color: "#0ea5e9" }); } catch (_) {}
  try { action?.setBadgeText?.({ text: "BX" }); } catch (_) {}
  try { action?.setTitle?.({ title: `${label} is downloading in ByteX` }); } catch (_) {}
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

function displayFilename(filename) {
  const normalized = String(filename || "Download").replace(/\\/g, "/");
  return normalized.split("/").pop() || "Download";
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
    // The browser's download event already identifies an actual download, so
    // filename and extension filters would miss extensionless or uncommon files.
    // ByteX can fetch HTTP, HTTPS, and FTP URLs; page-local data/blob URLs cannot
    // be replayed by its network download engine.
    return ["http:", "https:", "ftp:"].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

function fallbackGetRequestContext(downloadItem) {
  // Some browser builds do not expose webRequest details to extensions.
  // Replay only the resolved GET URL and let ByteX validate the response
  // before it acknowledges takeover.
  const resolvedUrl = downloadItem.finalUrl || downloadItem.url || "";
  let protocol = "";
  try { protocol = new URL(resolvedUrl).protocol; } catch (_) {}
  const replayable = ["http:", "https:", "ftp:"].includes(protocol);
  return {
    originalUrl: resolvedUrl,
    finalUrl: resolvedUrl,
    method: "GET",
    replayable,
    unavailableReason: replayable ? null : "The browser did not expose a replayable download URL.",
    headers: {},
    redirects: [],
  };
}

function resolveDownloadRequestContext(downloadItem) {
  const captured = globalThis.ByteXRequestCapture?.find(downloadItem);
  if (captured && captured.replayable !== false) return captured;
  const method = String(captured?.method || "GET").toUpperCase();
  if (captured && ["POST", "PUT", "PATCH"].includes(method)) return captured;
  return fallbackGetRequestContext(downloadItem);
}

async function pauseBrowserDownload(id) {
  if (!Number.isInteger(id) || !runtimeAPI.downloads?.pause || !runtimeAPI.downloads?.search) return null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { await runtimeAPI.downloads.pause(id); } catch (_) {}
    try {
      const matches = await runtimeAPI.downloads.search({ id });
      const current = matches?.[0];
      if (!current) return null;
      if (current.state === "paused" || current.state === "complete") return current.state;
      if (current.state === "interrupted") return null;
    } catch (_) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return null;
}

async function stopBrowserDownload(id) {
  if (!Number.isInteger(id) || !runtimeAPI.downloads?.search) return false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let current;
    try {
      current = (await runtimeAPI.downloads.search({ id }))?.[0];
    } catch (_) {
      return false;
    }
    if (!current) return true;
    if (current.state === "complete") {
      try {
        if (!runtimeAPI.downloads.removeFile) return false;
        await runtimeAPI.downloads.removeFile(id);
      } catch (_) {
        return false;
      }
      try { await runtimeAPI.downloads.erase?.({ id }); } catch (_) {}
      return true;
    }
    if (current.state === "interrupted") {
      try { await runtimeAPI.downloads.erase?.({ id }); } catch (_) {}
      return true;
    }
    try { await runtimeAPI.downloads.cancel?.(id); } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return false;
}

async function resumeBrowserDownload(id) {
  if (!Number.isInteger(id) || !runtimeAPI.downloads?.resume) return;
  try { await runtimeAPI.downloads.resume(id); } catch (_) {}
}

async function getCookieHeaderForUrl(url) {
  if (!runtimeAPI.cookies) return "";
  if (!url || typeof url !== "string") return "";
  try {
    const cookies = await runtimeAPI.cookies.getAll({ url });
    return Array.isArray(cookies)
      ? cookies.filter((cookie) => cookie && cookie.name).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
      : "";
  } catch (_) {
    return "";
  }
}

async function dispatchToXdm({
  url,
  originalUrl,
  finalUrl,
  redirects,
  method,
  bodyBase64,
  requestReplayable,
  requestUnavailableReason,
  headers,
  responseHeaders,
  responseStatus,
  filename,
  fileSize,
  mimeType,
  referer,
  tabTitle,
}) {
  const requestHeaders = { ...(headers || {}) };
  const cookies = requestHeaders.cookie ? "" : await getCookieHeaderForUrl(finalUrl || url);
  let finalRequestUrl = finalUrl || url;
  let capturedOriginalUrl = originalUrl || url;

  // Extract embedded FTP/HTTP user:password credentials if present
  let authUser = null;
  let authPass = null;
  try {
    const parsed = new URL(finalRequestUrl);
    const embeddedUser = parsed.username ? decodeURIComponent(parsed.username) : "";
    const embeddedPass = parsed.password ? decodeURIComponent(parsed.password) : "";
    if (["ftp:", "ftps:"].includes(parsed.protocol)) {
      authUser = embeddedUser || null;
      authPass = embeddedPass || null;
    }
    if (["http:", "https:"].includes(parsed.protocol) && (embeddedUser || embeddedPass)) {
      requestHeaders.authorization ||= `Basic ${btoa(`${embeddedUser}:${embeddedPass}`)}`;
      parsed.username = "";
      parsed.password = "";
      finalRequestUrl = parsed.toString();
    }
    if (["http:", "https:"].includes(parsed.protocol)) {
      const original = new URL(capturedOriginalUrl);
      original.username = "";
      original.password = "";
      capturedOriginalUrl = original.toString();
    }
  } catch (_) {}

  const isTorrent =
    (filename && filename.toLowerCase().endsWith(".torrent")) ||
    (url && url.toLowerCase().split("?")[0].endsWith(".torrent")) ||
    mimeType === "application/x-bittorrent";

  const payload = {
    url: capturedOriginalUrl,
    original_url: capturedOriginalUrl,
    final_url: finalRequestUrl,
    redirects: redirects || [],
    filename: filename || null,
    file_size: fileSize || null,
    mime_type: mimeType || null,
    referer: requestHeaders.referer || referer || null,
    cookies: cookies || null,
    headers: requestHeaders,
    method: method || "GET",
    body_base64: bodyBase64 ?? null,
    request_replayable: requestReplayable !== false,
    request_unavailable_reason: requestUnavailableReason || null,
    response_headers: responseHeaders || {},
    response_status: responseStatus || null,
    auth_username: authUser,
    auth_password: authPass,
    is_torrent: isTorrent,
    user_agent: navigator.userAgent,
    browser: state.detectedBrowser || detectBrowserFamily(),
    tab_title: tabTitle || null,
  };

  // Native Messaging keeps request credentials off the browser's loopback CORS surface.
  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      const result = await runtimeAPI.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload);
      return result?.accepted === true
        ? { accepted: true, duplicate: Boolean(result.duplicate), reason: null }
        : { accepted: false, reason: result?.reason || result?.error || "ByteX could not safely take over this request." };
    } catch (_) {
      return { accepted: false, reason: "Native Messaging could not reach ByteX." };
    }
  }
  return { accepted: false, reason: "Native Messaging is unavailable; the browser download will continue." };
}

const interceptedDownloadIds = new Set();

async function handleDownloadInterception(downloadItem) {
  await interceptSettingsReady;
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

  // Resolve request metadata before any pause/IPC await. Other downloads can
  // complete while those operations are pending and otherwise steal the
  // newest same-URL capture from this event.
  const requestContext = resolveDownloadRequestContext(downloadItem);

  let paused = false;
  let appAccepted = false;
  try {
    const browserState = await pauseBrowserDownload(downloadItem.id);
    if (!browserState) {
      showHandoffFailure(
        downloadItem.filename,
        "ByteX could not confirm that the browser download is active and paused, so it did not start another transfer. Check the browser download status.",
      );
      return false;
    }
    if (browserState === "complete") {
      showHandoffFailure(
        downloadItem.filename,
        "This download finished in the browser before ByteX could take over. It was not started again in ByteX.",
      );
      return false;
    }
    paused = browserState === "paused";

    await syncWithDesktopApp();
    if (!shouldInterceptDownload(downloadItem)) {
      if (paused) {
        await resumeBrowserDownload(downloadItem.id);
      }
      return false;
    }

    const result = await dispatchToXdm({
      url: requestContext.originalUrl,
      originalUrl: requestContext.originalUrl,
      finalUrl: requestContext.finalUrl,
      redirects: requestContext.redirects,
      method: requestContext.method,
      bodyBase64: requestContext.bodyBase64,
      requestReplayable: requestContext.replayable,
      requestUnavailableReason: requestContext.unavailableReason,
      headers: requestContext.headers,
      responseHeaders: requestContext.responseHeaders,
      responseStatus: requestContext.responseStatus,
      filename: displayFilename(downloadItem.filename),
      fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : null,
      mimeType: downloadItem.mime || null,
      referer: downloadItem.referrer || requestContext.headers?.referer || null,
    });
    if (!result?.accepted) {
      showHandoffFailure(
        downloadItem.filename,
        result?.reason || "ByteX could not safely reconstruct the browser request, so the browser download is continuing.",
      );
      if (paused) {
        await resumeBrowserDownload(downloadItem.id);
      }
      return false;
    }
    appAccepted = true;

    const browserStopped = await stopBrowserDownload(downloadItem.id);
    const filename = displayFilename(downloadItem.filename);
    if (browserStopped) {
      showHandoffIndicator(filename);
      showHandoffInTab(downloadItem.tabId, filename);
      return true;
    }
    showHandoffWarning(filename);
    return false;
  } catch (_) {
    if (paused && !appAccepted) await resumeBrowserDownload(downloadItem.id);
    return false;
  }
}

function showHandoffFailure(filename, message) {
  const label = displayFilename(filename);
  const action = runtimeAPI.action || runtimeAPI.browserAction;
  try { action?.setBadgeBackgroundColor?.({ color: "#f59e0b" }); } catch (_) {}
  try { action?.setBadgeText?.({ text: "!" }); } catch (_) {}
  try { action?.setTitle?.({ title: message }); } catch (_) {}
  try {
    const notification = runtimeAPI.notifications?.create?.(`bytex-handoff-failure-${Date.now()}`, {
      type: "basic",
      iconUrl: runtimeAPI.runtime.getURL("icons/128x128.png"),
      title: "ByteX did not take over this download",
      message: `${label}: ${message}`,
    });
    notification?.catch?.(() => {});
  } catch (_) {}
}

function showHandoffWarning(filename) {
  const action = runtimeAPI.action || runtimeAPI.browserAction;
  try { action?.setBadgeBackgroundColor?.({ color: "#f59e0b" }); } catch (_) {}
  try { action?.setBadgeText?.({ text: "!" }); } catch (_) {}
  try { action?.setTitle?.({ title: "ByteX accepted this download; the browser copy is paused" }); } catch (_) {}
  try {
    const notification = runtimeAPI.notifications?.create?.(`bytex-handoff-warning-${Date.now()}`, {
      type: "basic",
      iconUrl: runtimeAPI.runtime.getURL("icons/128x128.png"),
      title: "ByteX accepted the download",
      message: `The browser copy of ${filename} is paused and could not be removed.`,
    });
    notification?.catch?.(() => {});
  } catch (_) {}
}

// Let filename determination complete normally, then process the created download.
if (runtimeAPI.downloads) {
  if (runtimeAPI.downloads.onCreated) {
    runtimeAPI.downloads.onCreated.addListener((downloadItem) => {
      return handleDownloadInterception(downloadItem).catch(() => {});
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
    if (result?.accepted) showHandoffIndicator(message.filename || "Download");
    return result;
  })().then((result) => {
    sendResponse({ success: Boolean(result?.accepted), duplicate: Boolean(result?.duplicate) });
  }).catch(() => sendResponse({ success: false }));
  return true;
});

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
