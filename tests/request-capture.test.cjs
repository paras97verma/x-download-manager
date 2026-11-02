const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function makeCapture(extensionDirectory) {
  const events = {};
  const makeEvent = (name) => {
    events[name] = [];
    return { addListener: (listener) => events[name].push(listener) };
  };
  const browser = {
    webRequest: {
      onBeforeRequest: makeEvent("onBeforeRequest"),
      onBeforeSendHeaders: makeEvent("onBeforeSendHeaders"),
      onHeadersReceived: makeEvent("onHeadersReceived"),
      onBeforeRedirect: makeEvent("onBeforeRedirect"),
    },
  };
  const context = vm.createContext({
    browser,
    URL,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
    Map,
    Date,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  });
  const source = fs.readFileSync(path.join(root, "extensions", extensionDirectory, "request-capture.js"), "utf8");
  vm.runInContext(source, context);
  const fire = (name, details) => events[name][0]?.(details);
  return { capture: context.ByteXRequestCapture, fire };
}

for (const extensionDirectory of ["chromium", "firefox"]) {
  test(`${extensionDirectory} leaves HTTP downloads in the browser when request context was unavailable`, () => {
    const { capture } = makeCapture(extensionDirectory);
    const missing = capture.find({
      id: 2,
      url: "https://files.example/download.bin",
      finalUrl: "https://files.example/download.bin",
      tabId: 4,
    });
    assert.equal(missing.replayable, false);
    assert.match(missing.unavailableReason, /could not capture/i);

    const ftp = capture.find({
      id: 3,
      url: "ftp://files.example/download.bin",
      finalUrl: "ftp://files.example/download.bin",
      tabId: 4,
    });
    assert.equal(ftp.replayable, true);
  });

  test(`${extensionDirectory} captures the request body, credentials, and referrer`, () => {
    const { capture, fire } = makeCapture(extensionDirectory);
    const body = new TextEncoder().encode("file_id=42&csrf=secret");
    const details = {
      requestId: "request-1",
      tabId: 4,
      url: "https://files.example/download",
      method: "POST",
      requestBody: { raw: [{ bytes: body.buffer }] },
    };
    fire("onBeforeRequest", details);
    fire("onBeforeSendHeaders", {
      ...details,
      requestHeaders: [
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Cookie", value: "session=secret" },
        { name: "Authorization", value: "Bearer secret" },
        { name: "Referer", value: "https://files.example/page" },
        { name: "User-Agent", value: "Browser Test" },
        { name: "Host", value: "files.example" },
      ],
    });
    fire("onHeadersReceived", {
      ...details,
      statusCode: 200,
      responseHeaders: [
        { name: "Content-Disposition", value: "attachment; filename=archive.zip" },
        { name: "Content-Type", value: "application/zip" },
        { name: "Set-Cookie", value: "should-not-be-forwarded=1" },
      ],
    });

    const result = capture.find({
      id: 9,
      url: `${details.url}#download-fragment`,
      finalUrl: `${details.url}#download-fragment`,
      tabId: 4,
    });
    assert.equal(result.method, "POST");
    assert.equal(Buffer.from(result.bodyBase64, "base64").toString(), "file_id=42&csrf=secret");
    assert.equal(result.replayable, true);
    assert.equal(result.headers.cookie, "session=secret");
    assert.equal(result.headers.authorization, "Bearer secret");
    assert.equal(result.headers.referer, "https://files.example/page");
    assert.equal(result.responseHeaders["content-disposition"], "attachment; filename=archive.zip");
    assert.equal(Object.hasOwn(result.responseHeaders, "set-cookie"), false);
  });

  test(`${extensionDirectory} tracks redirect status and uses the final request method`, () => {
    const { capture, fire } = makeCapture(extensionDirectory);
    fire("onBeforeRequest", {
      requestId: "redirect-1", tabId: 2, url: "https://example.test/start", method: "POST",
      requestBody: { raw: [{ bytes: new TextEncoder().encode("x=1").buffer }] },
    });
    fire("onBeforeSendHeaders", {
      requestId: "redirect-1", tabId: 2, url: "https://example.test/start", method: "POST",
      requestHeaders: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
    });
    fire("onBeforeRedirect", {
      requestId: "redirect-1", tabId: 2, url: "https://example.test/start", method: "POST",
      redirectUrl: "https://cdn.example.test/file.bin", statusCode: 303,
    });
    fire("onBeforeRequest", {
      requestId: "redirect-1", tabId: 2, url: "https://cdn.example.test/file.bin", method: "GET",
    });
    fire("onBeforeSendHeaders", {
      requestId: "redirect-1", tabId: 2, url: "https://cdn.example.test/file.bin", method: "GET",
      requestHeaders: [{ name: "User-Agent", value: "Browser Test" }],
    });

    const result = capture.find({
      id: 12,
      url: "https://example.test/start",
      finalUrl: "https://cdn.example.test/file.bin",
      tabId: 2,
    });
    assert.equal(result.originalUrl, "https://example.test/start");
    assert.equal(result.finalUrl, "https://cdn.example.test/file.bin");
    assert.equal(result.method, "GET");
    assert.deepEqual(JSON.parse(JSON.stringify(result.redirects)), [{
      from_url: "https://example.test/start",
      to_url: "https://cdn.example.test/file.bin",
      status_code: 303,
    }]);
  });

  test(`${extensionDirectory} refuses a POST body that contains an inaccessible upload file`, () => {
    const { capture, fire } = makeCapture(extensionDirectory);
    const details = {
      requestId: "file-post", tabId: 1, url: "https://example.test/upload-download", method: "POST",
      requestBody: { raw: [{ file: "/private/path/hidden-from-extension" }] },
    };
    fire("onBeforeRequest", details);
    fire("onBeforeSendHeaders", { ...details, requestHeaders: [{ name: "Content-Type", value: "multipart/form-data" }] });
    const result = capture.find({ id: 2, url: details.url, finalUrl: details.url, tabId: 1 });
    assert.equal(result.replayable, false);
    assert.match(result.unavailableReason, /upload file/i);
  });
}
