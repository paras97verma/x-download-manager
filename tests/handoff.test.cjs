const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "../extensions/chromium/background.js"),
  "utf8",
);

function makeExtension(nativeResult, requestContext = null) {
  const events = { created: [] };
  const state = { state: "in_progress" };
  const order = [];
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (file) => file,
      sendNativeMessage: async (_host, payload) => {
        assert.equal(payload.method, requestContext?.method || "GET");
        assert.equal(payload.request_replayable, Boolean(requestContext));
        if (requestContext?.bodyBase64) assert.equal(payload.body_base64, requestContext.bodyBase64);
        order.push("native-message");
        return nativeResult;
      },
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get: (_keys, callback) => callback({ interceptEnabled: true }),
        remove: () => Promise.resolve(),
      },
      onChanged: { addListener() {} },
    },
    downloads: {
      onCreated: { addListener: (handler) => events.created.push(handler) },
      pause: async () => { state.state = "paused"; },
      resume: async () => { order.push("resume"); state.state = "in_progress"; },
      cancel: async () => { order.push("cancel"); state.state = "interrupted"; },
      search: async () => [{ id: 1, state: state.state }],
      erase: async () => {},
    },
    cookies: { getAll: async () => [] },
    notifications: { create: async () => "notice" },
    action: {
      setBadgeBackgroundColor() {},
      setBadgeText() {},
      setTitle() {},
    },
    tabs: { sendMessage: async () => {} },
  };
  const context = vm.createContext({
    chrome,
    navigator: { userAgent: "Test Browser", appVersion: "Test Browser" },
    URL,
    AbortController,
    fetch: async () => { throw new Error("no running app status endpoint"); },
    setInterval: () => 0,
    setTimeout: (callback) => { Promise.resolve().then(callback); return 0; },
    clearTimeout() {},
    console: { warn() {}, error() {} },
  });
  if (requestContext) {
    context.ByteXRequestCapture = {
      find: () => {
        order.push("request-capture");
        return requestContext;
      },
    };
  }
  vm.runInContext(backgroundSource, context);
  return { events, order, state };
}

test("the browser item is cancelled only after ByteX acknowledges the handoff", async () => {
  const extension = makeExtension({ accepted: true, download_id: "native-1" }, {
    originalUrl: "https://files.example/archive.bin",
    finalUrl: "https://files.example/archive.bin",
    method: "GET",
    replayable: true,
    headers: {},
    redirects: [],
  });
  const item = {
    id: 1,
    url: "https://files.example/archive.bin",
    finalUrl: "https://files.example/archive.bin",
    filename: "/downloads/archive.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    referrer: "https://files.example/",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["request-capture", "native-message", "cancel"]);
  assert.equal(extension.state.state, "interrupted");
});

test("a rejected handoff resumes the paused browser download without cancelling it", async () => {
  const extension = makeExtension({ accepted: false, reason: "POST body unavailable" });
  const item = {
    id: 1,
    url: "https://files.example/archive.bin",
    finalUrl: "https://files.example/archive.bin",
    filename: "/downloads/archive.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["native-message", "resume"]);
  assert.equal(extension.state.state, "in_progress");
});

test("the request context is claimed before the browser pause and transferred to ByteX", async () => {
  const extension = makeExtension({ accepted: true }, {
    originalUrl: "https://files.example/create",
    finalUrl: "https://cdn.example/file.bin",
    method: "POST",
    bodyBase64: Buffer.from("download_id=7").toString("base64"),
    replayable: true,
    headers: { authorization: "Bearer private" },
    redirects: [],
  });
  const item = {
    id: 1,
    url: "https://files.example/create",
    finalUrl: "https://cdn.example/file.bin",
    filename: "/downloads/file.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.equal(extension.order[0], "request-capture");
  assert.equal(extension.order.at(-1), "cancel");
});
