// ByteX Download Manager — Durable Outbox & Handoff State Machine (OBJECTIVE.md §20A.5 & §20A.6)
// Guarantees handoff states survive service worker termination, extension reloads, and browser restarts.

const HandoffState = Object.freeze({
  DETECTED: "DETECTED",
  CLASSIFIED: "CLASSIFIED",
  CONTEXT_COLLECTED: "CONTEXT_COLLECTED",
  BRIDGE_CONNECTING: "BRIDGE_CONNECTING",
  SUBMITTED: "SUBMITTED",
  APP_VALIDATING: "APP_VALIDATING",
  APP_ACCEPTED: "APP_ACCEPTED",
  REPLACEMENT_READY: "REPLACEMENT_READY",
  BROWSER_CANCEL_REQUESTED: "BROWSER_CANCEL_REQUESTED",
  BROWSER_CANCELLED: "BROWSER_CANCELLED",
  DESKTOP_RUNNING: "DESKTOP_RUNNING",
  FAILED_FALLBACK_RESUMED: "FAILED_FALLBACK_RESUMED",
});

class DurableOutbox {
  constructor(storageApi) {
    this.storage = storageApi;
    this.memoryCache = new Map();
    this.STORAGE_KEY = "bytex_durable_outbox";
  }

  async recordTransition(downloadId, state, metadata = {}, error = null) {
    const now = Date.now();
    const existing = this.memoryCache.get(downloadId) || {
      handoffId: `bx-${now}-${Math.random().toString(36).slice(2, 9)}`,
      browserDownloadId: downloadId,
      createdAt: now,
      history: [],
    };

    const entry = {
      ...existing,
      state,
      url: metadata.url || existing.url || null,
      filename: metadata.filename || existing.filename || null,
      updatedAt: now,
      error: error ? String(error) : existing.error || null,
      history: [
        ...(existing.history || []),
        { state, timestamp: now, note: metadata.note || null },
      ].slice(-15),
    };

    this.memoryCache.set(downloadId, entry);

    try {
      if (this.storage?.set) {
        const outboxObj = {};
        for (const [k, v] of this.memoryCache.entries()) {
          outboxObj[k] = v;
        }
        await this.storage.set({ [this.STORAGE_KEY]: outboxObj });
      }
    } catch (_) {}

    return entry;
  }

  async markResolved(downloadId, finalState, error = null) {
    return this.recordTransition(downloadId, finalState, { resolved: true }, error);
  }

  getEntry(downloadId) {
    return this.memoryCache.get(downloadId) || null;
  }

  getAllEntries() {
    return Array.from(this.memoryCache.values());
  }

  async loadFromStorage() {
    if (!this.storage?.get) return;
    try {
      return new Promise((resolve) => {
        this.storage.get([this.STORAGE_KEY], (res) => {
          const stored = res?.[this.STORAGE_KEY];
          if (stored && typeof stored === "object") {
            for (const [k, v] of Object.entries(stored)) {
              this.memoryCache.set(Number(k) || k, v);
            }
          }
          resolve();
        });
      });
    } catch (_) {}
  }

  async reconcileOnStartup(downloadsApi) {
    await this.loadFromStorage();
    if (!downloadsApi?.search) return;

    for (const [downloadId, entry] of this.memoryCache.entries()) {
      if ([HandoffState.DESKTOP_RUNNING, HandoffState.FAILED_FALLBACK_RESUMED].includes(entry.state)) {
        continue;
      }
      try {
        const matches = await downloadsApi.search({ id: Number(downloadId) || downloadId });
        if (!matches || matches.length === 0) {
          // Browser was restarted and download record no longer exists
          await this.markResolved(downloadId, HandoffState.BROWSER_CANCELLED, "Cleaned up orphaned handoff on browser restart");
        }
      } catch (_) {}
    }
  }
}

// Authentication Recovery Coordinator (OBJECTIVE.md §20A.11)
class AuthRecoveryCoordinator {
  constructor(runtimeApi) {
    this.runtime = runtimeApi;
  }

  async handleAuthChallenge(challenge) {
    const url = challenge?.url || challenge?.loginUrl;
    if (!url) return;
    try {
      if (this.runtime?.tabs?.create) {
        await this.runtime.tabs.create({ url, active: true });
      }
      if (this.runtime?.notifications?.create) {
        await this.runtime.notifications.create(`bytex-auth-${Date.now()}`, {
          type: "basic",
          iconUrl: this.runtime.runtime?.getURL?.("icons/128x128.png") || "",
          title: "ByteX Authentication Required",
          message: `Please log in to ${challenge?.host || "the download source"} to refresh your download session.`,
        });
      }
    } catch (_) {}
  }
}

if (typeof globalThis !== "undefined") {
  const runtimeAPI = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  const storageApi = runtimeAPI?.storage?.local;
  globalThis.ByteXHandoffState = HandoffState;
  globalThis.ByteXDurableOutbox = new DurableOutbox(storageApi);
  globalThis.ByteXAuthRecovery = new AuthRecoveryCoordinator(runtimeAPI);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { HandoffState, DurableOutbox, AuthRecoveryCoordinator };
}
