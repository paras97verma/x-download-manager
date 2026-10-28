// X Download Manager (XDM) — Background Service Worker / WebExtension Script
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
    const res = await fetch(`${XDM_IPC_URL}/api/v1/status`);
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
    runtimeAPI.contextMenus.create({
      id: "xdm-download-link",
      title: "Download with X Download Manager",
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
runtimeAPI.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "XDM_BYPASS_STATE") {
    state.bypassActive = Boolean(msg.bypass);
  } else if (msg.type === "XDM_MANUAL_CAPTURE") {
    dispatchToXdm({
      url: msg.url,
      referer: msg.referer || (sender.tab ? sender.tab.url : ""),
      tabTitle: msg.tabTitle || (sender.tab ? sender.tab.title : ""),
    });
  }
});

function shouldInterceptDownload(downloadItem) {
  if (!state.interceptEnabled || state.bypassActive) return false;
  const url = downloadItem.finalUrl || downloadItem.url || "";
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;

  try {
    const parsed = new URL(url);
    if (state.ignoredDomains.some((d) => parsed.hostname.endsWith(d))) {
      return false;
    }
    // Intercept all file downloads (documents, archives, software, media, data, code, etc.)
    return true;
  } catch (_) {
    return false;
  }
}

async function getCookieHeaderForUrl(url) {
  if (!runtimeAPI.cookies) return "";
  try {
    const cookies = await runtimeAPI.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch (_) {
    return "";
  }
}

async function dispatchToXdm({ url, filename, fileSize, mimeType, referer, tabTitle }) {
  const cookies = await getCookieHeaderForUrl(url);
  const payload = {
    url,
    filename: filename || null,
    file_size: fileSize || null,
    mime_type: mimeType || null,
    referer: referer || null,
    cookies: cookies || null,
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
      return true;
    }
  } catch (_) {
    // Fallback to Native Messaging
  }

  // 2. Fallback to Native Messaging Host (`com.peivee.xdm`) which launches XDM if closed
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

// Intercept browser downloads automatically
if (runtimeAPI.downloads && runtimeAPI.downloads.onCreated) {
  runtimeAPI.downloads.onCreated.addListener(async (downloadItem) => {
    if (!shouldInterceptDownload(downloadItem)) return;

    const url = downloadItem.finalUrl || downloadItem.url;
    const accepted = await dispatchToXdm({
      url,
      filename: downloadItem.filename || null,
      fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : null,
      mimeType: downloadItem.mime || null,
      referer: downloadItem.referrer || null,
    });

    if (accepted) {
      try {
        runtimeAPI.downloads.cancel(downloadItem.id);
        if (runtimeAPI.downloads.erase) {
          runtimeAPI.downloads.erase({ id: downloadItem.id });
        }
      } catch (_) {}
    }
  });
}

function detectBrowserFamily() {
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("OPR/")) return "Opera";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
  return "Chrome";
}
