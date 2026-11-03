const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function makeOutbox(storage) {
  const sandbox = {
    chrome: { storage: { local: storage } },
    browser: { storage: { local: storage } },
    Date,
    Math,
    Object,
    Array,
    Map,
    Promise,
    String,
    Number,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(root, "extensions", "chromium", "durable-outbox.js"), "utf8");
  vm.runInContext(source, context);
  return {
    HandoffState: context.ByteXHandoffState,
    DurableOutbox: context.ByteXDurableOutbox,
    coordinator: context.ByteXAuthRecovery,
    context,
  };
}

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    get: (keys, callback) => {
      const res = {};
      for (const k of keys) {
        if (store[k] !== undefined) res[k] = store[k];
      }
      callback(res);
    },
    set: (obj) => {
      Object.assign(store, obj);
      return Promise.resolve();
    },
    raw: store,
  };
}

test("outbox tracks formal handoff state transitions and history", async () => {
  const mockStorage = createMockStorage();
  const { HandoffState, DurableOutbox } = makeOutbox(mockStorage);

  const downloadId = 101;
  await DurableOutbox.recordTransition(downloadId, HandoffState.DETECTED, {
    url: "https://mirror.org/linux.iso",
    filename: "linux.iso",
  });
  await DurableOutbox.recordTransition(downloadId, HandoffState.CLASSIFIED);
  await DurableOutbox.recordTransition(downloadId, HandoffState.CONTEXT_COLLECTED);
  await DurableOutbox.recordTransition(downloadId, HandoffState.SUBMITTED);
  await DurableOutbox.recordTransition(downloadId, HandoffState.APP_ACCEPTED);
  await DurableOutbox.recordTransition(downloadId, HandoffState.BROWSER_CANCEL_REQUESTED);
  await DurableOutbox.recordTransition(downloadId, HandoffState.BROWSER_CANCELLED);
  const finalEntry = await DurableOutbox.markResolved(downloadId, HandoffState.DESKTOP_RUNNING);

  assert.equal(finalEntry.state, HandoffState.DESKTOP_RUNNING);
  assert.equal(finalEntry.filename, "linux.iso");
  assert.equal(finalEntry.url, "https://mirror.org/linux.iso");
  assert.equal(finalEntry.history.length, 8);
  assert.equal(finalEntry.history[0].state, HandoffState.DETECTED);
  assert.equal(finalEntry.history[7].state, HandoffState.DESKTOP_RUNNING);

  // Verify persistence to storage
  const persistedOutbox = mockStorage.raw.bytex_durable_outbox;
  assert.ok(persistedOutbox);
  assert.ok(persistedOutbox[downloadId]);
  assert.equal(persistedOutbox[downloadId].state, HandoffState.DESKTOP_RUNNING);
});

test("outbox restores entries after service worker restart", async () => {
  const mockStorage = createMockStorage();
  const { HandoffState, DurableOutbox: outbox1 } = makeOutbox(mockStorage);
  await outbox1.recordTransition(202, HandoffState.SUBMITTED, {
    url: "https://example.com/archive.tar.gz",
    filename: "archive.tar.gz",
  });

  // Simulate new service worker instance reading from storage
  const { DurableOutbox: outbox2 } = makeOutbox(mockStorage);
  await outbox2.loadFromStorage();

  const restored = outbox2.getEntry(202);
  assert.ok(restored, "Entry should be restored from storage");
  assert.equal(restored.state, HandoffState.SUBMITTED);
  assert.equal(restored.filename, "archive.tar.gz");
});

test("outbox startup reconciler cleans up stale browser downloads after restart", async () => {
  const mockStorage = createMockStorage();
  const { HandoffState, DurableOutbox } = makeOutbox(mockStorage);
  await DurableOutbox.recordTransition(303, HandoffState.SUBMITTED, {
    url: "https://example.com/lost.zip",
    filename: "lost.zip",
  });

  const mockDownloadsApi = {
    search: async ({ id }) => {
      // Return empty array to simulate download no longer existing in browser
      return [];
    },
  };

  await DurableOutbox.reconcileOnStartup(mockDownloadsApi);
  const entry = DurableOutbox.getEntry(303);
  assert.equal(entry.state, HandoffState.BROWSER_CANCELLED);
  assert.ok(entry.error.includes("Cleaned up orphaned handoff"));
});
