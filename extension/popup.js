const DEFAULT_SERVER_URL = "https://dressingroom-gray.vercel.app";
const MAX_SELECTED_PHOTOS = 1;

const els = {
  openaiApiKey: document.querySelector("#openaiApiKey"),
  apiKeySaved: document.querySelector("#apiKeySaved"),
  referenceInput: document.querySelector("#referenceInput"),
  referenceGrid: document.querySelector("#referenceGrid"),
  referenceCount: document.querySelector("#referenceCount"),
  uploadRow: document.querySelector(".upload-row"),
  showTryOns: document.querySelector("#showTryOns"),
  showTags: document.querySelector("#showTags"),
  scanBtn: document.querySelector("#scanBtn"),
  roomBtn: document.querySelector("#roomBtn"),
  message: document.querySelector("#message"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsBack: document.querySelector("#settingsBack"),
  mainView: document.querySelector("#mainView"),
  settingsView: document.querySelector("#settingsView"),
  appTitle: document.querySelector("#appTitle"),
};

let photoLibrary = [];
let busy = false;
let activeTab = null;
let messageTimer = 0;
let apiKeySavedTimer = 0;
let dragDepth = 0;

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
  await refreshActiveTab();
  await checkServer();

  els.openaiApiKey.addEventListener("change", async () => {
    await saveSettings();
    flashApiKeySaved();
    await notifySettings();
  });
  els.openaiApiKey.addEventListener("blur", async () => {
    await saveSettings();
    flashApiKeySaved();
  });

  els.showTryOns.addEventListener("change", async () => {
    await saveSettings();
    await updateTryOnView();
  });

  els.showTags.addEventListener("change", async () => {
    await saveSettings();
    await notifySettings();
  });

  els.referenceInput.addEventListener("change", (event) => importPhotoFiles(event.target.files));
  els.scanBtn.addEventListener("click", () => sendTabCommand("POSE_SCAN", "Found", "photos"));
  els.roomBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dressing-room.html") });
  });
  els.settingsToggle.addEventListener("click", () => setSettingsOpen(true));
  els.settingsBack.addEventListener("click", () => setSettingsOpen(false));

  initDragAndDrop();
}

function initDragAndDrop() {
  const dropZone = els.referenceGrid;
  const onEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add("is-drop-target");
  };
  const onOver = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove("is-drop-target");
  };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-drop-target");
    importPhotoFiles(event.dataTransfer?.files);
  };

  ["dragenter"].forEach((evt) => dropZone.addEventListener(evt, onEnter));
  ["dragover"].forEach((evt) => dropZone.addEventListener(evt, onOver));
  ["dragleave"].forEach((evt) => dropZone.addEventListener(evt, onLeave));
  ["drop"].forEach((evt) => dropZone.addEventListener(evt, onDrop));

  window.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function setSettingsOpen(open) {
  els.mainView.hidden = open;
  els.settingsView.hidden = !open;
  els.settingsToggle.hidden = open;
  els.settingsBack.hidden = !open;
  els.settingsToggle.setAttribute("aria-expanded", String(open));
  els.appTitle.textContent = open ? "Settings" : "Dressing room";
  setMessage("");
}

async function handleReferenceFiles(event) {
  await importPhotoFiles(event.target.files);
  els.referenceInput.value = "";
}

async function importPhotoFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
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
  await persistPhotoLibrary();
  renderReferences();
  setMessage(`Added ${images.length}.`);
}

async function clearReferenceFiles() {
  els.referenceInput.value = "";
  photoLibrary = [];
  await persistPhotoLibrary();
  renderReferences();
  setMessage("Cleared.");
}

async function removePhoto(photoId) {
  const removed = photoLibrary.find((photo) => photo.id === photoId);
  if (!removed) {
    return;
  }

  const wasSelected = removed.selected;
  photoLibrary = photoLibrary.filter((photo) => photo.id !== photoId);
  if (wasSelected && photoLibrary.length && !photoLibrary.some((photo) => photo.selected)) {
    const newest = photoLibrary.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    photoLibrary = photoLibrary.map((photo) => ({ ...photo, selected: photo.id === newest.id }));
  }
  await persistPhotoLibrary();
  renderReferences();
  setMessage("Removed.");
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
  els.uploadRow.hidden = photoLibrary.length === 0;
  els.referenceGrid.classList.toggle("is-empty", photoLibrary.length === 0);

  const photoTiles = photoLibrary
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((photo) => {
      const tile = document.createElement("div");
      tile.className = `photo-tile${photo.selected ? " selected" : ""}`;

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "photo-select";
      selectBtn.setAttribute("aria-pressed", String(Boolean(photo.selected)));
      selectBtn.title = photo.selected ? "Selected" : "Use this photo";
      selectBtn.addEventListener("click", () => togglePhoto(photo.id));

      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = "Your reference";
      selectBtn.append(img);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "photo-remove";
      removeBtn.setAttribute("aria-label", "Remove");
      removeBtn.title = "Remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removePhoto(photo.id);
      });

      tile.append(selectBtn, removeBtn);
      return tile;
    });

  if (!photoTiles.length) {
    const emptyState = document.createElement("label");
    emptyState.className = "empty-reference";
    emptyState.htmlFor = "referenceInput";

    const title = document.createElement("strong");
    title.textContent = "Add a photo";

    const copy = document.createElement("span");
    copy.textContent = "A clear photo of you works best.";

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
      throw new Error(result?.error || "This page isn’t ready.");
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
      throw new Error(result?.error || "Couldn’t update this page.");
    }

    if (els.showTryOns.checked) {
      setMessage(`Showing ${result.count ?? 0} try-on${(result.count ?? 0) === 1 ? "" : "s"}.`);
    } else {
      setMessage(`Restored ${result.count ?? 0} photo${(result.count ?? 0) === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    setMessage(error.message);
  } finally {
    setBusy(false);
  }
}

async function sendMessageToTab(tab, message) {
  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  if (!/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open a shopping page first.");
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
    setMessage("Server offline.");
  }
}

function setBusy(isBusy) {
  busy = isBusy;
  updateActionStates();
}

function updateActionStates() {
  const tabReady = isTabReady(activeTab);
  els.scanBtn.disabled = busy || !tabReady;
  els.scanBtn.title = tabReady ? "" : "Open a shopping page first.";
  els.roomBtn.disabled = busy;
}

async function refreshActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
  } catch {
    activeTab = null;
  }
  updateActionStates();
}

function isTabReady(tab) {
  return /^https?:\/\//.test(tab?.url || "");
}

function flashApiKeySaved() {
  if (!els.apiKeySaved) return;
  els.apiKeySaved.hidden = false;
  els.apiKeySaved.classList.add("is-visible");
  window.clearTimeout(apiKeySavedTimer);
  apiKeySavedTimer = window.setTimeout(() => {
    els.apiKeySaved.classList.remove("is-visible");
    apiKeySavedTimer = window.setTimeout(() => {
      els.apiKeySaved.hidden = true;
    }, 200);
  }, 1400);
}

function setMessage(message) {
  els.message.textContent = message;
  window.clearTimeout(messageTimer);
  if (message) {
    messageTimer = window.setTimeout(() => {
      els.message.textContent = "";
    }, 3200);
  }
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
      reject(new Error("Couldn’t read that image. Try a JPEG or PNG."));
    };
    img.src = objectUrl;
  });
}
