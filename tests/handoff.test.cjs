const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "../extensions/chromium/background.js"),
  "utf8",
);

function makeExtension(nativeResult, requestContext = null, callbackMode = false, nativeError = null) {
  const events = { created: [] };
  const state = { state: "in_progress" };
  const order = [];
  const titles = [];
  const payloads = [];
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (file) => file,
      sendNativeMessage: (_host, payload, callback) => {
        assert.equal(payload.method, requestContext?.method || "GET");
        const isBodyMethod = ["POST", "PUT", "PATCH"].includes(payload.method);
        assert.equal(payload.request_replayable, isBodyMethod ? requestContext?.replayable === true : true);
        if (requestContext?.bodyBase64) assert.equal(payload.body_base64, requestContext.bodyBase64);
        order.push("native-message");
        payloads.push(payload);
        if (callbackMode) {
          queueMicrotask(() => {
            chrome.runtime.lastError = nativeError;
            callback(nativeResult);
            chrome.runtime.lastError = null;
          });
          return undefined;
        }
        return Promise.resolve(nativeResult);
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
      setTitle: ({ title }) => titles.push(title),
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
    setTimeout: (callback, delay = 0) => {
      if (delay <= 1000) Promise.resolve().then(callback);
      return 0;
    },
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
  return { events, order, state, titles, payloads };
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

test("callback-only Chromium Native Messaging delivers the handoff acknowledgement", async () => {
  const extension = makeExtension({ accepted: true, download_id: "native-callback" }, {
    originalUrl: "https://files.example/callback.bin",
    finalUrl: "https://files.example/callback.bin",
    method: "GET",
    replayable: true,
    headers: {},
    redirects: [],
  }, true);
  const item = {
    id: 2,
    url: "https://files.example/callback.bin",
    finalUrl: "https://files.example/callback.bin",
    filename: "/downloads/callback.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["request-capture", "native-message", "cancel"]);
  assert.equal(extension.state.state, "interrupted");
});

test("missing webRequest capture hands a GET to ByteX using the resolved URL", async () => {
  const extension = makeExtension({ accepted: true, download_id: "native-fallback" }, {
    originalUrl: "https://files.example/start-download",
    finalUrl: "https://files.example/start-download",
    method: "GET",
    replayable: false,
    unavailableReason: "ByteX could not capture the browser's original HTTP request context.",
    headers: {},
    redirects: [],
  });
  const item = {
    id: 4,
    url: "https://files.example/start-download",
    finalUrl: "https://cdn.example/signed-file.bin?token=short-lived",
    filename: "/downloads/file.bin",
    totalBytes: 100,
    mime: "application/octet-stream",
    referrer: "https://files.example/page",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["request-capture", "native-message", "cancel"]);
  assert.equal(extension.payloads[0].url, item.finalUrl);
  assert.equal(extension.payloads[0].original_url, item.finalUrl);
  assert.equal(extension.payloads[0].final_url, item.finalUrl);
  assert.equal(extension.payloads[0].method, "GET");
  assert.equal(extension.payloads[0].referer, item.referrer);
  assert.equal(extension.payloads[0].request_replayable, true);
});

test("an uncaptured POST body is not converted to a GET handoff", async () => {
  const extension = makeExtension({ accepted: false, reason: "POST body unavailable" }, {
    originalUrl: "https://files.example/create-download",
    finalUrl: "https://files.example/create-download",
    method: "POST",
    replayable: false,
    unavailableReason: "The browser did not expose the complete request body.",
    headers: {},
    redirects: [],
  });
  const item = {
    id: 5,
    url: "https://files.example/create-download",
    finalUrl: "https://files.example/create-download",
    filename: "/downloads/post-file.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["request-capture", "native-message", "resume"]);
  assert.equal(extension.payloads[0].method, "POST");
  assert.equal(extension.payloads[0].request_replayable, false);
});

test("Native Messaging registration errors are shown and the browser transfer resumes", async () => {
  const extension = makeExtension(null, null, true, {
    message: "Specified native messaging host not found.",
  });
  const item = {
    id: 3,
    url: "https://files.example/unavailable-host.bin",
    finalUrl: "https://files.example/unavailable-host.bin",
    filename: "/downloads/unavailable-host.bin",
    totalBytes: 0,
    mime: "application/octet-stream",
    tabId: 2,
  };
  await extension.events.created[0](item);
  assert.deepEqual(extension.order, ["native-message", "resume"]);
  assert.equal(extension.state.state, "in_progress");
  assert.ok(extension.titles.some((title) => title.includes("not registered in this browser")));
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
