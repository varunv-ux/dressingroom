const LOOKS_STORAGE_KEY = "dressingRoomLooks";
const ORDER_STORAGE_KEY = "dressingRoomLookOrder";
const SIDE_RAIL_STORAGE_KEY = "dressingRoomSideRail";
const HIDDEN_LOOKS_STORAGE_KEY = "dressingRoomHiddenLooks";
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
  stack:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7.8 12 5l5 2.8-5 2.8-5-2.8Z"/><path d="m7 12 5 2.8 5-2.8"/><path d="m7 16.2 5 2.8 5-2.8"/></svg>',
  railIn:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h9"/><path d="M4 12h13"/><path d="M4 19h9"/><path d="m16 8 4 4-4 4"/></svg>',
  railOut:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h9"/><path d="M7 12h13"/><path d="M11 19h9"/><path d="m8 8-4 4 4 4"/></svg>',
  hide:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M4 7h16"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>',
};

const els = {
  main: document.querySelector("main"),
  railToggle: document.querySelector("#railToggle"),
  filters: document.querySelector("#filters"),
  grid: document.querySelector("#grid"),
  railCount: document.querySelector("#railCount"),
  railGrid: document.querySelector("#railGrid"),
  template: document.querySelector("#lookTemplate"),
};

let state = {
  looks: [],
  order: [],
  sideRailIds: [],
  hiddenIds: [],
  railOpen: false,
  filter: "all",
};

let galleryGrid = null;
let railGrid = null;
let pendingMuuriSync = 0;
let pendingMuuriLayout = 0;

init();

async function init() {
  const saved = await chrome.storage.local.get([
    LOOKS_STORAGE_KEY,
    ORDER_STORAGE_KEY,
    SIDE_RAIL_STORAGE_KEY,
    HIDDEN_LOOKS_STORAGE_KEY,
  ]);
  state.order = Array.isArray(saved[ORDER_STORAGE_KEY]) ? saved[ORDER_STORAGE_KEY] : [];
  state.looks = applyStoredOrder(Array.isArray(saved[LOOKS_STORAGE_KEY]) ? saved[LOOKS_STORAGE_KEY] : []);
  state.sideRailIds = Array.isArray(saved[SIDE_RAIL_STORAGE_KEY]) ? saved[SIDE_RAIL_STORAGE_KEY] : [];
  state.hiddenIds = Array.isArray(saved[HIDDEN_LOOKS_STORAGE_KEY]) ? saved[HIDDEN_LOOKS_STORAGE_KEY] : [];
  els.railToggle.addEventListener("click", () => {
    state.railOpen = !state.railOpen;
    renderRailToggle();
    renderRail();
    initMuuriGrids();
  });
  window.addEventListener("resize", debounce(() => {
    sizeMuuriItems();
    galleryGrid?.refreshItems().layout();
    railGrid?.refreshItems().layout();
  }, 120));

  render();
}

function render(error = "") {
  renderRailToggle();
  renderFilters();
  renderGrid(error);
  renderRail();
  initMuuriGrids();
}

function renderFilters() {
  const brandCounts = new Map();
  getGalleryLooks().forEach((look) => {
    const brand = getBrandName(look);
    brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
  });
  const counts = [
    ["all", getGalleryLooks().length],
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

  const looks = getVisibleLooks();
  if (!looks.length) {
    els.grid.replaceChildren(empty("No looks yet. Try on visible photos from a shopping page."));
    return;
  }

  els.grid.replaceChildren(...looks.map(renderLook));
}

function renderRail() {
  const railLooks = getRailLooks();
  els.railCount.textContent = String(railLooks.length);
  els.main.classList.toggle("rail-open", state.railOpen);

  if (!railLooks.length) {
    const node = document.createElement("p");
    node.className = "rail-empty";
    node.textContent = "No saved side looks";
    els.railGrid.replaceChildren(node);
    return;
  }

  els.railGrid.replaceChildren(...railLooks.map((look) => renderLook(look, { placement: "rail" })));
}

function renderRailToggle() {
  const railLooks = getRailLooks();
  els.railToggle.setAttribute("aria-expanded", String(state.railOpen));
  els.railToggle.setAttribute("aria-label", state.railOpen ? "Close side rail" : "Open side rail");

  if (!railLooks.length) {
    els.railToggle.innerHTML = ICONS.stack;
    return;
  }

  const stack = document.createElement("span");
  stack.className = "rail-stack";
  railLooks.slice(-3).forEach((look) => {
    const img = document.createElement("img");
    img.src = look.generatedUrl;
    img.alt = "";
    stack.append(img);
  });

  els.railToggle.replaceChildren(stack);
  if (railLooks.length > 3) {
    const badge = document.createElement("span");
    badge.className = "rail-badge";
    badge.textContent = String(railLooks.length);
    els.railToggle.append(badge);
  }
}

function renderLook(look, options = {}) {
  const placement = options.placement || "gallery";
  const isRail = placement === "rail";
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
  card.classList.toggle("is-rail", isRail);
  img.src = look.generatedUrl;
  img.alt = look.alt || look.title || "Generated try-on look";
  img.draggable = false;
  img.addEventListener("load", scheduleMuuriLayout, { once: true });
  domain.textContent = brand;
  moveButton.innerHTML = isRail ? ICONS.railOut : ICONS.railIn;
  hideButton.innerHTML = ICONS.hide;
  link.innerHTML = ICONS.open;
  moveButton.setAttribute("aria-label", isRail ? "Move back to gallery" : "Move to side rail");
  moveButton.title = isRail ? "Move back" : "Move to side";
  hideButton.title = "Hide look";
  link.setAttribute("aria-label", "Open product page");
  link.href = look.pageUrl || look.sourceUrl;
  link.title = look.title || "Open product";
  link.draggable = false;

  moveButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (isRail) {
      await moveLookToGallery(look.id);
      return;
    }
    await moveLookToRail(look.id, img);
  });

  hideButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await hideLook(look.id);
  });

  if (isRail) {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a,button")) {
        return;
      }
      chrome.tabs.create({ url: link.href });
    });
    return fragment;
  }

  card.addEventListener("click", (event) => {
    if (event.target.closest("a,button")) {
      return;
    }
    chrome.tabs.create({ url: link.href });
  });

  return fragment;
}

function getVisibleLooks() {
  const looks = getGalleryLooks();
  return state.filter === "all" ? looks : looks.filter((look) => getBrandName(look) === state.filter);
}

function getActiveLooks() {
  const hiddenIds = new Set(state.hiddenIds);
  return state.looks.filter((look) => !hiddenIds.has(look.id));
}

function getGalleryLooks() {
  const railIds = new Set(state.sideRailIds);
  return getActiveLooks().filter((look) => !railIds.has(look.id));
}

function getRailLooks() {
  const byId = new Map(getActiveLooks().map((look) => [look.id, look]));
  return state.sideRailIds.map((id) => byId.get(id)).filter(Boolean);
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
  const ordered = state.order.map((id) => byId.get(id)).filter(Boolean);
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
  railGrid?.destroy();
  sizeMuuriItems();

  const options = {
    items: ".look-item",
    dragEnabled: true,
    dragContainer: document.body,
    dragHandle: ".look-card",
    dragSort: () => [galleryGrid, railGrid].filter(Boolean),
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
  railGrid = new Muuri(els.railGrid, options);
  [galleryGrid, railGrid].forEach((grid) => {
    grid.on("dragReleaseEnd", scheduleMuuriSync);
    grid.on("send", scheduleMuuriSync);
    grid.on("receive", scheduleMuuriSync);
  });
  els.grid.dataset.dragReady = "true";
  els.railGrid.dataset.dragReady = "true";
}

function scheduleMuuriSync() {
  window.clearTimeout(pendingMuuriSync);
  pendingMuuriSync = window.setTimeout(syncLayoutFromMuuri, 80);
}

async function syncLayoutFromMuuri() {
  const galleryIds = getLookIdsFromGrid(galleryGrid);
  const railIds = getLookIdsFromGrid(railGrid);
  state.sideRailIds = railIds;
  mergeGalleryOrder(galleryIds);
  renderFilters();
  renderRailToggle();
  els.railCount.textContent = String(railIds.length);
  await persistOrder();
  await persistLookVisibility();
}

function getLookIdsFromGrid(grid) {
  if (!grid) {
    return [];
  }

  return grid
    .getItems()
    .map((item) => item.getElement().dataset.lookId)
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
  els.railGrid.querySelectorAll(".look-item").forEach((item) => {
    item.style.width = "100%";
  });
}

function scheduleMuuriLayout() {
  window.clearTimeout(pendingMuuriLayout);
  pendingMuuriLayout = window.setTimeout(() => {
    sizeMuuriItems();
    galleryGrid?.refreshItems().layout();
    railGrid?.refreshItems().layout();
  }, 60);
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

async function persistOrder() {
  state.order = state.looks.map((look) => look.id);
  await chrome.storage.local.set({ [ORDER_STORAGE_KEY]: state.order });
}

async function moveLookToRail(lookId, sourceImage) {
  if (!state.sideRailIds.includes(lookId)) {
    await animateLookToRail(sourceImage);
    state.sideRailIds = [...state.sideRailIds, lookId];
  }
  render();
  await persistLookVisibility();
}

async function moveLookToGallery(lookId) {
  state.sideRailIds = state.sideRailIds.filter((id) => id !== lookId);
  render();
  await persistLookVisibility();
}

async function hideLook(lookId) {
  if (!state.hiddenIds.includes(lookId)) {
    state.hiddenIds = [...state.hiddenIds, lookId];
  }
  state.sideRailIds = state.sideRailIds.filter((id) => id !== lookId);
  render();
  await persistLookVisibility();
}

async function persistLookVisibility() {
  await chrome.storage.local.set({
    [SIDE_RAIL_STORAGE_KEY]: state.sideRailIds,
    [HIDDEN_LOOKS_STORAGE_KEY]: state.hiddenIds,
  });
}

async function animateLookToRail(sourceImage) {
  if (!sourceImage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const sourceRect = sourceImage.getBoundingClientRect();
  const targetRect = els.railToggle.getBoundingClientRect();
  const clone = sourceImage.cloneNode();
  clone.className = "fly-to-rail";
  clone.style.left = `${sourceRect.left}px`;
  clone.style.top = `${sourceRect.top}px`;
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  document.body.append(clone);

  const targetScale = Math.min(0.18, targetRect.width / sourceRect.width);
  const targetX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const targetY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);

  await clone
    .animate(
      [
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        { opacity: 0.94, transform: `translate3d(${targetX * 0.78}px, ${targetY * 0.78 - 18}px, 0) scale(0.34)` },
        { opacity: 0, transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(${targetScale})` },
      ],
      {
        duration: 520,
        easing: "cubic-bezier(.2,.8,.2,1)",
      },
    )
    .finished.catch(() => {});

  clone.remove();
}

function debounce(callback, wait) {
  let timeout = 0;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), wait);
  };
}

function empty(message) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = message;
  return node;
}
