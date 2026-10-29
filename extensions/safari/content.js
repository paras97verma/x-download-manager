// X Download Manager (XDM) — Safari Content Script
// Intercepts browser download links, download buttons, and streaming media for macOS Safari.

(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  const XDM_IPC_URL = "http://127.0.0.1:45678";
  let bypassKeyPressed = false;

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

  function showXdmCaptureToast(url, filename) {
    try {
      const existing = document.getElementById("xdm-capture-toast");
      if (existing) existing.remove();

      const toast = document.createElement("div");
      toast.id = "xdm-capture-toast";
      const name = filename || url.split("/").pop().split("?")[0] || "Download";

      // Build DOM structure securely without innerHTML to eliminate DOM XSS risk
      const container = document.createElement("div");
      container.style.cssText = "display:flex;align-items:center;gap:8px;";

      const logo = document.createElement("div");
      logo.style.cssText =
        "width:18px;height:18px;border-radius:4px;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;";
      logo.textContent = "X";

      const textCol = document.createElement("div");

      const titleEl = document.createElement("div");
      titleEl.style.cssText = "font-weight:bold;font-size:12px;color:#ffffff;";
      titleEl.textContent = "Captured by X Download Manager";

      const nameEl = document.createElement("div");
      nameEl.style.cssText =
        "font-size:10px;color:#94a3b8;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent = name;

      textCol.appendChild(titleEl);
      textCol.appendChild(nameEl);
      container.appendChild(logo);
      container.appendChild(textCol);
      toast.appendChild(container);

      toast.style.cssText = [
        "position: fixed",
        "bottom: 24px",
        "right: 24px",
        "z-index: 2147483647",
        "background: rgba(15, 23, 42, 0.95)",
        "backdrop-filter: blur(8px)",
        "border: 1px solid rgba(59, 130, 246, 0.5)",
        "border-radius: 12px",
        "padding: 10px 14px",
        "box-shadow: 0 10px 30px rgba(0,0,0,0.6)",
        "font-family: -apple-system, BlinkMacSystemFont, sans-serif",
        "color: #ffffff",
        "transition: all 0.3s ease",
        "pointer-events: none",
        "animation: xdmSlideIn 0.25s ease-out",
      ].join(";");

      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    } catch (_) {}
  }

  function captureDownload(targetUrl, filename, anchor) {
    showXdmCaptureToast(targetUrl, filename);

    const payload = {
      type: "XDM_MANUAL_CAPTURE",
      url: targetUrl,
      filename: filename || null,
      referer: window.location.href,
      cookies: document.cookie || null,
      tabTitle: document.title,
    };

    // 1. Send via Extension Messaging to background script
    let sentToBg = false;
    try {
      runtimeAPI.runtime.sendMessage(payload, (res) => {
        if (!runtimeAPI.runtime.lastError && res && res.success) {
          sentToBg = true;
        } else {
          fallbackDirectIpc(payload);
        }
      });
    } catch (_) {
      fallbackDirectIpc(payload);
    }
  }

  // Direct Localhost IPC fallback in case background script is sleeping
  function fallbackDirectIpc(payload) {
    try {
      fetch(`${XDM_IPC_URL}/api/v1/intercept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: payload.url,
          filename: payload.filename,
          referer: payload.referer,
          cookies: payload.cookies,
          user_agent: navigator.userAgent,
          browser: "Safari",
          tab_title: payload.tabTitle,
        }),
      }).catch(() => {});
    } catch (_) {}
  }

  // 1. Intercept standard <a> link clicks
  document.addEventListener(
    "click",
    (event) => {
      if (event.altKey || bypassKeyPressed) return;

      const anchor = event.target.closest("a");
      if (!anchor || !anchor.href) return;

      if (isDownloadableUrl(anchor.href, anchor)) {
        event.preventDefault();
        event.stopPropagation();
        const downloadFilename = anchor.getAttribute("download") || null;
        captureDownload(anchor.href, downloadFilename, anchor);
      }
    },
    true
  );

  // 2. Intercept programmatic anchor .click() triggers
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!bypassKeyPressed && this.href && isDownloadableUrl(this.href, this)) {
      const downloadFilename = this.getAttribute("download") || null;
      captureDownload(this.href, downloadFilename, this);
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };

  // 3. Intercept window.open calls pointing to downloadable resources
  const originalWindowOpen = window.open;
  window.open = function (url, ...args) {
    if (!bypassKeyPressed && typeof url === "string" && isDownloadableUrl(url, null)) {
      captureDownload(url, null, null);
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
      badge.innerText = "⬇ Download with XDM";
      badge.style.cssText = [
        "position: absolute",
        "top: 10px",
        "right: 10px",
        "z-index: 2147483647",
        "background: linear-gradient(135deg, #2563eb, #4f46e5)",
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
        captureDownload(src, null, null);
        badge.innerText = "✓ Sent to XDM";
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
