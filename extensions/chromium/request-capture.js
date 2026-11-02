// Observe the browser request before the downloads API reports the item. This
// does not block the request; the background worker pauses the download and
// transfers the best available request context to the native app.
(function initializeByteXRequestCapture() {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const MAX_BODY_BYTES = 1024 * 1024;
  const MAX_HEADER_BYTES = 32 * 1024;
  const captures = new Map();

  function bytesToBase64(bytes) {
    let binary = "";
    const blockSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
    }
    return btoa(binary);
  }

  function bodyFromRequest(details) {
    const body = details.requestBody;
    if (!body) {
      return {
        bodyBase64: null,
        formData: null,
        replayable: !["POST", "PUT", "PATCH"].includes(details.method),
        reason: "The browser did not expose this request body.",
      };
    }

    if (Array.isArray(body.raw)) {
      const chunks = [];
      let size = 0;
      for (const entry of body.raw) {
        if (!entry || !entry.bytes) {
          return {
            bodyBase64: null,
            formData: null,
            replayable: false,
            reason: "The request contains an upload file that the browser does not expose to extensions.",
          };
        }
        const chunk = new Uint8Array(entry.bytes);
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) {
          return {
            bodyBase64: null,
            formData: null,
            replayable: false,
            reason: "The captured request body exceeds ByteX's 1 MiB secure replay limit.",
          };
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bodyBase64: bytesToBase64(bytes), formData: null, replayable: true, reason: null };
    }

    if (body.formData && typeof body.formData === "object") {
      return { bodyBase64: null, formData: body.formData, replayable: true, reason: null };
    }

    return {
      bodyBase64: null,
      formData: null,
      replayable: false,
      reason: "The browser exposed an unsupported request-body format.",
    };
  }

  function requestFor(details) {
    let capture = captures.get(details.requestId);
    if (!capture) {
      if (captures.size >= 16) {
        const oldest = [...captures.entries()].sort((left, right) => left[1].startedAt - right[1].startedAt)[0];
        if (oldest) captures.delete(oldest[0]);
      }
      capture = {
        requestId: details.requestId,
        tabId: details.tabId,
        startedAt: Date.now(),
        hops: [],
        redirects: [],
      };
      captures.set(details.requestId, capture);
    }
    let hop = capture.hops[capture.hops.length - 1];
    if (!hop || hop.url !== details.url || hop.method !== details.method) {
      const body = bodyFromRequest(details);
      hop = {
        url: details.url,
        method: details.method || "GET",
        bodyBase64: body.bodyBase64,
        formData: body.formData,
        replayable: body.replayable,
        unavailableReason: body.reason,
        headers: {},
        responseHeaders: {},
      };
      capture.hops.push(hop);
    }
    return { capture, hop };
  }

  function onBeforeRequest(details) {
    requestFor(details);
  }

  function normalizedHeaders(list) {
    const headers = {};
    let size = 0;
    for (const header of list || []) {
      if (!header || typeof header.name !== "string" || typeof header.value !== "string") continue;
      const name = header.name.toLowerCase();
      if (["host", "content-length", "connection", "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade", "accept-encoding", "set-cookie"].includes(name)) continue;
      if (header.value.length > 16 * 1024) continue;
      size += name.length + header.value.length;
      if (size > MAX_HEADER_BYTES) return null;
      headers[name] = headers[name] ? `${headers[name]}, ${header.value}` : header.value;
    }
    return headers;
  }

  function onBeforeSendHeaders(details) {
    const { capture, hop } = requestFor(details);
    const headers = normalizedHeaders(details.requestHeaders);
    if (!headers) {
      hop.replayable = false;
      hop.unavailableReason = "The browser request headers exceed ByteX's secure replay limit.";
      return;
    }
    hop.headers = headers;
    const contentType = String(headers["content-type"] || "").toLowerCase();
    if (hop.formData) {
      if (contentType.includes("multipart/form-data")) {
        hop.replayable = false;
        hop.unavailableReason = "Multipart form bodies cannot be reconstructed exactly from the browser's exposed form fields.";
        hop.formData = null;
      } else {
        const params = new URLSearchParams();
        for (const [key, values] of Object.entries(hop.formData)) {
          for (const value of Array.isArray(values) ? values : [values]) params.append(key, String(value));
        }
        const encoded = new TextEncoder().encode(params.toString());
        if (encoded.byteLength > MAX_BODY_BYTES) {
          hop.replayable = false;
          hop.unavailableReason = "The captured form body exceeds ByteX's 1 MiB secure replay limit.";
        } else {
          hop.bodyBase64 = bytesToBase64(encoded);
          if (!headers["content-type"]) hop.headers["content-type"] = "application/x-www-form-urlencoded";
        }
        hop.formData = null;
      }
    }
    hop.lastSeenAt = Date.now();
    capture.lastSeenAt = Date.now();
  }

  function onHeadersReceived(details) {
    const { capture, hop } = requestFor(details);
    const headers = normalizedHeaders(details.responseHeaders);
    if (headers) hop.responseHeaders = headers;
    hop.responseStatus = details.statusCode;
    capture.lastSeenAt = Date.now();
  }

  function onBeforeRedirect(details) {
    const { capture, hop } = requestFor(details);
    const to = details.redirectUrl;
    if (to) {
      capture.redirects.push({ from_url: details.url, to_url: to, status_code: details.statusCode || null });
      hop.redirectUrl = to;
      hop.responseStatus = details.statusCode;
    }
    capture.lastSeenAt = Date.now();
  }

  function comparableUrl(value) {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString();
    } catch (_) {
      return value || "";
    }
  }

  function find(downloadItem) {
    const original = downloadItem.url || "";
    const final = downloadItem.finalUrl || original;
    const originalKey = comparableUrl(original);
    const finalKey = comparableUrl(final);
    const now = Date.now();
    let selected = null;
    for (const [requestId, capture] of captures) {
      if (now - (capture.lastSeenAt || capture.startedAt) > 120000) {
        captures.delete(requestId);
        continue;
      }
      if (capture.tabId !== undefined && downloadItem.tabId >= 0 && capture.tabId !== downloadItem.tabId) continue;
      const matchingHop = [...capture.hops].reverse().find((hop) => comparableUrl(hop.url) === finalKey)
        || [...capture.hops].reverse().find((hop) => comparableUrl(hop.url) === originalKey || comparableUrl(hop.redirectUrl) === finalKey);
      const matchesChain = capture.hops.some((hop) => comparableUrl(hop.url) === originalKey || comparableUrl(hop.redirectUrl) === finalKey);
      if (!matchingHop || !matchesChain) continue;
      if (!selected || capture.startedAt > selected.capture.startedAt) selected = { requestId, capture, matchingHop };
    }
    if (!selected) {
      const isFtp = new URL(final).protocol === "ftp:";
      return {
        originalUrl: original,
        finalUrl: final,
        method: "GET",
        bodyBase64: null,
        replayable: isFtp,
        unavailableReason: isFtp ? null : "ByteX could not capture the browser's original HTTP request context.",
        headers: {},
        redirects: [],
      };
    }
    captures.delete(selected.requestId);
    const hop = selected.matchingHop;
    let replayable = hop.replayable;
    let reason = hop.unavailableReason;
    if (["POST", "PUT", "PATCH"].includes(hop.method) && hop.bodyBase64 === null) {
      replayable = false;
      reason ||= "The browser did not expose the complete request body.";
    }
    return {
      originalUrl: selected.capture.hops[0]?.url || original,
      finalUrl: final,
      method: hop.method || "GET",
      bodyBase64: hop.bodyBase64,
      replayable,
      unavailableReason: reason,
      headers: hop.headers || {},
      redirects: selected.capture.redirects,
      responseHeaders: hop.responseHeaders || {},
      responseStatus: hop.responseStatus || null,
    };
  }

  try {
    const filter = { urls: ["http://*/*", "https://*/*"] };
    api.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter, ["requestBody"]);
    try {
      api.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, filter, ["requestHeaders", "extraHeaders"]);
    } catch (_) {
      api.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, filter, ["requestHeaders"]);
    }
    api.webRequest.onHeadersReceived.addListener(onHeadersReceived, filter, ["responseHeaders"]);
    api.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, filter, ["responseHeaders"]);
  } catch (_) {
    // Downloads can still be handed off as a GET with cookies/referer fallback.
  }

  globalThis.ByteXRequestCapture = { find };
})();
