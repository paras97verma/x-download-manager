// X Download Manager (XDM) — Content Script (Chromium / Firefox / Safari)
// 1. Tracks modifier key (Alt / Option) so users can hold Alt while clicking a link to bypass XDM.
// 2. Detects HTML5 <video> / <audio> streams and displays an IDM-style floating "Download with XDM" button.
// 3. Detects authenticated file-sharing pages (Usersdrive, 1fichier, MediaFire) and offers 1-click XDM acceleration.

(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let bypassKeyPressed = false;

  runtimeAPI.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "XDM_CAPTURE_RESULT") return;
    const toast = document.createElement("div");
    const filename = (message.filename || "Download").split(/[\\/]/).pop();
    toast.textContent = `${message.success ? "✓ Downloading in XDM" : "⚠ XDM could not start; browser download resumed"} · ${filename}`;
    toast.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#111827;color:#fff;padding:12px 16px;border-radius:10px;font:13px sans-serif;box-shadow:0 8px 24px #0008;max-width:420px";
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  });

  window.addEventListener("keydown", (e) => {
    if (e.altKey) {
      bypassKeyPressed = true;
      runtimeAPI.runtime.sendMessage({ type: "XDM_BYPASS_STATE", bypass: true }).catch(() => {});
    }
  });

  window.addEventListener("keyup", (e) => {
    if (!e.altKey && bypassKeyPressed) {
      bypassKeyPressed = false;
      runtimeAPI.runtime.sendMessage({ type: "XDM_BYPASS_STATE", bypass: false }).catch(() => {});
    }
  });

  // IDM-Style Floating Video Download Button
  function attachVideoBadges() {
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      if (video.dataset.xdmAttached) return;
      const src = video.currentSrc || video.src;
      if (!src || src.startsWith("blob:")) return;

      video.dataset.xdmAttached = "true";
      const badge = document.createElement("button");
      badge.innerText = "⬇ Download Video with XDM";
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
        "font-size: 12px",
        "font-weight: 600",
        "cursor: pointer",
        "box-shadow: 0 8px 20px rgba(0,0,0,0.45)",
      ].join(";");

      badge.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runtimeAPI.runtime.sendMessage({
          type: "XDM_MANUAL_CAPTURE",
          url: src,
          referer: window.location.href,
          tabTitle: document.title,
        });
        badge.innerText = "✓ Sent to X Download Manager";
      });

      const parent = video.parentElement;
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
