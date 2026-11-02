// ByteX Download Manager (XDM) — Safari Content Script
// Intercepts browser download links, download buttons, and streaming media for macOS Safari.

(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let bypassKeyPressed = false;
  let interceptEnabled = true;

  runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
    interceptEnabled = settings.interceptEnabled !== false;
  });
  runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.interceptEnabled) {
      interceptEnabled = changes.interceptEnabled.newValue !== false;
    }
  });

  // Track Alt / Option key to allow users to bypass XDM when desired
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey) {
        bypassKeyPressed = true;
        try {
          runtimeAPI.runtime
            .sendMessage({ type: "XDM_BYPASS_STATE", bypass: true })
            .catch(() => {});
        } catch (_) {}
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (!e.altKey && bypassKeyPressed) {
        bypassKeyPressed = false;
        try {
          runtimeAPI.runtime
            .sendMessage({ type: "XDM_BYPASS_STATE", bypass: false })
            .catch(() => {});
        } catch (_) {}
      }
    },
    true
  );

  const INTERCEPTED_EXTENSIONS = new Set([
    // Compressed Archives
    "ZIP", "RAR", "7Z", "TAR", "GZ", "XZ", "BZ2", "TGZ", "TBZ2", "Z",
    // Installers & System Executables
    "EXE", "MSI", "DMG", "PKG", "DEB", "RPM", "APPIMAGE", "ISO", "BIN", "IMG",
    // Documents
    "PDF", "DOC", "DOCX", "XLS", "XLSX", "PPT", "PPTX", "CSV", "EPUB",
    // Video Formats
    "MP4", "MKV", "WEBM", "AVI", "MOV", "FLV", "WMV", "M4V", "3GP", "TS", "M2TS",
    // Audio Formats
    "MP3", "FLAC", "WAV", "AAC", "OGG", "M4A", "WMA", "OPUS",
    // Torrents, Packages & Mobile Apps
    "TORRENT", "APK", "IPA", "CRX", "XPI"
  ]);

  function matchesDomainOrSubdomain(hostname, domain) {
    if (!hostname || !domain) return false;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function isDownloadableUrl(url, anchor) {
    if (!url || typeof url !== "string") return false;
    const cleanUrl = url.trim();

    // Check scheme safely against non-http schemes
    if (
      cleanUrl.startsWith("blob:") ||
      cleanUrl.startsWith("data:") ||
      cleanUrl.startsWith("javascript:") ||
      cleanUrl.startsWith("vbscript:") ||
      cleanUrl.startsWith("#") ||
      cleanUrl.startsWith("mailto:")
    ) {
      return false;
    }

    // 1. Explicit HTML5 download attribute
    if (anchor && anchor.hasAttribute("download")) {
      return true;
    }

    try {
      const parsed = new URL(cleanUrl, window.location.href);

      // Verify protocol is HTTP, HTTPS, or FTP
      const proto = parsed.protocol.toLowerCase();
      if (proto !== "http:" && proto !== "https:" && proto !== "ftp:") {
        return false;
      }

      const pathname = parsed.pathname.toUpperCase();
      const lastDot = pathname.lastIndexOf(".");
      if (lastDot !== -1) {
        const ext = pathname.substring(lastDot + 1);
        if (INTERCEPTED_EXTENSIONS.has(ext)) {
          return true;
        }
      }

      // 2. Query parameters indicating an attachment download
      const search = parsed.search.toLowerCase();
      if (
        search.includes("response-content-disposition=attachment") ||
        search.includes("action=download") ||
        search.includes("export=download") ||
        search.includes("dl=1")
      ) {
        return true;
      }

      // 3. Known file-sharing / release download endpoints with exact domain or subdomain verification
      const host = parsed.hostname.toLowerCase();
      if (
        (matchesDomainOrSubdomain(host, "github.com") && pathname.includes("/RELEASES/DOWNLOAD/")) ||
        (matchesDomainOrSubdomain(host, "usersdrive.com") && pathname.includes("/D/")) ||
        (matchesDomainOrSubdomain(host, "mediafire.com") && pathname.includes("/FILE/")) ||
        (matchesDomainOrSubdomain(host, "1fichier.com") && !pathname.endsWith(".HTML") && !pathname.endsWith(".HTM"))
      ) {
        return true;
      }
    } catch (_) {
      return false;
    }

    return false;
  }

  function captureDownload(targetUrl, filename, anchor, fallback, onResult) {
    const payload = {
      type: "XDM_MANUAL_CAPTURE",
      url: targetUrl,
      filename: filename || null,
      referer: window.location.href,
      cookies: document.cookie || null,
      tabTitle: document.title,
    };

    try {
      runtimeAPI.runtime.sendMessage(payload, (response) => {
        if (runtimeAPI.runtime.lastError || !response?.success) {
          if (fallback) fallback();
        } else if (onResult) {
          onResult(response);
        }
      });
    } catch (_) {
      if (fallback) fallback();
    }
  }

  // 1. Intercept standard <a> link clicks
  document.addEventListener(
    "click",
    (event) => {
      if (event.altKey || bypassKeyPressed) return;

      const anchor = event.target.closest("a");
      if (!anchor || !anchor.href) return;
      if (!interceptEnabled) return;

      if (isDownloadableUrl(anchor.href, anchor)) {
        event.preventDefault();
        event.stopPropagation();
        const downloadFilename = anchor.getAttribute("download") || null;
        captureDownload(anchor.href, downloadFilename, anchor, () => window.location.assign(anchor.href));
      }
    },
    true
  );

  // 2. Intercept programmatic anchor .click() triggers
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!interceptEnabled) return originalAnchorClick.apply(this, arguments);
    if (!bypassKeyPressed && this.href && isDownloadableUrl(this.href, this)) {
      const downloadFilename = this.getAttribute("download") || null;
      const anchor = this;
      captureDownload(anchor.href, downloadFilename, anchor, () => originalAnchorClick.call(anchor));
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };

  // 3. Intercept window.open calls pointing to downloadable resources
  const originalWindowOpen = window.open;
  window.open = function (url, ...args) {
    if (!interceptEnabled) return originalWindowOpen.call(this, url, ...args);
    if (!bypassKeyPressed && typeof url === "string" && isDownloadableUrl(url, null)) {
      captureDownload(url, null, null, () => originalWindowOpen.call(window, url, ...args));
      return null;
    }
    return originalWindowOpen.call(this, url, ...args);
  };

  // 4. Floating badge on HTML5 <video> / <audio>
  function attachVideoBadges() {
    const mediaElements = document.querySelectorAll("video, audio");
    mediaElements.forEach((media) => {
      if (media.dataset.xdmAttached) return;
      const src = media.currentSrc || media.src;
      if (!src || src.startsWith("blob:") || src.startsWith("data:")) return;

      media.dataset.xdmAttached = "true";
      const badge = document.createElement("button");
      badge.innerText = "⬇ Download with ByteX";
      badge.style.cssText = [
        "position: absolute",
        "top: 10px",
        "right: 10px",
        "z-index: 2147483647",
        "background: linear-gradient(135deg, #17b8ad, #5147d9)",
        "color: #ffffff",
        "border: 1px solid rgba(255,255,255,0.25)",
        "border-radius: 8px",
        "padding: 6px 12px",
        "font-family: -apple-system, BlinkMacSystemFont, sans-serif",
        "font-size: 11px",
        "font-weight: 600",
        "cursor: pointer",
        "box-shadow: 0 8px 20px rgba(0,0,0,0.45)",
      ].join(";");

      badge.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!interceptEnabled) {
          badge.innerText = "Enable ByteX interception";
          return;
        }
        badge.innerText = "Sending to ByteX…";
        captureDownload(src, null, null, () => {
          badge.innerText = "ByteX handoff failed";
        }, (response) => {
          badge.innerText = response.duplicate ? "✓ Already in ByteX" : "✓ Sent to ByteX";
        });
        // The page control is only an immediate acknowledgement. The extension
        // toolbar badge and popup show the confirmed handoff result.
      });

      const parent = media.parentElement;
      if (parent) {
        if (getComputedStyle(parent).position === "static") {
          parent.style.position = "relative";
        }
        parent.appendChild(badge);
      }
    });
  }

  setInterval(attachVideoBadges, 2500);
})();
