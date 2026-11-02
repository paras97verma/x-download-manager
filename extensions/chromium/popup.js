const runtimeAPI = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("xdm-conn-status");
  const toggleEl = document.getElementById("xdm-enable-toggle");
  const handoffEl = document.getElementById("xdm-last-handoff");

  const renderLastHandoff = (handoff) => {
    if (!handoff?.filename || !handoffEl) return;
    handoffEl.hidden = false;
    handoffEl.textContent = `Intercepted by ByteX: ${handoff.filename}`;
  };
  runtimeAPI.storage.local.get(["lastHandoff"], (settings) => renderLastHandoff(settings.lastHandoff));
  runtimeAPI.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.lastHandoff) renderLastHandoff(changes.lastHandoff.newValue);
  });

  runtimeAPI.storage.local.get(["interceptEnabled"], (settings) => {
    toggleEl.checked = settings.interceptEnabled !== false;
  });
  toggleEl.addEventListener("change", () => {
    runtimeAPI.storage.local.set({ interceptEnabled: toggleEl.checked });
  });

  fetch("http://127.0.0.1:45678/api/v1/status")
    .then((response) => {
      if (!response.ok) throw new Error("Desktop app unavailable");
      return response.json();
    })
    .then((data) => {
      statusEl.textContent = data.intercept_enabled
        ? `Connected • ByteX v${data.version}`
        : "Enable browser integration in ByteX settings";
      statusEl.style.color = data.intercept_enabled ? "#10b981" : "#f59e0b";
    })
    .catch(() => {
      statusEl.textContent = "ByteX desktop app is not running";
      statusEl.style.color = "#f59e0b";
    });
});
