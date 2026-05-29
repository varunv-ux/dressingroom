const DEFAULT_SERVER_URL = "https://pose-tryon.vercel.app";
const MAX_SELECTED_PHOTOS = 1;

const els = {
  openaiApiKey: document.querySelector("#openaiApiKey"),
  referenceInput: document.querySelector("#referenceInput"),
  referenceGrid: document.querySelector("#referenceGrid"),
  referenceCount: document.querySelector("#referenceCount"),
  uploadRow: document.querySelector(".upload-row"),
  showTryOns: document.querySelector("#showTryOns"),
  showTags: document.querySelector("#showTags"),
  clearRefsBtn: document.querySelector("#clearRefsBtn"),
  scanBtn: document.querySelector("#scanBtn"),
  generateBtn: document.querySelector("#generateBtn"),
  roomBtn: document.querySelector("#roomBtn"),
  message: document.querySelector("#message"),
};

let photoLibrary = [];
let busy = false;

init();

async function init() {
  const saved = await chrome.storage.local.get([
    "openaiApiKey",
    "referenceImages",
    "photoLibrary",
    "autoReplaceCached",
    "showTryOns",
    "showTags",
  ]);
  els.openaiApiKey.value = saved.openaiApiKey || "";
  els.showTryOns.checked = (saved.showTryOns ?? saved.autoReplaceCached) !== false;
  els.showTags.checked = saved.showTags !== false;
  photoLibrary = normalizePhotoSelection(migratePhotoLibrary(saved.photoLibrary, saved.referenceImages));
  await persistPhotoLibrary();
  renderReferences();
  await saveSettings();
  await checkServer();

  els.openaiApiKey.addEventListener("change", async () => {
    await saveSettings();
    await notifySettings();
  });

  els.showTryOns.addEventListener("change", async () => {
    await saveSettings();
    await updateTryOnView();
  });

  els.showTags.addEventListener("change", async () => {
    await saveSettings();
    await notifySettings();
  });

  els.referenceInput.addEventListener("change", handleReferenceFiles);
  els.clearRefsBtn.addEventListener("click", clearReferenceFiles);
  els.scanBtn.addEventListener("click", () => sendTabCommand("POSE_SCAN", "Found", "photos"));
  els.generateBtn.addEventListener("click", () => sendTabCommand("POSE_GENERATE_VISIBLE", "Made", "try-ons"));
  els.roomBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dressing-room.html") });
  });
}

async function handleReferenceFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }

  const images = await Promise.all(files.map(fileToDataUrl));
  const now = Date.now();
  const nextPhotos = images.map((src, index) => ({
    id: makePhotoId(),
    src,
    createdAt: now + index,
    selected: index === 0,
  }));

  photoLibrary = normalizePhotoSelection([
    ...photoLibrary.map((photo) => ({ ...photo, selected: false })),
    ...nextPhotos,
  ]);
  els.referenceInput.value = "";
  await persistPhotoLibrary();
  renderReferences();
  setMessage(`${images.length} photo${images.length === 1 ? "" : "s"} added.`);
}

async function clearReferenceFiles() {
  els.referenceInput.value = "";
  photoLibrary = [];
  await persistPhotoLibrary();
  renderReferences();
  setMessage("Photo library cleared.");
}

async function togglePhoto(photoId) {
  photoLibrary = photoLibrary.map((photo) => {
    return { ...photo, selected: photo.id === photoId };
  });

  await persistPhotoLibrary();
  renderReferences();
}

function renderReferences() {
  const selectedCount = getSelectedPhotos().length;
  els.referenceCount.textContent = photoLibrary.length ? String(selectedCount) : "0";
  els.clearRefsBtn.disabled = photoLibrary.length === 0;
  els.uploadRow.hidden = photoLibrary.length === 0;
  els.referenceGrid.classList.toggle("is-empty", photoLibrary.length === 0);

  const photoTiles = photoLibrary
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((photo) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `photo-tile${photo.selected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(Boolean(photo.selected)));
      button.title = photo.selected ? "Selected for try-ons" : "Use this photo for try-ons";
      button.addEventListener("click", () => togglePhoto(photo.id));

      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = "Your reference";
      button.append(img);

      const mark = document.createElement("span");
      mark.className = "checkmark";
      mark.textContent = "✓";
      button.append(mark);

      return button;
    });

  if (!photoTiles.length) {
    const emptyState = document.createElement("label");
    emptyState.className = "empty-reference";
    emptyState.htmlFor = "referenceInput";

    const title = document.createElement("strong");
    title.textContent = "Add your first photo";

    const copy = document.createElement("span");
    copy.textContent = "Use a clear photo of yourself.";

    emptyState.append(title, copy);
    els.referenceGrid.replaceChildren(emptyState);
  } else {
    els.referenceGrid.replaceChildren(...photoTiles);
  }

  updateActionStates();
}

function migratePhotoLibrary(library, referenceImages) {
  if (Array.isArray(library) && library.length) {
    return library.map((photo, index) => ({
      id: photo.id || makePhotoId(),
      src: photo.src,
      createdAt: photo.createdAt || Date.now() + index,
      selected: Boolean(photo.selected),
    }));
  }

  if (!Array.isArray(referenceImages)) {
    return [];
  }

  return referenceImages.map((src, index) => ({
    id: makePhotoId(),
    src,
    createdAt: Date.now() + index,
    selected: index === 0,
  }));
}

function makePhotoId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSelectedPhotos() {
  return photoLibrary.filter((photo) => photo.selected).slice(0, MAX_SELECTED_PHOTOS);
}

async function persistPhotoLibrary() {
  photoLibrary = normalizePhotoSelection(photoLibrary);
  const selectedImages = getSelectedPhotos().map((photo) => photo.src);
  await chrome.storage.local.set({
    photoLibrary,
    referenceImages: selectedImages,
  });
}

function normalizePhotoSelection(photos) {
  let selectedSeen = 0;
  return photos.map((photo) => {
    if (!photo.selected) {
      return photo;
    }

    selectedSeen += 1;
    return {
      ...photo,
      selected: selectedSeen <= MAX_SELECTED_PHOTOS,
    };
  });
}

async function sendTabCommand(type, doneLabel, noun) {
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await sendMessageToTab(tab, { type });
    if (!result?.ok) {
      throw new Error(result?.error || "The page is not ready for Pose.");
    }

    const count = result.count ?? 0;
    const total = result.total ? ` of ${result.total}` : "";
    setMessage(`${doneLabel} ${count}${total} ${noun}.`);
  } catch (error) {
    setMessage(error.message);
  } finally {
    setBusy(false);
  }
}

async function notifySettings() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  try {
    await sendMessageToTab(tab, {
      type: "POSE_SETTINGS_UPDATED",
      settings: {
        serverUrl: DEFAULT_SERVER_URL,
        showTryOns: els.showTryOns.checked,
        autoReplaceCached: els.showTryOns.checked,
        showTags: els.showTags.checked,
      },
    });
  } catch {
    // Some browser pages cannot receive content-script messages.
  }
}

async function updateTryOnView() {
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await sendMessageToTab(tab, {
      type: "POSE_SETTINGS_UPDATED",
      settings: {
        serverUrl: DEFAULT_SERVER_URL,
        showTryOns: els.showTryOns.checked,
        autoReplaceCached: els.showTryOns.checked,
        showTags: els.showTags.checked,
      },
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Could not update this page.");
    }

    if (els.showTryOns.checked) {
      setMessage(`Showing ${result.count ?? 0} saved try-on${(result.count ?? 0) === 1 ? "" : "s"}.`);
    } else {
      setMessage(`Restored ${result.count ?? 0} store photo${(result.count ?? 0) === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    setMessage(error.message);
  } finally {
    setBusy(false);
  }
}

async function sendMessageToTab(tab, message) {
  if (!tab?.id) {
    throw new Error("No active browser tab found.");
  }

  if (!/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open a shopping page to find product photos.");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await injectContentScript(tab.id);
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

function isMissingReceiverError(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(error?.message || "");
}

async function saveSettings() {
  await chrome.storage.local.set({
    serverUrl: DEFAULT_SERVER_URL,
    openaiApiKey: els.openaiApiKey.value.trim(),
    showTryOns: els.showTryOns.checked,
    autoReplaceCached: els.showTryOns.checked,
    showTags: els.showTags.checked,
  });
}

async function checkServer() {
  try {
    const response = await fetch(new URL("/health", DEFAULT_SERVER_URL));
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error("Server unavailable");
    }
  } catch {
    setMessage("Pose server is offline.");
  }
}

function setBusy(isBusy) {
  busy = isBusy;
  updateActionStates();
}

function updateActionStates() {
  const hasReferencePhoto = getSelectedPhotos().length > 0;
  els.scanBtn.disabled = busy;
  els.generateBtn.disabled = busy || !hasReferencePhoto;
  els.roomBtn.disabled = busy;
}

function setMessage(message) {
  els.message.textContent = message;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const maxSide = 1536;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image. Try a JPEG or PNG photo."));
    };
    img.src = objectUrl;
  });
}
