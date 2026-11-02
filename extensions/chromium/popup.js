const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("xdm-conn-status");
  const transferStatusEl = document.getElementById("xdm-transfer-status");
  const toggleEl = document.getElementById("xdm-enable-toggle");
  const inputEl = document.getElementById("xdm-quick-url");
  const sendBtn = document.getElementById("xdm-send-btn");
  const bypassKeyEl = document.getElementById("xdm-bypass-key");
  const detectedPlatform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  if (bypassKeyEl) bypassKeyEl.textContent = /mac/i.test(detectedPlatform) ? "Option" : "Alt";

  const renderLastTransfer = (transfer) => {
    if (!transferStatusEl) return;
    if (!transfer) {
      transferStatusEl.textContent = "No recent handoff";
      transferStatusEl.style.color = "#94a3b8";
      return;
    }
    const filename = (transfer.filename || "Download").split(/[\\/]/).pop();
    if (transfer.status === "sent") {
      transferStatusEl.textContent = `Sent to ByteX; check the app for progress: ${filename}`;
      transferStatusEl.style.color = "#10b981";
    } else if (transfer.status === "duplicate") {
      transferStatusEl.textContent = `Already in ByteX: ${filename}`;
      transferStatusEl.style.color = "#10b981";
    } else {
      transferStatusEl.textContent = `Not transferred; browser kept the download: ${filename}`;
      transferStatusEl.style.color = "#f87171";
    }
  };
  runtimeAPI.storage.local.get(["lastTransfer"], (data) => renderLastTransfer(data.lastTransfer));
  runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.lastTransfer) {
      renderLastTransfer(changes.lastTransfer.newValue);
    }
  });

  // Load saved toggle state
  runtimeAPI.storage.local.get(["interceptEnabled"], (res) => {
    toggleEl.checked = res.interceptEnabled !== false;
  });

  toggleEl.addEventListener("change", () => {
    runtimeAPI.storage.local.set({ interceptEnabled: toggleEl.checked });
  });

  // Check Desktop App Bridge status
  try {
    const resp = await fetch("http://127.0.0.1:45678/api/v1/status");
    if (resp.ok) {
      const data = await resp.json();
      statusEl.textContent = `Connected • ByteX v${data.version}`;
      statusEl.style.color = "#10b981";
    } else {
      throw new Error("Offline");
    }
  } catch (_) {
    statusEl.textContent = "Standby (Native Messaging Host Ready)";
    statusEl.style.color = "#f59e0b";
  }

  sendBtn.addEventListener("click", () => {
    const url = inputEl.value.trim();
    if (!url) return;
    runtimeAPI.runtime.sendMessage({
      type: "XDM_MANUAL_CAPTURE",
      url,
      referer: "",
      tabTitle: "Popup Manual Submit",
    });
    inputEl.value = "";
    sendBtn.textContent = "Sent!";
    setTimeout(() => (sendBtn.textContent = "Download"), 1200);
  });
});
