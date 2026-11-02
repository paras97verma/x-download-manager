// Safari does not expose the downloads API to WebExtensions, so this small
// content script forwards explicit download links to ByteX.
(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let interceptEnabled = true;

  runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
    interceptEnabled = settings.interceptEnabled !== false;
  });
  runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.interceptEnabled) {
      interceptEnabled = changes.interceptEnabled.newValue !== false;
    }
  });

  function isDownloadLink(anchor) {
    if (!anchor?.href) return false;
    if (anchor.hasAttribute("download")) return true;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (!["http:", "https:", "ftp:"].includes(url.protocol)) return false;
      const segment = url.pathname.split("/").pop() || "";
      if (/\.[a-z0-9]{1,16}$/i.test(segment)) return true;
      return /(?:download|attachment|export|dl)=?(?:1|true)?/i.test(url.search);
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
