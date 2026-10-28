const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("xdm-conn-status");
  const toggleEl = document.getElementById("xdm-enable-toggle");
  const inputEl = document.getElementById("xdm-quick-url");
  const sendBtn = document.getElementById("xdm-send-btn");

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
      statusEl.textContent = `Connected • XDM v${data.version}`;
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
