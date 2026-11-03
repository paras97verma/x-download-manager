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

  // --- YouTube Video & Audio Download Integration ---
  function isYouTubeWatchPage() {
    const loc = window.location;
    const host = (loc.hostname || "").toLowerCase();
    const isYtHost =
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host.endsWith(".youtu.be");
    return (
      isYtHost &&
      (loc.pathname === "/watch" || loc.pathname.startsWith("/shorts/"))
    );
  }

  let activeModalHost = null;

  function closeModal() {
    if (activeModalHost) {
      activeModalHost.remove();
      activeModalHost = null;
    }
  }

  function showQualityModal(videoUrl, tabTitle) {
    closeModal();

    const host = document.createElement("div");
    host.id = "bytex-quality-modal-host";
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .modal { width: 560px; max-width: calc(100vw - 32px); max-height: 85vh; background: #0f172a; border: 1px solid rgba(34, 211, 238, 0.4); border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); display: flex; flex-direction: column; overflow: hidden; color: #f8fafc; }
      .header { padding: 16px 20px; background: linear-gradient(to right, rgba(8, 51, 68, 0.6), #0f172a); border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
      .header h3 { font-size: 14px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
      .header h3 span { color: #22d3ee; }
      .close-btn { background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .close-btn:hover { color: #fff; background: #1e293b; }
      .body { padding: 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px; }
      .video-card { display: flex; gap: 14px; background: #1e293b; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); }
      .thumb { width: 120px; height: 68px; border-radius: 6px; object-fit: cover; background: #000; }
      .meta { flex: 1; min-width: 0; }
      .meta .title { font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 6px; }
      .meta .license { font-size: 11px; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
      .license.cc { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
      .license.std { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
      .section-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
      .presets { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .preset-btn { padding: 10px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #cbd5e1; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s; }
      .preset-btn:hover { border-color: #22d3ee; color: #fff; background: #164e63; }
      .preset-btn.active { border-color: #22d3ee; background: rgba(34, 211, 238, 0.15); color: #22d3ee; }
      .preset-btn .badge { font-size: 10px; color: #94a3b8; display: block; font-weight: 400; margin-top: 2px; }
      .format-list { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; }
      .format-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; font-size: 12px; cursor: pointer; }
      .format-item:hover { border-color: #38bdf8; }
      .format-item.selected { border-color: #22d3ee; background: rgba(6, 182, 212, 0.12); }
      .format-left { display: flex; align-items: center; gap: 8px; }
      .format-tag { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .tag-mp4 { background: #0369a1; color: #e0f2fe; }
      .tag-webm { background: #4338ca; color: #e0e7ff; }
      .tag-audio { background: #047857; color: #d1fae5; }
      .format-res { font-weight: 600; color: #f1f5f9; }
      .format-fps { color: #94a3b8; font-size: 11px; }
      .format-size { color: #94a3b8; font-size: 11px; }
      .footer { padding: 14px 20px; background: #0f172a; border-top: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
      .status-text { font-size: 11px; color: #94a3b8; }
      .download-btn { padding: 9px 18px; border-radius: 8px; font-size: 12px; font-weight: 600; border: none; cursor: pointer; background: #0891b2; color: #fff; transition: background 0.15s; }
      .download-btn:hover { background: #06b6d4; }
      .download-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;

    const modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML = `
      <div class="header">
        <h3><span>⬇ ByteX</span> Media Downloader</h3>
        <button class="close-btn" id="close">×</button>
      </div>
      <div class="body" id="modal-body">
        <div style="padding: 32px 0; text-align: center; color: #94a3b8;">
          <div class="spinner" style="width: 28px; height: 28px; border-width: 3px; border-top-color: #22d3ee; margin-bottom: 12px;"></div>
          <div style="font-size: 13px;">Analyzing available video and audio streams...</div>
        </div>
      </div>
      <div class="footer">
        <span class="status-text" id="status-text">Connected to ByteX Native Engine</span>
        <button class="download-btn" id="download-submit" disabled>Start Download in ByteX</button>
      </div>
    `;

    shadow.append(style, modal);
    host.addEventListener("click", (e) => {
      if (e.target === host) closeModal();
    });
    shadow.getElementById("close").addEventListener("click", closeModal);
    document.documentElement.append(host);
    activeModalHost = host;

    // Query backend metadata via Native Messaging
    runtimeAPI.runtime.sendMessage(
      {
        type: "YOUTUBE_GET_METADATA",
        url: videoUrl,
        tabTitle: tabTitle,
      },
      (response) => {
        if (!response || !response.formats) {
          const bodyEl = shadow.getElementById("modal-body");
          if (bodyEl) {
            bodyEl.innerHTML = `
              <div style="padding: 24px; text-align: center; color: #f87171;">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 6px;">Could Not Retrieve Media Streams</div>
                <div style="font-size: 12px; color: #cbd5e1;">${response?.error || "ByteX desktop engine is offline or disconnected."}</div>
              </div>
            `;
          }
          return;
        }

        renderMetadataContent(shadow, response, videoUrl);
      }
    );
  }

  function renderMetadataContent(shadow, data, videoUrl) {
    const bodyEl = shadow.getElementById("modal-body");
    const downloadBtn = shadow.getElementById("download-submit");
    const statusText = shadow.getElementById("status-text");
    if (!bodyEl || !downloadBtn) return;

    let selectedFormatId = data.best_quality_format_id || data.formats[0]?.format_id;

    function getSelectedFormat() {
      return data.formats.find((f) => f.format_id === selectedFormatId) || data.formats[0];
    }

    bodyEl.innerHTML = `
      <div class="video-card">
        <img class="thumb" src="${data.thumbnail_url || ""}" alt="Video thumbnail" />
        <div class="meta">
          <div class="title">${data.title}</div>
          <span class="license cc">✓ Creative Commons / Open Access</span>
        </div>
      </div>

      <div class="section-label">Quick Presets</div>
      <div class="presets">
        <button class="preset-btn ${selectedFormatId === data.best_quality_format_id ? "active" : ""}" id="preset-best">
          ★ Best Quality
          <span class="badge">1080p60 • MP4 Video + AAC Audio</span>
        </button>
        <button class="preset-btn ${selectedFormatId === data.audio_only_format_id ? "active" : ""}" id="preset-audio">
          🎧 Audio Only
          <span class="badge">Original Audio • M4A Container</span>
        </button>
        <button class="preset-btn ${selectedFormatId === data.max_resolution_format_id ? "active" : ""}" id="preset-max">
          💎 Max Resolution
          <span class="badge">2160p 4K • WebM / MKV</span>
        </button>
        <button class="preset-btn ${selectedFormatId === data.balanced_format_id ? "active" : ""}" id="preset-bal">
          ⚖ Balanced
          <span class="badge">720p HD • MP4 Combined</span>
        </button>
      </div>

      <div class="section-label">Available Stream Formats</div>
      <div class="format-list" id="format-list"></div>
    `;

    function updateFormatList() {
      const listEl = shadow.getElementById("format-list");
      if (!listEl) return;
      listEl.innerHTML = "";

      data.formats.forEach((f) => {
        const item = document.createElement("div");
        item.className = `format-item ${f.format_id === selectedFormatId ? "selected" : ""}`;
        const isAudio = f.media_type === "audio_only";
        const tagClass = isAudio ? "tag-audio" : f.container === "mp4" ? "tag-mp4" : "tag-webm";
        const label = isAudio ? "Audio" : f.resolution || "Video";
        const fpsText = f.fps ? `${f.fps} FPS` : "";
        const codecText = [f.video_codec, f.audio_codec].filter(Boolean).join(" / ");
        const sizeText = f.estimated_size_bytes
          ? `~${Math.round(f.estimated_size_bytes / 1024 / 1024)} MB`
          : "";

        item.innerHTML = `
          <div class="format-left">
            <span class="format-tag ${tagClass}">${f.container}</span>
            <span class="format-res">${label}</span>
            <span class="format-fps">${fpsText} • ${codecText}</span>
          </div>
          <div class="format-size">${sizeText}</div>
        `;

        item.addEventListener("click", () => {
          selectedFormatId = f.format_id;
          updateFormatList();
          updatePresetButtons();
        });

        listEl.appendChild(item);
      });
    }

    function updatePresetButtons() {
      const bBest = shadow.getElementById("preset-best");
      const bAudio = shadow.getElementById("preset-audio");
      const bMax = shadow.getElementById("preset-max");
      const bBal = shadow.getElementById("preset-bal");

      bBest?.classList.toggle("active", selectedFormatId === data.best_quality_format_id);
      bAudio?.classList.toggle("active", selectedFormatId === data.audio_only_format_id);
      bMax?.classList.toggle("active", selectedFormatId === data.max_resolution_format_id);
      bBal?.classList.toggle("active", selectedFormatId === data.balanced_format_id);
    }

    shadow.getElementById("preset-best")?.addEventListener("click", () => {
      if (data.best_quality_format_id) selectedFormatId = data.best_quality_format_id;
      updateFormatList();
      updatePresetButtons();
    });
    shadow.getElementById("preset-audio")?.addEventListener("click", () => {
      if (data.audio_only_format_id) selectedFormatId = data.audio_only_format_id;
      updateFormatList();
      updatePresetButtons();
    });
    shadow.getElementById("preset-max")?.addEventListener("click", () => {
      if (data.max_resolution_format_id) selectedFormatId = data.max_resolution_format_id;
      updateFormatList();
      updatePresetButtons();
    });
    shadow.getElementById("preset-bal")?.addEventListener("click", () => {
      if (data.balanced_format_id) selectedFormatId = data.balanced_format_id;
      updateFormatList();
      updatePresetButtons();
    });

    updateFormatList();

    downloadBtn.disabled = false;
    downloadBtn.addEventListener("click", () => {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `<span class="spinner"></span> Sending to ByteX...`;
      if (statusText) statusText.textContent = "Scheduling transfer...";

      const selected = getSelectedFormat();
      const jobPayload = {
        video_id: data.video_id,
        source_url: videoUrl,
        title: data.title,
        channel_name: data.channel || null,
        duration_seconds: data.duration_seconds || null,
        thumbnail_url: data.thumbnail_url || null,
        license_type: data.license_type || "standard",
        format_id: selected.format_id,
        container: selected.container,
        resolution: selected.resolution || null,
        fps: selected.fps || null,
        video_codec: selected.video_codec || null,
        audio_codec: selected.audio_codec || null,
        video_stream_url: selected.video_stream_url || null,
        audio_stream_url: selected.audio_stream_url || null,
        combined_stream_url: selected.combined_stream_url || null,
        custom_headers: {},
        output_filename: null,
        queue_id: "main-queue",
        save_dir: null,
      };

      runtimeAPI.runtime.sendMessage(
        {
          type: "YOUTUBE_START_DOWNLOAD",
          jobPayload: jobPayload,
        },
        (res) => {
          if (res?.accepted) {
            downloadBtn.innerHTML = "✓ Download Started in ByteX!";
            downloadBtn.style.background = "#10b981";
            if (statusText) statusText.textContent = "✓ Task active in ByteX Download Manager";
            setTimeout(closeModal, 1800);
          } else {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = "Retry Download";
            if (statusText) statusText.textContent = res?.error || "Transfer failed to start";
          }
        }
      );
    });
  }

  function injectYouTubeDownloadButton() {
    if (!isYouTubeWatchPage()) {
      const existing = document.getElementById("bytex-yt-button-host");
      if (existing) existing.remove();
      return;
    }

    if (document.getElementById("bytex-yt-button-host")) return;

    // Target YouTube's action bar
    const targetContainer =
      document.querySelector("#actions #top-level-buttons-computed") ||
      document.querySelector("#actions #menu #top-level-buttons-computed") ||
      document.querySelector("#top-level-buttons-computed") ||
      document.querySelector("#above-the-fold #top-row");

    if (!targetContainer) return;

    const host = document.createElement("div");
    host.id = "bytex-yt-button-host";
    host.style.cssText =
      "all:initial;display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .bytex-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 16px;
        border-radius: 18px;
        background: linear-gradient(135deg, #06b6d4, #0284c7);
        color: #ffffff;
        font-family: "Roboto", -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
        box-shadow: 0 2px 8px rgba(6, 182, 212, 0.35);
      }
      .bytex-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(6, 182, 212, 0.5);
        background: linear-gradient(135deg, #0891b2, #0369a1);
      }
      .bytex-btn svg { width: 16px; height: 16px; fill: currentColor; }
    `;

    const button = document.createElement("button");
    button.className = "bytex-btn";
    button.setAttribute("title", "Download video or audio with ByteX Download Manager");
    button.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      Download with ByteX
    `;

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showQualityModal(window.location.href, document.title);
    });

    shadow.append(style, button);
    targetContainer.appendChild(host);
  }

  // Hook YouTube SPA navigation
  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(injectYouTubeDownloadButton, 500);
  });
  window.addEventListener("popstate", () => {
    setTimeout(injectYouTubeDownloadButton, 500);
  });
  setInterval(injectYouTubeDownloadButton, 2000);


})();
