// Safari does not expose the downloads API to WebExtensions, so this small
// content script forwards explicit download links to ByteX.
(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let interceptEnabled = true;
  let interceptedExtensions = [
    "ZIP", "RAR", "7Z", "TAR", "GZ", "EXE", "MSI", "DMG", "PKG", "DEB", "RPM",
    "APPIMAGE", "ISO", "MP4", "MKV", "WEBM", "AVI", "MOV", "MP3", "FLAC", "WAV",
    "PDF", "DOCX", "XLSX", "PPTX", "TORRENT",
  ];
  let ignoredDomains = ["localhost", "127.0.0.1"];

  runtimeAPI.storage.local.get(["interceptEnabled", "appInterceptedExtensions", "appIgnoredDomains"], (settings) => {
    interceptEnabled = settings.interceptEnabled !== false;
    if (Array.isArray(settings.appInterceptedExtensions)) interceptedExtensions = settings.appInterceptedExtensions;
    if (Array.isArray(settings.appIgnoredDomains)) ignoredDomains = settings.appIgnoredDomains;
  });
  runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.interceptEnabled) {
      interceptEnabled = changes.interceptEnabled.newValue !== false;
    }
    if (areaName === "local" && changes.appInterceptedExtensions) {
      interceptedExtensions = changes.appInterceptedExtensions.newValue || [];
    }
    if (areaName === "local" && changes.appIgnoredDomains) {
      ignoredDomains = changes.appIgnoredDomains.newValue || [];
    }
  });

  function isDownloadLink(anchor) {
    if (!anchor?.href) return false;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (!["http:", "https:", "ftp:"].includes(url.protocol)) return false;
      if (ignoredDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return false;
      // An explicit download attribute identifies a download even when the
      // URL and supplied filename have no extension.
      if (anchor.hasAttribute("download")) return true;
      const segment = url.pathname.split("/").pop() || "";
      const downloadName = anchor.getAttribute("download") || segment;
      const extension = downloadName.split(/[\\/]/).pop()?.split(".").pop()?.toUpperCase();
      return Boolean(extension && interceptedExtensions.includes(extension));
    } catch (_) {
      return false;
    }
  }

  document.addEventListener("click", (event) => {
    if (!interceptEnabled || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!isDownloadLink(anchor)) return;

    event.preventDefault();
    event.stopPropagation();
    const originalUrl = anchor.href;
    runtimeAPI.runtime.sendMessage({
      type: "XDM_MANUAL_CAPTURE",
      url: originalUrl,
      filename: anchor.getAttribute("download") || null,
      referer: window.location.href,
      cookies: document.cookie || null,
      tabTitle: document.title,
    }, (response) => {
      if (runtimeAPI.runtime.lastError || !response?.success) {
        window.location.assign(originalUrl);
      }
    });
  }, true);
})();
