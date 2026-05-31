const LOOKS_STORAGE_KEY = "dressingRoomLooks";
const ORDER_STORAGE_KEY = "dressingRoomLookOrder";
const HIDDEN_LOOKS_STORAGE_KEY = "dressingRoomHiddenLooks";
const STACKS_STORAGE_KEY = "dressingRoomStacks";
const PENDING_STORAGE_KEY = "dressingRoomPending";
const FILTER_STORAGE_KEY = "dressingRoomFilter";
const ACTIVE_STACK_STORAGE_KEY = "dressingRoomActiveStack";
const BRAND_LABELS = {
  "zara.com": "Zara",
  "www.zara.com": "Zara",
  "shop.mango.com": "Mango",
  "media.mango.com": "Mango",
  "mango.com": "Mango",
  "suitsupply.com": "Suitsupply",
  "www.suitsupply.com": "Suitsupply",
};
const BRAND_ORDER = ["Zara", "Mango", "Suitsupply"];
const ICONS = {
  unstackFromCard:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h9"/><path d="M7 12h13"/><path d="M11 19h9"/><path d="m8 8-4 4 4 4"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  hide:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M4 7h16"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>',
};

const els = {
  main: document.querySelector("main"),
  filters: document.querySelector("#filters"),
  grid: document.querySelector("#grid"),
  selectionAction: document.querySelector("#selectionAction"),
  selectionCount: document.querySelector("#selectionCount"),
  createStackButton: document.querySelector("#createStackButton"),
  stackLayer: document.querySelector("#stackLayer"),
  closeStackButton: document.querySelector("#closeStackButton"),
  stackTitle: document.querySelector("#stackTitle"),
  stackCount: document.querySelector("#stackCount"),
  stackGrid: document.querySelector("#stackGrid"),
  unstackButton: document.querySelector("#unstackButton"),
  template: document.querySelector("#lookTemplate"),
};

let state = {
  looks: [],
  order: [],
  hiddenIds: [],
  stacks: [],
  pending: [],
  filter: "all",
  activeStackId: "",
};

let galleryGrid = null;
let pendingMuuriSync = 0;
let pendingMuuriLayout = 0;
let selectionArea = null;
let selectedLookIds = [];
let selectedLookAnchorId = "";
let dragStackTargetId = "";
let pendingStackDrop = null;
let suppressNextCardOpen = false;
let suppressCardOpenTimer = 0;
let draggingStackId = "";
let unstackInFlight = false;

init();

async function init() {
  const saved = await chrome.storage.local.get([
    LOOKS_STORAGE_KEY,
    ORDER_STORAGE_KEY,
    HIDDEN_LOOKS_STORAGE_KEY,
    STACKS_STORAGE_KEY,
    PENDING_STORAGE_KEY,
    FILTER_STORAGE_KEY,
    ACTIVE_STACK_STORAGE_KEY,
  ]);
  state.order = Array.isArray(saved[ORDER_STORAGE_KEY]) ? saved[ORDER_STORAGE_KEY].map(normalizeOrderKey) : [];
  state.looks = applyStoredOrder(Array.isArray(saved[LOOKS_STORAGE_KEY]) ? saved[LOOKS_STORAGE_KEY] : []);
  state.hiddenIds = Array.isArray(saved[HIDDEN_LOOKS_STORAGE_KEY]) ? saved[HIDDEN_LOOKS_STORAGE_KEY] : [];
  state.stacks = Array.isArray(saved[STACKS_STORAGE_KEY]) ? normalizeStacks(saved[STACKS_STORAGE_KEY]) : [];
  state.pending = Array.isArray(saved[PENDING_STORAGE_KEY]) ? saved[PENDING_STORAGE_KEY] : [];
  state.filter = typeof saved[FILTER_STORAGE_KEY] === "string" ? saved[FILTER_STORAGE_KEY] : "all";
  const restoredStackId = typeof saved[ACTIVE_STACK_STORAGE_KEY] === "string" ? saved[ACTIVE_STACK_STORAGE_KEY] : "";
  els.createStackButton.addEventListener("click", createStackFromSelection);
  els.closeStackButton.innerHTML = ICONS.close;
  els.closeStackButton.addEventListener("click", closeStackLayer);
  els.unstackButton.addEventListener("click", unstackActiveStack);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStackLayer();
      clearSelection();
    }
  });
  window.addEventListener("resize", debounce(() => {
    sizeMuuriItems();
    galleryGrid?.refreshItems().layout();
    positionSelectionAction();
  }, 120));

  render();
  initSelectionArea();
  if (restoredStackId && state.stacks.some((stack) => stack.id === restoredStackId)) {
    openStackLayer(restoredStackId);
  }
  chrome.storage.onChanged.addListener(handleStorageChange);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }
  let touched = false;
  if (changes[LOOKS_STORAGE_KEY]) {
    state.looks = applyStoredOrder(Array.isArray(changes[LOOKS_STORAGE_KEY].newValue) ? changes[LOOKS_STORAGE_KEY].newValue : []);
    touched = true;
  }
  if (changes[STACKS_STORAGE_KEY]) {
    state.stacks = Array.isArray(changes[STACKS_STORAGE_KEY].newValue) ? normalizeStacks(changes[STACKS_STORAGE_KEY].newValue) : [];
    touched = true;
  }
  if (changes[HIDDEN_LOOKS_STORAGE_KEY]) {
    state.hiddenIds = Array.isArray(changes[HIDDEN_LOOKS_STORAGE_KEY].newValue) ? changes[HIDDEN_LOOKS_STORAGE_KEY].newValue : [];
    touched = true;
  }
  if (changes[ORDER_STORAGE_KEY]) {
    state.order = Array.isArray(changes[ORDER_STORAGE_KEY].newValue) ? changes[ORDER_STORAGE_KEY].newValue.map(normalizeOrderKey) : [];
    touched = true;
  }
  if (changes[PENDING_STORAGE_KEY]) {
    state.pending = Array.isArray(changes[PENDING_STORAGE_KEY].newValue) ? changes[PENDING_STORAGE_KEY].newValue : [];
    touched = true;
  }
  if (touched) {
    render();
  }
}

function render(error = "") {
  clearSelection();
  renderFilters();
  renderGrid(error);
  initMuuriGrids();
  refreshSelectionArea();
}

function renderFilters() {
  const brandCounts = new Map();
  const galleryLooks = getGalleryLooks();
  const stacks = state.stacks.filter((stack) => getLooksForStack(stack).length);

  galleryLooks.forEach((look) => {
    const brand = getBrandName(look);
    brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
  });
  stacks.forEach((stack) => {
    const stackBrands = new Set(getLooksForStack(stack).map(getBrandName));
    stackBrands.forEach((brand) => {
      brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
    });
  });
  const counts = [
    ["all", galleryLooks.length + stacks.length],
    ...Array.from(brandCounts.entries()).sort(([a], [b]) => {
      const aIndex = BRAND_ORDER.indexOf(a);
      const bIndex = BRAND_ORDER.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.POSITIVE_INFINITY : aIndex) - (bIndex === -1 ? Number.POSITIVE_INFINITY : bIndex);
      }
      return a.localeCompare(b);
    }),
  ];

  els.filters.replaceChildren(
    ...counts.map(([brand, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = state.filter === brand ? "active" : "";
      button.textContent = `${brand === "all" ? "All" : brand} ${count}`;
      button.addEventListener("click", () => {
        state.filter = brand;
        chrome.storage.local.set({ [FILTER_STORAGE_KEY]: brand });
        render();
      });
      return button;
    }),
  );
}

function renderGrid(error) {
  if (error) {
    els.grid.replaceChildren(empty(`Server unavailable: ${error}`));
    return;
  }

  const entries = getVisibleGridEntries();
  if (!entries.length) {
    els.grid.replaceChildren(empty("No looks yet. Try on visible photos from a shopping page."));
    return;
  }

  els.grid.replaceChildren(...entries.map((entry) => {
    if (entry.type === "stack") return renderStack(entry.value);
    if (entry.type === "pending") return renderPending(entry.value);
    return renderLook(entry.value);
  }));
}

function renderPending(entry) {
  const item = document.createElement("div");
  item.className = "look-item pending-item";
  item.dataset.pendingId = entry.id;

  const card = document.createElement("article");
  card.className = "look-card pending-card";

  const skeleton = document.createElement("div");
  skeleton.className = "pending-skeleton";

  const meta = document.createElement("div");
  meta.className = "look-meta";
  const label = document.createElement("span");
  label.className = "domain";
  label.textContent = getBrandForPending(entry);
  const status = document.createElement("span");
  status.className = "pending-status";
  status.textContent = "Generating";
  meta.append(label, status);

  card.append(skeleton, meta);
  item.append(card);
  return item;
}

function renderLook(look, options = {}) {
  const placement = options.placement || "gallery";
  const isStackMember = placement === "stack";
  const fragment = els.template.content.cloneNode(true);
  const item = fragment.querySelector(".look-item");
  const card = fragment.querySelector(".look-card");
  const img = fragment.querySelector("img");
  const domain = fragment.querySelector(".domain");
  const moveButton = fragment.querySelector(".move-button");
  const hideButton = fragment.querySelector(".hide-button");
  const link = fragment.querySelector("a");
  const brand = getBrandName(look);

  item.dataset.lookId = look.id;
  card.dataset.lookId = look.id;
  card.classList.toggle("is-stack-member", isStackMember);
  card.classList.toggle("drag-handle", !isStackMember);
  img.src = look.generatedUrl;
  img.alt = look.alt || look.title || "Generated try-on look";
  img.draggable = false;
  img.addEventListener("load", scheduleMuuriLayout, { once: true });
  domain.textContent = brand;
  hideButton.innerHTML = ICONS.hide;
  link.innerHTML = ICONS.open;
  hideButton.title = "Hide look";
  link.setAttribute("aria-label", "Open product page");
  link.href = look.pageUrl || look.sourceUrl;
  link.title = look.title || "Open product";
  link.draggable = false;

  if (isStackMember) {
    moveButton.innerHTML = ICONS.unstackFromCard;
    moveButton.setAttribute("aria-label", "Remove from stack");
    moveButton.title = "Remove from stack";
    moveButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeLookFromStack(options.stackId, look.id);
    });
  } else {
    moveButton.remove();
  }

  hideButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await hideLook(look.id);
  });

  card.addEventListener("click", (event) => {
    if (shouldSuppressCardOpen()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest("a,button")) {
      return;
    }
    if (!isStackMember && handleGallerySelectionClick(event, look.id)) {
      return;
    }
    chrome.tabs.create({ url: link.href });
  });

  return fragment;
}

function renderStack(stack) {
  const looks = getLooksForStack(stack);
  const item = document.createElement("div");
  const card = document.createElement("article");
  const preview = document.createElement("div");
  const meta = document.createElement("div");
  const label = document.createElement("span");
  const count = document.createElement("span");

  item.className = "look-item stack-item";
  item.dataset.stackId = stack.id;
  card.className = "look-card stack-card drag-handle";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open stack with ${looks.length} looks`);
  preview.className = "stack-preview";
  meta.className = "look-meta stack-meta";
  label.className = "domain";
  label.textContent = "Stack";
  count.className = "stack-count";
  count.textContent = `${looks.length} looks`;

  looks.slice(0, 4).forEach((look) => {
    const img = document.createElement("img");
    img.src = look.generatedUrl;
    img.alt = "";
    img.draggable = false;
    img.addEventListener("load", scheduleMuuriLayout, { once: true });
    preview.append(img);
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest("a,button")) {
      return;
    }
    if (draggingStackId === stack.id || shouldSuppressCardOpen()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openStackLayer(stack.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openStackLayer(stack.id);
    }
  });

  meta.append(label, count);
  card.append(preview, meta);
  item.append(card);
  return item;
}

function handleGallerySelectionClick(event, lookId) {
  if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
    selectedLookAnchorId = lookId;
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.shiftKey) {
    selectLookRange(lookId);
    return true;
  }

  toggleSelectedLook(lookId);
  return true;
}

function getVisibleLooks() {
  const looks = getGalleryLooks();
  return state.filter === "all" ? looks : looks.filter((look) => getBrandName(look) === state.filter);
}

function getVisibleGridEntries() {
  const lookEntries = getVisibleLooks().map((look) => ({
    key: getLookOrderKey(look.id),
    type: "look",
    value: look,
  }));
  const stackEntries = getVisibleStacks().map((stack) => ({
    key: getStackOrderKey(stack.id),
    type: "stack",
    value: stack,
  }));
  const pendingEntries = getVisiblePending().map((entry) => ({
    key: `pending:${entry.id}`,
    type: "pending",
    value: entry,
  }));
  const byKey = new Map([...lookEntries, ...stackEntries].map((entry) => [entry.key, entry]));
  const orderedEntries = state.order.map((key) => byKey.get(key)).filter(Boolean);
  const orderedKeys = new Set(orderedEntries.map((entry) => entry.key));
  const unorderedEntries = [...stackEntries, ...lookEntries].filter((entry) => !orderedKeys.has(entry.key));
  return [...pendingEntries, ...unorderedEntries, ...orderedEntries];
}

function getVisiblePending() {
  if (!Array.isArray(state.pending) || !state.pending.length) {
    return [];
  }
  if (state.filter === "all") {
    return state.pending;
  }
  return state.pending.filter((entry) => getBrandForPending(entry) === state.filter);
}

function getBrandForPending(entry) {
  return getBrandName({ domain: entry.domain, pageUrl: entry.pageUrl, sourceUrl: entry.sourceUrl });
}

function getActiveLooks() {
  const hiddenIds = new Set(state.hiddenIds);
  return state.looks.filter((look) => !hiddenIds.has(look.id));
}

function getGalleryLooks() {
  const stackedIds = getStackedLookIds();
  return getActiveLooks().filter((look) => !stackedIds.has(look.id));
}

function getVisibleStacks() {
  if (state.filter === "all") {
    return state.stacks.filter((stack) => getLooksForStack(stack).length);
  }

  return state.stacks.filter((stack) => getLooksForStack(stack).some((look) => getBrandName(look) === state.filter));
}

function getLooksForStack(stack) {
  const byId = new Map(getActiveLooks().map((look) => [look.id, look]));
  return stack.lookIds.map((id) => byId.get(id)).filter(Boolean);
}

function getStackedLookIds() {
  return new Set(state.stacks.flatMap((stack) => stack.lookIds));
}

function normalizeStacks(stacks) {
  const activeIds = new Set(getActiveLooks().map((look) => look.id));
  const claimedLookIds = new Set();
  return stacks
    .map((stack) => ({
      id: String(stack.id || ""),
      lookIds: Array.isArray(stack.lookIds)
        ? Array.from(new Set(stack.lookIds)).filter((id) => {
            if (!activeIds.has(id) || claimedLookIds.has(id)) {
              return false;
            }
            claimedLookIds.add(id);
            return true;
          })
        : [],
      createdAt: Number(stack.createdAt) || Date.now(),
    }))
    .filter((stack) => stack.id && stack.lookIds.length > 1);
}

function getBrandName(look) {
  const domain = String(look.domain || "").replace(/^www\./, "").toLowerCase();
  if (BRAND_LABELS[domain]) {
    return BRAND_LABELS[domain];
  }

  const host = safeHostname(look.pageUrl || look.sourceUrl).replace(/^www\./, "");
  if (BRAND_LABELS[host]) {
    return BRAND_LABELS[host];
  }

  return titleCase(domain || host || "Unknown");
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function titleCase(value) {
  return value
    .split(".")[0]
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function applyStoredOrder(looks) {
  if (!state.order.length) {
    return looks;
  }

  const byId = new Map(looks.map((look) => [look.id, look]));
  const ordered = state.order.map((id) => byId.get(getLookIdFromOrderKey(id))).filter(Boolean);
  const orderedIds = new Set(ordered.map((look) => look.id));
  const newLooks = looks.filter((look) => !orderedIds.has(look.id));
  return [...newLooks, ...ordered];
}

function initMuuriGrids() {
  if (typeof Muuri === "undefined") {
    els.grid.dataset.dragReady = "false";
    return;
  }

  galleryGrid?.destroy();
  sizeMuuriItems();

  const options = {
    items: ".look-item",
    dragEnabled: true,
    dragContainer: document.body,
    dragHandle: ".drag-handle",
    dragSort: () => [galleryGrid].filter(Boolean),
    dragStartPredicate: (item, event) => {
      if (event.isFinal) {
        Muuri.ItemDrag.defaultStartPredicate(item, event);
        return undefined;
      }

      if (event.srcEvent?.target?.closest("a,button,.icon-button")) {
        return false;
      }

      return Muuri.ItemDrag.defaultStartPredicate(item, event, {
        distance: 8,
        delay: 0,
      });
    },
    dragSortHeuristics: {
      sortInterval: 60,
      minDragDistance: 8,
      minBounceBackAngle: 1,
    },
    dragSortPredicate: (item, event) => {
      if (item.getElement().dataset.lookId && getStackIdAtPoint(event.clientX, event.clientY, item.getElement())) {
        return false;
      }

      return Muuri.ItemDrag.defaultSortPredicate(item, {
        threshold: 50,
        action: "move",
        migrateAction: "move",
      });
    },
    dragPlaceholder: {
      enabled: true,
      createElement: (item) => {
        const placeholder = document.createElement("div");
        placeholder.className = "look-placeholder";
        placeholder.style.width = `${item.getWidth()}px`;
        placeholder.style.height = `${item.getHeight()}px`;
        return placeholder;
      },
    },
    dragReleaseDuration: 260,
    dragReleaseEasing: "cubic-bezier(.2,.8,.2,1)",
    itemPositioningClass: "muuri-item-positioning",
    layout: {
      fillGaps: false,
      horizontal: false,
      alignRight: false,
      alignBottom: false,
      rounding: true,
    },
    layoutDuration: 280,
    layoutEasing: "cubic-bezier(.2,.8,.2,1)",
  };

  galleryGrid = new Muuri(els.grid, options);
  galleryGrid.on("dragStart", markDraggingStack);
  galleryGrid.on("dragMove", updateStackDropTarget);
  galleryGrid.on("dragEnd", queueDraggedLookStackDrop);
  galleryGrid.on("dragReleaseEnd", handleDragReleaseEnd);
  galleryGrid.on("send", scheduleMuuriSync);
  galleryGrid.on("receive", scheduleMuuriSync);
  els.grid.dataset.dragReady = "true";
  scheduleMuuriLayout();
}

function markDraggingStack(item) {
  draggingStackId = item.getElement().dataset.stackId || "";
  if (draggingStackId) {
    suppressCardOpen();
  }
}

function updateStackDropTarget(item, event) {
  const lookId = item.getElement().dataset.lookId;
  if (!lookId || !isGalleryLookId(lookId)) {
    clearStackDropTarget();
    return;
  }

  setStackDropTarget(getStackIdAtPoint(event.clientX, event.clientY, item.getElement()));
}

function queueDraggedLookStackDrop(item, event) {
  if (item.getElement().dataset.stackId) {
    draggingStackId = "";
    suppressCardOpen();
    clearStackDropTarget();
    return;
  }

  const lookId = item.getElement().dataset.lookId;
  const stackId = getStackIdAtPoint(event.clientX, event.clientY, item.getElement()) || dragStackTargetId;
  clearStackDropTarget();

  if (!lookId || !stackId || !isGalleryLookId(lookId)) {
    return;
  }

  pendingStackDrop = {
    itemElement: item.getElement(),
    lookIds: getDraggedLookIds(lookId),
    stackId,
  };
  pendingStackDrop.itemElement.classList.add("is-stack-drop-committing");
  suppressCardOpen();
}

async function handleDragReleaseEnd() {
  if (draggingStackId) {
    draggingStackId = "";
    scheduleMuuriSync();
    return;
  }

  if (!pendingStackDrop) {
    scheduleMuuriSync();
    return;
  }

  const stackDrop = pendingStackDrop;
  pendingStackDrop = null;
  window.setTimeout(async () => {
    stackDrop.itemElement?.classList.remove("is-stack-drop-committing");
    await addLooksToStack(stackDrop.stackId, stackDrop.lookIds);
  }, 0);
}

function suppressCardOpen() {
  suppressNextCardOpen = true;
  window.clearTimeout(suppressCardOpenTimer);
  suppressCardOpenTimer = window.setTimeout(() => {
    suppressNextCardOpen = false;
  }, 180);
}

function shouldSuppressCardOpen() {
  if (!suppressNextCardOpen) {
    return false;
  }

  suppressNextCardOpen = false;
  window.clearTimeout(suppressCardOpenTimer);
  return true;
}

function getDraggedLookIds(lookId) {
  if (selectedLookIds.includes(lookId)) {
    return selectedLookIds.filter(isGalleryLookId);
  }
  return [lookId];
}

function getStackIdAtPoint(clientX, clientY, draggedElement) {
  if (typeof clientX !== "number" || typeof clientY !== "number") {
    return "";
  }

  return (
    document
      .elementsFromPoint(clientX, clientY)
      .find((element) => {
        const stackItem = element.closest?.(".stack-item[data-stack-id]");
        return stackItem && stackItem !== draggedElement;
      })
      ?.closest(".stack-item[data-stack-id]")
      ?.dataset.stackId || ""
  );
}

function setStackDropTarget(stackId) {
  if (dragStackTargetId === stackId) {
    return;
  }

  clearStackDropTarget();
  dragStackTargetId = stackId;
  if (dragStackTargetId) {
    els.grid.querySelector(`.stack-item[data-stack-id="${cssEscape(dragStackTargetId)}"]`)?.classList.add("is-stack-drop-target");
  }
}

function clearStackDropTarget() {
  if (!dragStackTargetId) {
    return;
  }

  els.grid.querySelector(`.stack-item[data-stack-id="${cssEscape(dragStackTargetId)}"]`)?.classList.remove("is-stack-drop-target");
  dragStackTargetId = "";
}

function scheduleMuuriSync() {
  window.clearTimeout(pendingMuuriSync);
  pendingMuuriSync = window.setTimeout(syncLayoutFromMuuri, 80);
}

async function syncLayoutFromMuuri() {
  const galleryEntries = getOrderKeysFromGrid(galleryGrid);
  const galleryIds = galleryEntries.map(getLookIdFromOrderKey).filter(Boolean);
  state.order = mergeGridOrder(galleryEntries);
  mergeGalleryOrder(galleryIds);
  renderFilters();
  await persistOrder(false);
}

function getLookIdsFromGrid(grid) {
  if (!grid) {
    return [];
  }

  return Array.from(grid.getElement().querySelectorAll(".look-item"))
    .map((element) => element.dataset.lookId)
    .filter(Boolean);
}

function getOrderKeysFromGrid(grid) {
  if (!grid) {
    return [];
  }

  return Array.from(grid.getElement().querySelectorAll(".look-item"))
    .map((element) => {
      if (element.dataset.stackId) {
        return getStackOrderKey(element.dataset.stackId);
      }
      if (element.dataset.lookId) {
        return getLookOrderKey(element.dataset.lookId);
      }
      return "";
    })
    .filter(Boolean);
}

function sizeMuuriItems() {
  const minWidth = 230;
  const gap = 18;
  const gridWidth = els.grid.clientWidth;
  const columns = Math.max(1, Math.floor((gridWidth + gap) / (minWidth + gap)));
  const itemWidth = Math.floor((gridWidth - gap * (columns - 1)) / columns);
  els.grid.querySelectorAll(".look-item").forEach((item) => {
    item.style.width = `${itemWidth}px`;
  });
}

function scheduleMuuriLayout() {
  window.clearTimeout(pendingMuuriLayout);
  pendingMuuriLayout = window.setTimeout(() => {
    sizeMuuriItems();
    galleryGrid?.refreshItems().layout();
  }, 60);
}

function initSelectionArea() {
  if (typeof SelectionArea === "undefined" || selectionArea) {
    return;
  }

  selectionArea = new SelectionArea({
    container: "body",
    selectables: ["#grid .look-item[data-look-id]"],
    startareas: ["#grid"],
    boundaries: ["main"],
    behaviour: {
      overlap: "keep",
      intersect: "touch",
      startThreshold: 8,
      triggers: [0],
    },
    features: {
      range: false,
      deselectOnBlur: false,
      singleTap: {
        allow: false,
      },
    },
  });

  selectionArea
    .on("beforestart", ({ event }) => {
      if (event?.target?.closest("a,button,.look-card,.stack-layer")) {
        return false;
      }
      return true;
    })
    .on("start", () => {
      clearSelection({ keepLibrary: true });
    })
    .on("move", ({ store }) => {
      setSelectedLookIds(store.selected.map((item) => item.dataset.lookId).filter(Boolean));
    })
    .on("stop", ({ store }) => {
      setSelectedLookIds(store.selected.map((item) => item.dataset.lookId).filter(Boolean));
    });

  refreshSelectionArea();
}

function refreshSelectionArea() {
  selectionArea?.resolveSelectables();
}

function setSelectedLookIds(lookIds) {
  selectedLookIds = Array.from(new Set(lookIds));
  if (selectedLookIds.length) {
    selectedLookAnchorId = selectedLookIds[selectedLookIds.length - 1];
  }
  const selectedIds = new Set(selectedLookIds);
  els.grid.querySelectorAll(".look-item[data-look-id]").forEach((item) => {
    item.classList.toggle("is-marquee-selected", selectedIds.has(item.dataset.lookId));
  });
  updateSelectionAction();
}

function clearSelection(options = {}) {
  selectedLookIds = [];
  selectedLookAnchorId = "";
  els.grid.querySelectorAll(".is-marquee-selected").forEach((item) => item.classList.remove("is-marquee-selected"));
  els.selectionAction.hidden = true;
  if (!options.keepLibrary) {
    selectionArea?.clearSelection();
  }
}

function toggleSelectedLook(lookId) {
  const nextIds = selectedLookIds.includes(lookId) ? selectedLookIds.filter((id) => id !== lookId) : [...selectedLookIds, lookId];
  selectedLookAnchorId = lookId;
  setSelectedLookIds(nextIds);
  selectionArea?.clearSelection(true, true);
}

function selectLookRange(lookId) {
  const visibleLookIds = getVisibleSelectableLookIds();
  const anchorId = selectedLookAnchorId && visibleLookIds.includes(selectedLookAnchorId) ? selectedLookAnchorId : lookId;
  const anchorIndex = visibleLookIds.indexOf(anchorId);
  const lookIndex = visibleLookIds.indexOf(lookId);

  if (anchorIndex === -1 || lookIndex === -1) {
    setSelectedLookIds([lookId]);
    return;
  }

  const [start, end] = anchorIndex < lookIndex ? [anchorIndex, lookIndex] : [lookIndex, anchorIndex];
  setSelectedLookIds(visibleLookIds.slice(start, end + 1));
  selectionArea?.clearSelection(true, true);
}

function getVisibleSelectableLookIds() {
  return Array.from(els.grid.querySelectorAll(".look-item[data-look-id]"))
    .map((item) => item.dataset.lookId)
    .filter(Boolean);
}

function isGalleryLookId(lookId) {
  return getGalleryLooks().some((look) => look.id === lookId);
}

function updateSelectionAction() {
  if (selectedLookIds.length < 2) {
    els.selectionAction.hidden = true;
    return;
  }

  els.selectionCount.textContent = `${selectedLookIds.length} selected`;
  els.selectionAction.hidden = false;
  positionSelectionAction();
}

function positionSelectionAction() {
  if (els.selectionAction.hidden || !selectedLookIds.length) {
    return;
  }

  const selectedIds = new Set(selectedLookIds);
  const rects = Array.from(els.grid.querySelectorAll(".look-item[data-look-id] .look-card"))
    .filter((card) => selectedIds.has(card.closest(".look-item")?.dataset.lookId))
    .map((card) => card.getBoundingClientRect());

  if (!rects.length) {
    els.selectionAction.hidden = true;
    return;
  }

  const bounds = rects.reduce(
    (next, rect) => ({
      left: Math.min(next.left, rect.left),
      top: Math.min(next.top, rect.top),
      right: Math.max(next.right, rect.right),
    }),
    { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: 0 },
  );
  const actionRect = els.selectionAction.getBoundingClientRect();
  const x = Math.min(window.innerWidth - actionRect.width - 14, Math.max(14, bounds.right - actionRect.width));
  const y = Math.max(14, bounds.top - actionRect.height - 12);
  els.selectionAction.style.left = `${x}px`;
  els.selectionAction.style.top = `${y}px`;
}

async function createStackFromSelection() {
  const lookIds = selectedLookIds.filter((id) => getGalleryLooks().some((look) => look.id === id));
  if (lookIds.length < 2) {
    clearSelection();
    return;
  }

  const stack = {
    id: `stack-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    lookIds,
    createdAt: Date.now(),
  };

  state.stacks = [stack, ...state.stacks];
  replaceLookOrderWithStack(lookIds, stack.id);
  clearSelection();
  render();
  await persistOrder(false);
  await persistStacks();
}

async function addLooksToStack(stackId, lookIds) {
  const stack = state.stacks.find((candidate) => candidate.id === stackId);
  if (!stack) {
    return;
  }

  const nextLookIds = Array.from(new Set([...stack.lookIds, ...lookIds.filter(isGalleryLookId)]));
  if (nextLookIds.length === stack.lookIds.length) {
    return;
  }

  stack.lookIds = nextLookIds;
  removeLookIdsFromOrder(lookIds);
  clearSelection();
  render();
  await persistOrder(false);
  await persistStacks();
}

function openStackLayer(stackId) {
  state.activeStackId = stackId;
  chrome.storage.local.set({ [ACTIVE_STACK_STORAGE_KEY]: stackId });
  renderStackLayer();
}

function closeStackLayer() {
  if (!state.activeStackId && els.stackLayer.hidden) {
    return;
  }

  state.activeStackId = "";
  chrome.storage.local.set({ [ACTIVE_STACK_STORAGE_KEY]: "" });
  delete els.stackLayer.dataset.stackId;
  delete els.unstackButton.dataset.stackId;
  els.stackLayer.hidden = true;
  els.stackGrid.replaceChildren();
}

function renderStackLayer() {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  if (!stack) {
    closeStackLayer();
    return;
  }

  const looks = getLooksForStack(stack);
  if (!looks.length) {
    closeStackLayer();
    return;
  }

  els.stackTitle.textContent = "Stack";
  els.stackCount.textContent = `${looks.length} looks`;
  els.stackGrid.replaceChildren(...looks.map((look) => renderLook(look, { placement: "stack", stackId: stack.id })));
  els.stackLayer.dataset.stackId = stack.id;
  els.unstackButton.dataset.stackId = stack.id;
  els.stackLayer.hidden = false;
}

async function unstackActiveStack(event) {
  event?.preventDefault();
  event?.stopPropagation();
  event?.stopImmediatePropagation();

  if (unstackInFlight) {
    return;
  }

  const activeStack = getOpenStack(event?.currentTarget?.dataset.stackId);
  if (!activeStack) {
    return;
  }

  unstackInFlight = true;
  const activeLookIds = new Set(activeStack.lookIds);
  const stacksToUnstack = state.stacks.filter(
    (stack) => stack.id === activeStack.id || stack.lookIds.some((lookId) => activeLookIds.has(lookId)),
  );
  const stackIdsToUnstack = new Set(stacksToUnstack.map((stack) => stack.id));

  try {
    state.activeStackId = activeStack.id;
    els.stackLayer.dataset.stackId = activeStack.id;
    els.unstackButton.dataset.stackId = activeStack.id;
    state.stacks = state.stacks.filter((stack) => !stackIdsToUnstack.has(stack.id));
    stacksToUnstack.forEach(expandStackInOrder);
    closeStackLayer();
    render();
    await persistOrder(false);
    await persistStacks();
  } finally {
    unstackInFlight = false;
  }
}

function getOpenStack(preferredStackId = "") {
  const stackIds = [preferredStackId, state.activeStackId, els.stackLayer.dataset.stackId].filter(Boolean);
  for (const stackId of stackIds) {
    const stackById = state.stacks.find((stack) => stack.id === stackId);
    if (stackById) {
      return stackById;
    }
  }

  const layerLookIds = Array.from(els.stackGrid.querySelectorAll(".look-item[data-look-id]"))
    .map((item) => item.dataset.lookId)
    .filter(Boolean);
  if (layerLookIds.length) {
    const layerLookIdSet = new Set(layerLookIds);
    const stackByVisibleLooks = state.stacks.find(
      (stack) => stack.lookIds.length === layerLookIds.length && stack.lookIds.every((lookId) => layerLookIdSet.has(lookId)),
    );
    if (stackByVisibleLooks) {
      return stackByVisibleLooks;
    }
  }

  return null;
}

async function removeLookFromStack(stackId, lookId) {
  const stack = state.stacks.find((candidate) => candidate.id === stackId);
  if (!stack) {
    return;
  }

  const nextLookIds = stack.lookIds.filter((id) => id !== lookId);
  if (nextLookIds.length < 2) {
    state.stacks = state.stacks.filter((candidate) => candidate.id !== stackId);
    expandStackInOrder(stack);
    closeStackLayer();
  } else {
    stack.lookIds = nextLookIds;
    const stackOrderKey = getStackOrderKey(stackId);
    const lookOrderKey = getLookOrderKey(lookId);
    state.order = state.order.filter((key) => key !== lookOrderKey);
    const stackIndex = state.order.indexOf(stackOrderKey);
    if (stackIndex !== -1) {
      state.order.splice(stackIndex + 1, 0, lookOrderKey);
    } else {
      state.order.push(lookOrderKey);
    }
  }

  render();
  if (state.activeStackId) {
    renderStackLayer();
  }
  await persistOrder(false);
  await persistStacks();
}

function mergeGalleryOrder(galleryIds) {
  const byId = new Map(state.looks.map((look) => [look.id, look]));
  const galleryIdSet = new Set(galleryIds);
  const orderedGalleryLooks = galleryIds.map((id) => byId.get(id)).filter(Boolean);

  if (state.filter === "all") {
    const remainingLooks = state.looks.filter((look) => !galleryIdSet.has(look.id));
    state.looks = [...orderedGalleryLooks, ...remainingLooks];
    return;
  }

  let nextIndex = 0;
  state.looks = state.looks.map((look) => {
    if (!galleryIdSet.has(look.id)) {
      return look;
    }
    const nextLook = orderedGalleryLooks[nextIndex];
    nextIndex += 1;
    return nextLook || look;
  });
}

function mergeGridOrder(galleryEntries) {
  const activeLookIds = new Set(getActiveLooks().map((look) => look.id));
  const activeStackIds = new Set(state.stacks.map((stack) => stack.id));
  const visibleKeys = new Set([
    ...getActiveLooks()
      .filter((look) => !getStackedLookIds().has(look.id))
      .map((look) => getLookOrderKey(look.id)),
    ...state.stacks.map((stack) => getStackOrderKey(stack.id)),
  ]);
  const galleryKeySet = new Set(galleryEntries);
  const validExistingKeys = state.order.filter((key) => {
    if (galleryKeySet.has(key)) {
      return false;
    }
    if (key.startsWith("stack:")) {
      return activeStackIds.has(key.slice(6));
    }
    const lookId = getLookIdFromOrderKey(key);
    return activeLookIds.has(lookId) && (visibleKeys.has(getLookOrderKey(lookId)) || getStackedLookIds().has(lookId));
  });
  return [...galleryEntries, ...validExistingKeys];
}

async function persistOrder(syncFromLooks = true) {
  if (syncFromLooks) {
    state.order = state.looks.map((look) => getLookOrderKey(look.id));
  }
  await chrome.storage.local.set({ [ORDER_STORAGE_KEY]: state.order });
}

function getLookOrderKey(lookId) {
  return `look:${lookId}`;
}

function getStackOrderKey(stackId) {
  return `stack:${stackId}`;
}

function getLookIdFromOrderKey(key) {
  return String(key || "").startsWith("look:") ? String(key).slice(5) : key;
}

function normalizeOrderKey(key) {
  const value = String(key || "");
  return value.startsWith("look:") || value.startsWith("stack:") ? value : getLookOrderKey(value);
}

function replaceLookOrderWithStack(lookIds, stackId) {
  const selectedKeys = new Set(lookIds.map(getLookOrderKey));
  const nextOrder = [];
  let insertedStack = false;

  state.order.forEach((key) => {
    if (!selectedKeys.has(key)) {
      nextOrder.push(key);
      return;
    }

    if (!insertedStack) {
      nextOrder.push(getStackOrderKey(stackId));
      insertedStack = true;
    }
  });

  if (!insertedStack) {
    nextOrder.unshift(getStackOrderKey(stackId));
  }

  state.order = nextOrder;
}

function expandStackInOrder(stack) {
  const stackKey = getStackOrderKey(stack.id);
  const lookKeys = stack.lookIds.map(getLookOrderKey);
  const lookKeySet = new Set(lookKeys);
  const nextOrder = [];
  let insertedLooks = false;

  state.order.forEach((key) => {
    if (lookKeySet.has(key)) {
      return;
    }

    if (key === stackKey) {
      if (!insertedLooks) {
        nextOrder.push(...lookKeys);
      }
      insertedLooks = true;
      return;
    }

    nextOrder.push(key);
  });

  if (!insertedLooks) {
    nextOrder.push(...lookKeys);
  }

  state.order = nextOrder;
}

function removeLookIdsFromOrder(lookIds) {
  const lookKeys = new Set(lookIds.map(getLookOrderKey));
  state.order = state.order.filter((key) => !lookKeys.has(key));
}

async function hideLook(lookId) {
  if (!state.hiddenIds.includes(lookId)) {
    state.hiddenIds = [...state.hiddenIds, lookId];
  }
  state.stacks = normalizeStacks(state.stacks);
  state.order = state.order.filter((key) => {
    if (key === getLookOrderKey(lookId)) {
      return false;
    }
    if (key.startsWith("stack:")) {
      return state.stacks.some((stack) => getStackOrderKey(stack.id) === key);
    }
    return true;
  });
  if (state.activeStackId && !state.stacks.some((stack) => stack.id === state.activeStackId)) {
    closeStackLayer();
  }
  render();
  if (state.activeStackId) {
    renderStackLayer();
  }
  await persistLookVisibility();
  await persistOrder(false);
  await persistStacks();
}

async function persistLookVisibility() {
  await chrome.storage.local.set({
    [HIDDEN_LOOKS_STORAGE_KEY]: state.hiddenIds,
  });
}

async function persistStacks() {
  state.stacks = normalizeStacks(state.stacks);
  await chrome.storage.local.set({ [STACKS_STORAGE_KEY]: state.stacks });
}

function debounce(callback, wait) {
  let timeout = 0;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), wait);
  };
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

function empty(message) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = message;
  return node;
}
