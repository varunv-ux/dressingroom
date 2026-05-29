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
  const headers = { ...(options.headers || {}) };
  const openaiApiKey = await getOpenAIKeyForRequest(url);

  if (openaiApiKey) {
    headers["X-Pose-OpenAI-Key"] = openaiApiKey;
  }

  const response = await fetch(url.href, {
    method: options.method || "GET",
    headers,
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

  if (url.protocol !== "https:") {
    throw new Error("The generation server must be hosted over HTTPS.");
  }

  return url;
}

async function getOpenAIKeyForRequest(url) {
  if (url.pathname !== "/api/try-on") {
    return "";
  }

  const saved = await chrome.storage.local.get("openaiApiKey");
  return String(saved.openaiApiKey || "").trim();
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
