chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "POSE_SERVER_REQUEST") {
    return false;
  }

  handleServerRequest(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleServerRequest(message) {
  const url = normalizeServerUrl(message.url);
  const options = message.options || {};
  const response = await fetch(url.href, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
  });

  const text = await response.text();
  const body = parseJson(text);

  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    body,
    text: body ? "" : text,
  };
}

function normalizeServerUrl(value) {
  const url = new URL(String(value || ""));
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  if (url.protocol !== "http:" || !localHosts.has(url.hostname) || url.port !== "8787") {
    throw new Error("Only the local Pose server can be reached from the extension.");
  }

  return url;
}

function parseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
