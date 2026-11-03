// ByteX Download Manager (XDM) — Background Service Worker / WebExtension Script
// Works across Chromium (Chrome, Brave, Edge, Opera, Vivaldi), Mozilla Firefox, and Apple Safari.
// Intercepts browser-managed network downloads, sends them to ByteX, and resumes
// the browser transfer if the app declines or cannot receive the handoff.

try { importScripts("durable-outbox.js"); } catch (_) {}
try { importScripts("request-capture.js"); } catch (_) {}

const HandoffState = globalThis.ByteXHandoffState || {
  DETECTED: "DETECTED",
  CLASSIFIED: "CLASSIFIED",
  CONTEXT_COLLECTED: "CONTEXT_COLLECTED",
  BRIDGE_CONNECTING: "BRIDGE_CONNECTING",
  SUBMITTED: "SUBMITTED",
  APP_VALIDATING: "APP_VALIDATING",
  APP_ACCEPTED: "APP_ACCEPTED",
  REPLACEMENT_READY: "REPLACEMENT_READY",
  BROWSER_CANCEL_REQUESTED: "BROWSER_CANCEL_REQUESTED",
  BROWSER_CANCELLED: "BROWSER_CANCELLED",
  DESKTOP_RUNNING: "DESKTOP_RUNNING",
  FAILED_FALLBACK_RESUMED: "FAILED_FALLBACK_RESUMED",
};

const durableOutbox = globalThis.ByteXDurableOutbox || {
  recordTransition: async () => {},
  markResolved: async () => {},
  getEntry: () => null,
  reconcileOnStartup: async () => {},
};

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

// Make a successful handoff visible in Dia and other Chromium browsers. The
// badge and title work even if the browser suppresses desktop notifications.
function displayFilename(filename) {
  const normalized = String(filename || "Download").replace(/\\/g, "/");
  return normalized.split("/").pop() || "Download";
}

function showHandoffIndicator(filename) {
  const label = displayFilename(filename);
  const action = runtimeAPI.action || runtimeAPI.browserAction;
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
    if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function fallbackGetRequestContext(downloadItem) {
  // Some Chromium forks do not expose webRequest details to extensions. The
  // downloads API still gives us the resolved URL, so replay only a GET against
  // that URL and let ByteX validate the response before it acknowledges takeover.
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
  if (!Number.isInteger(id) || !runtimeAPI.downloads) return false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await runtimeAPI.downloads.cancel?.(id); } catch (_) {}
    try { await runtimeAPI.downloads.erase?.({ id }); } catch (_) {}
    if (!runtimeAPI.downloads.search) return true;
    try {
      const matches = await runtimeAPI.downloads.search({ id });
      const current = matches?.[0];
      if (!current || current.state === "interrupted") {
        try { await runtimeAPI.downloads.erase?.({ id }); } catch (_) {}
        return true;
      }
      if (current.state === "complete") {
        try { await runtimeAPI.downloads.removeFile?.(id); } catch (_) {}
        try { await runtimeAPI.downloads.erase?.({ id }); } catch (_) {}
        return true;
      }
    } catch (_) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

async function resumeBrowserDownload(id) {
  if (!Number.isInteger(id) || !runtimeAPI.downloads?.resume) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await runtimeAPI.downloads.resume(id); } catch (_) {}
    if (!runtimeAPI.downloads.search) return;
    try {
      const matches = await runtimeAPI.downloads.search({ id });
      const current = matches?.[0];
      if (!current || current.state !== "paused") {
        return;
      }
    } catch (_) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
  }
}

async function dispatchViaHttpIpc(payload) {
  try {
    const response = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/intercept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 6000);
    if (response.ok) {
      const result = await response.json();
      if (result && typeof result.accepted === "boolean") {
        return result.accepted
          ? { accepted: true, duplicate: Boolean(result.duplicate), reason: null }
          : { accepted: false, reason: result.reason || "ByteX could not safely take over this request." };
      }
    }
  } catch (_) {}
  return null;
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

function sendNativeMessage(host, payload) {
  const send = runtimeAPI.runtime.sendNativeMessage;
  if (typeof browser !== "undefined") {
    return send.call(runtimeAPI.runtime, host, payload);
  }

  // Chromium-family browsers differ in whether this API returns a Promise.
  // Supplying a callback works with older callback-only implementations, and
  // the Promise branch keeps newer Chromium builds compatible as well.
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for the ByteX native host.")), 55000);
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const runtimeError = runtimeAPI.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || "Native Messaging failed."));
      } else if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else if (response === undefined || response === null) {
        reject(new Error("The ByteX native host returned no acknowledgement."));
      } else {
        resolve(response);
      }
    };

    try {
      const pending = send.call(runtimeAPI.runtime, host, payload, (response) => finish(null, response));
      if (pending && typeof pending.then === "function") {
        pending.then((response) => finish(null, response), (error) => finish(error));
      } else if (pending !== undefined) {
        finish(null, pending);
      }
    } catch (error) {
      finish(error);
    }
  });
}

function nativeMessagingFailureMessage(error) {
  const message = String(error?.message || error || "Native Messaging failed.").trim();
  const normalized = message.toLowerCase();
  if (normalized.includes("native messaging host") && (normalized.includes("not found") || normalized.includes("does not exist"))) {
    return "ByteX's native handoff is not registered in this browser. Enable this browser in ByteX Settings → Browser Integration, then restart the browser.";
  }
  if (normalized.includes("forbidden") || normalized.includes("not allowed")) {
    return "This extension is not authorized by ByteX's native host. Re-enable this browser in ByteX Settings → Browser Integration, then reload the extension.";
  }
  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return "ByteX's native host did not respond. Start or restart ByteX, then retry the download.";
  }
  if (normalized.includes("disconnected") || normalized.includes("exited")) {
    return "ByteX's native host exited before accepting the download. Restart ByteX, then retry.";
  }
  return `ByteX handoff failed: ${message.slice(0, 220)}`;
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
  const referringPage = requestHeaders.referer || referer || null;

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
    referer: referringPage,
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

  // Primary channel: Native Messaging (keeps request credentials off loopback HTTP)
  let nativeErrorMsg = null;
  if (runtimeAPI.runtime.sendNativeMessage) {
    try {
      const result = await sendNativeMessage(NATIVE_HOST_NAME, payload);
      if (result?.accepted === true) {
        return { accepted: true, duplicate: Boolean(result.duplicate), reason: null };
      }
      nativeErrorMsg = result?.reason || result?.error || null;
    } catch (error) {
      nativeErrorMsg = nativeMessagingFailureMessage(error);
    }
  }

  // Fallback channel: HTTP IPC bridge (in case Native Host failed, returned unaccepted, or is unregistered)
  const httpResult = await dispatchViaHttpIpc(payload);
  if (httpResult?.accepted === true) {
    return httpResult;
  }

  return {
    accepted: false,
    reason: nativeErrorMsg || httpResult?.reason || "ByteX desktop application could not accept this download.",
  };
}

const interceptedDownloadIds = new Set();

async function handleDownloadInterception(downloadItem) {
  await interceptSettingsReady;
  if (downloadItem.id && interceptedDownloadIds.has(downloadItem.id)) return false;
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
    await durableOutbox.recordTransition(downloadItem.id, HandoffState.DETECTED, {
      url: downloadItem.finalUrl || downloadItem.url,
      filename: downloadItem.filename,
    });
  }

  await durableOutbox.recordTransition(downloadItem.id, HandoffState.CLASSIFIED);

  // Resolve request metadata before any pause/IPC await. Other downloads can
  // complete while those operations are pending and otherwise steal the
  // newest same-URL capture from this event.
  const requestContext = resolveDownloadRequestContext(downloadItem);
  await durableOutbox.recordTransition(downloadItem.id, HandoffState.CONTEXT_COLLECTED);

  let paused = false;
  let appAccepted = false;
  try {
    // Attempt best-effort pause so the browser doesn't waste bandwidth during handoff.
    // Even if the browser download is still connecting or cannot pause immediately, do NOT abort!
    try {
      const browserState = await pauseBrowserDownload(downloadItem.id);
      if (browserState === "complete") {
        showHandoffFailure(
          downloadItem.filename,
          "This download finished in the browser before ByteX could take over. It was not started again in ByteX.",
        );
        await durableOutbox.markResolved(downloadItem.id, HandoffState.FAILED_FALLBACK_RESUMED, "Finished in browser before takeover");
        return false;
      }
      paused = browserState === "paused";
    } catch (_) {}

    await syncWithDesktopApp();
    if (!shouldInterceptDownload(downloadItem)) {
      if (paused) await resumeBrowserDownload(downloadItem.id);
      await durableOutbox.markResolved(downloadItem.id, HandoffState.FAILED_FALLBACK_RESUMED, "Sync deselected download");
      return false;
    }

    await durableOutbox.recordTransition(downloadItem.id, HandoffState.SUBMITTED);

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
      if (paused) await resumeBrowserDownload(downloadItem.id);
      await durableOutbox.markResolved(downloadItem.id, HandoffState.FAILED_FALLBACK_RESUMED, result?.reason || "Desktop unaccepted");
      return false;
    }

    appAccepted = true;
    await durableOutbox.recordTransition(downloadItem.id, HandoffState.APP_ACCEPTED);

    await durableOutbox.recordTransition(downloadItem.id, HandoffState.BROWSER_CANCEL_REQUESTED);
    const browserStopped = await stopBrowserDownload(downloadItem.id);
    const filename = displayFilename(downloadItem.filename);
    if (browserStopped) {
      await durableOutbox.recordTransition(downloadItem.id, HandoffState.BROWSER_CANCELLED);
    }
    await durableOutbox.markResolved(downloadItem.id, HandoffState.DESKTOP_RUNNING);
    showHandoffIndicator(filename);
    showHandoffInTab(downloadItem.tabId, filename);
    return true;
  } catch (err) {
    if (paused && !appAccepted) await resumeBrowserDownload(downloadItem.id);
    await durableOutbox.markResolved(downloadItem.id, HandoffState.FAILED_FALLBACK_RESUMED, err?.message || String(err));
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

// "Intercept late, not early":
// Use onCreated for handoff so the browser's filename-determination event can complete
// normally. The DownloadItem includes the resolved URL on supported browsers.
if (runtimeAPI.downloads) {
  if (runtimeAPI.downloads.onCreated) {
    runtimeAPI.downloads.onCreated.addListener((downloadItem) => {
      return handleDownloadInterception(downloadItem).catch(() => {});
    });
  }
}

runtimeAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "XDM_MANUAL_CAPTURE") {
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
  }

  if (message?.type === "YOUTUBE_GET_METADATA") {
    (async () => {
      if (runtimeAPI.runtime.sendNativeMessage) {
        try {
          const res = await sendNativeMessage(NATIVE_HOST_NAME, {
            action: "YOUTUBE_FETCH_METADATA",
            payload: {
              url: message.url,
              tab_title: message.tabTitle || sender.tab?.title || "",
            },
          });
          if (res && (res.formats || res.video_id)) return res;
        } catch (_) {}
      }
      try {
        const query = new URLSearchParams({
          url: message.url || "",
          title: message.tabTitle || sender.tab?.title || "",
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

  if (message?.type === "YOUTUBE_START_DOWNLOAD") {
    (async () => {
      if (runtimeAPI.runtime.sendNativeMessage) {
        try {
          const res = await sendNativeMessage(NATIVE_HOST_NAME, {
            action: "YOUTUBE_SUBMIT_JOB",
            payload: message.jobPayload,
          });
          if (res && res.accepted !== undefined) {
            if (res.accepted) showHandoffIndicator(message.jobPayload?.title || "Video Download");
            return res;
          }
        } catch (_) {}
      }
      try {
        const resp = await fetchWithTimeout(`${XDM_IPC_URL}/api/v1/media/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.jobPayload),
        }, 5000);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.accepted) showHandoffIndicator(message.jobPayload?.title || "Video Download");
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
