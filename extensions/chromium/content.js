// ByteX Download Manager (XDM) — Content Script (Chromium / Firefox / Safari)
// 1. Tracks modifier key (Alt / Option) so users can hold Alt while clicking a link to bypass XDM.
// 2. Detects HTML5 <video> / <audio> streams and displays an IDM-style floating "Download with ByteX" button.
// 3. Detects authenticated file-sharing pages (Usersdrive, 1fichier, MediaFire) and offers 1-click XDM acceleration.

(function () {
  const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;
  let bypassKeyPressed = false;

  runtimeAPI.runtime.onMessage.addListener((message) => {
    if (message?.type !== "XDM_HANDOFF_CONFIRMED") return false;
    const host = document.createElement("div");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "all:initial;position:fixed;inset:16px 16px auto auto;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .toast { font: 600 13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif; color:#f8fafc;
        background:#111827; border:1px solid #22d3ee; border-radius:10px; padding:12px 16px;
        box-shadow:0 12px 32px #0008; max-width:min(380px,calc(100vw - 32px)); }
      .title { color:#67e8f9; margin-bottom:3px; }
    `;
    const toast = document.createElement("div");
    toast.className = "toast";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Download intercepted by ByteX";
    const detail = document.createElement("div");
    detail.textContent = `${message.filename || "Download"} is downloading in ByteX.`;
    toast.append(title, detail);
    shadow.append(style, toast);
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 7000);
    return false;
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
        badge.innerText = "Sending to ByteX…";
        runtimeAPI.runtime.sendMessage({
          type: "XDM_MANUAL_CAPTURE",
          url: src,
          referer: window.location.href,
          tabTitle: document.title,
        }, (response) => {
          badge.innerText = runtimeAPI.runtime.lastError || !response?.success
            ? "ByteX handoff failed"
            : response.duplicate ? "✓ Already in ByteX" : "✓ Sent to ByteX";
        });
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
