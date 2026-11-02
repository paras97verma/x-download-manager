// ByteX Download Manager (XDM) — Content Script (Chromium / Firefox / Safari)
// 1. Tracks modifier key (Alt / Option) so users can hold Alt while clicking a link to bypass XDM.
// 2. Detects HTML5 <video> / <audio> streams and displays an IDM-style floating "Download with ByteX" button.
// 3. Detects authenticated file-sharing pages (Usersdrive, 1fichier, MediaFire) and offers 1-click XDM acceleration.

(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let bypassKeyPressed = false;

  runtimeAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "XDM_CAPTURE_RESULT") return;
    showCaptureToast(message);
    sendResponse?.({ received: true });
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
      badge.innerText = "⬇ Download Video with ByteX";
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
        badge.innerText = "✓ Sent to ByteX";
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

  function showCaptureToast(message) {
    const root = document.documentElement || document.body;
    if (!root) return false;

    document.getElementById("bytex-capture-toast")?.remove();
    const host = document.createElement("div");
    host.id = "bytex-capture-toast";
    host.style.cssText = "all:initial;display:block;position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "closed" });
    const toast = document.createElement("div");
    const filename = (message.filename || "Download").split(/[\\/]/).pop();
    const status = message.duplicate
      ? "Already added to ByteX"
      : message.success
      ? "Download started with ByteX"
      : "ByteX could not start; browser download continues";
    toast.textContent = `${message.success ? "✓" : "⚠"} ${status} · ${filename}`;
    toast.style.cssText = "box-sizing:border-box;background:#102038;color:#f7fbff;border:1px solid #45d9cf;border-radius:10px;padding:12px 16px;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px #0008;max-width:min(420px,calc(100vw - 40px));overflow-wrap:anywhere;animation:bytex-toast-in .18s ease-out";
    const style = document.createElement("style");
    style.textContent = "@keyframes bytex-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}";
    shadow.append(style, toast);
    root.appendChild(host);
    setTimeout(() => host.remove(), 5000);
    return true;
  }
})();
