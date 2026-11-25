const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      names.forEach((n) => set.add(n));
    },
    remove(...names) {
      names.forEach((n) => set.delete(n));
    },
    contains(name) {
      return set.has(name);
    },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) {
          set.delete(name);
          return false;
        }
        set.add(name);
        return true;
      }
      if (force) set.add(name);
      else set.delete(name);
      return force;
    },
    [Symbol.iterator]() {
      return set[Symbol.iterator]();
    },
    get length() {
      return set.size;
    },
  };
}

function createElement({
  tagName,
  id = "",
  textContent = "",
  dataset = {},
  classes = [],
  attrs = {},
  value = "",
  disabled = false,
  checked = false,
  indeterminate = false,
  parentNode = null,
  children = [],
}) {
  const attributes = new Map(Object.entries(attrs));
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id,
    textContent,
    dataset,
    classList: createClassList(classes),
    value,
    disabled,
    checked,
    indeterminate,
    open: false,
    parentNode,
    children,
    setAttribute(name, val) {
      attributes.set(name, String(val));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
      this.textContent = nodes.map((n) => (typeof n === "string" ? n : n.textContent || "")).join("");
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    matches(selector) {
      if (selector === "[data-action]") return Boolean(this.dataset && this.dataset.action);
      if (selector === "button") return this.tagName === "BUTTON";
      if (selector === "a") return this.tagName === "A";
      if (selector === "nav") return this.tagName === "NAV";
      if (selector === "tr") return this.tagName === "TR";
      if (selector === "th") return this.tagName === "TH";
      if (selector === "thead") return this.tagName === "THEAD";
      if (selector === "th[aria-sort]") return this.tagName === "TH" && this.hasAttribute("aria-sort");
      if (selector === "[role='tab'], a, button") {
        return this.getAttribute("role") === "tab" || this.tagName === "A" || this.tagName === "BUTTON";
      }
      if (selector === ".bulk-delete-label") return this.classList.contains("bulk-delete-label");
      return false;
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const found = child.querySelector ? child.querySelector(selector) : null;
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      for (const child of this.children) {
        if (child.matches(selector)) results.push(child);
        if (child.querySelectorAll) results.push(...child.querySelectorAll(selector));
      }
      return results;
    },
    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
  };
  children.forEach((c) => {
    c.parentNode = el;
  });
  return el;
}

function loadMainScript(options = {}) {
  const listeners = { document: {}, body: {}, window: {} };
  const htmxTriggers = [];
  const htmxAjaxCalls = [];

  const totalInput = createElement({ tagName: "input", id: "total", value: String(options.total ?? 23) });
  const limitInput = createElement({ tagName: "input", id: "limit", value: "10" });
  const skipInput = createElement({ tagName: "input", id: "skip", value: String(options.skip ?? 10) });
  const sortInput = createElement({ tagName: "input", id: "sort", value: "created_at" });
  const orderInput = createElement({ tagName: "input", id: "order", value: "desc" });

  // Single bottom pagination footer
  const footNav = {
    btn10: createElement({ tagName: "button", textContent: "10", classes: ["active"], attrs: { "aria-pressed": "true" }, dataset: { action: "set-limit" } }),
    btn20: createElement({ tagName: "button", textContent: "20", attrs: { "aria-pressed": "false" }, dataset: { action: "set-limit" } }),
    btn50: createElement({ tagName: "button", textContent: "50", attrs: { "aria-pressed": "false" }, dataset: { action: "set-limit" } }),
    prev: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "prev" }, disabled: false }),
    next: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "next" }, disabled: false }),
  };

  const tableFooter = createElement({ tagName: "div", classes: ["table-footer", "hidden"] });
  const paginationInfo = createElement({ tagName: "span", id: "pagination-info" });
  const totalBadge = createElement({ tagName: "span", id: "links-total-badge", classes: ["hidden"] });

  const limitButtons = [footNav.btn10, footNav.btn20, footNav.btn50];
  const prevButtons = [footNav.prev];
  const nextButtons = [footNav.next];

  // Sortable headers
  const sortCreatedBtn = createElement({ tagName: "button", textContent: "Created at", dataset: { action: "sort-links", sort: "created_at" } });
  const sortViewsBtn = createElement({ tagName: "button", textContent: "Views", dataset: { action: "sort-links", sort: "views" } });
  const sortUrlBtn = createElement({ tagName: "button", textContent: "Original URL", dataset: { action: "sort-links", sort: "target" } });
  const thCreated = createElement({ tagName: "th", attrs: { "aria-sort": "descending" }, children: [sortCreatedBtn] });
  const thViews = createElement({ tagName: "th", children: [sortViewsBtn] });
  const thUrl = createElement({ tagName: "th", children: [sortUrlBtn] });
  const thead = createElement({ tagName: "thead", children: [createElement({ tagName: "tr", children: [thUrl, thViews, thCreated] })] });

  const tabLinks = createElement({ tagName: "button", id: "tab-links", attrs: { role: "tab", "aria-selected": "true" }, dataset: { action: "set-tab" }, classes: ["active"] });
  const tabUsers = createElement({ tagName: "button", id: "tab-users", attrs: { role: "tab", "aria-selected": "false" }, dataset: { action: "set-tab" } });
  const tabDomains = createElement({ tagName: "button", id: "tab-domains", attrs: { role: "tab", "aria-selected": "false" }, dataset: { action: "set-tab" } });
  const tabNav = createElement({ tagName: "nav", children: [tabLinks, tabUsers, tabDomains] });

  const searchInput = createElement({ tagName: "input", id: "search", value: "" });
  const filterDomainSelect = createElement({ tagName: "select", id: "filter-domain", value: "", dataset: { action: "filter-domain" } });
  const selectAllCheckbox = createElement({ tagName: "input", id: "select-all-links-checkbox", dataset: { action: "toggle-select-all-links-checkbox" }, disabled: true });
  const bulkSelectedCount = createElement({ tagName: "span", id: "bulk-selected-count", textContent: "0 selected" });
  const bulkDeleteLabel = createElement({ tagName: "span", textContent: "Delete selected", classes: ["bulk-delete-label"] });
  const bulkDeleteBtn = createElement({ tagName: "button", id: "bulk-delete-links-btn", classes: ["hidden"], dataset: { action: "open-bulk-delete" }, children: [bulkDeleteLabel] });
  const bulkActionBar = createElement({ tagName: "div", id: "bulk-action-bar", classes: ["hidden"], children: [bulkSelectedCount, bulkDeleteBtn] });
  const bannerText = createElement({ tagName: "span", id: "bulk-select-banner-text" });
  const bannerAction = createElement({ tagName: "button", id: "bulk-select-banner-action", dataset: { action: "select-all-matching" } });
  const banner = createElement({ tagName: "div", id: "bulk-select-banner", classes: ["hidden"], children: [bannerText, bannerAction] });
  const linkDialog = createElement({ tagName: "dialog", id: "link-dialog", classes: ["dialog"], attrs: { closedby: "any" } });

  let linkCheckboxes = [];
  function setVisibleLinkIds(ids) {
    linkCheckboxes = ids.map((uuid) => {
      const cb = createElement({ tagName: "input", value: uuid, classes: ["link-select-checkbox"], dataset: { action: "toggle-select-link" } });
      createElement({ tagName: "tr", id: `tr-${uuid}`, children: [cb] });
      return cb;
    });
  }
  if (options.visibleLinkIds) {
    setVisibleLinkIds(options.visibleLinkIds);
  }

  const byId = {
    total: totalInput,
    limit: limitInput,
    skip: skipInput,
    sort: sortInput,
    order: orderInput,
    search: searchInput,
    "filter-domain": filterDomainSelect,
    "select-all-links-checkbox": selectAllCheckbox,
    "bulk-action-bar": bulkActionBar,
    "bulk-selected-count": bulkSelectedCount,
    "bulk-delete-links-btn": bulkDeleteBtn,
    "bulk-select-banner": banner,
    "bulk-select-banner-text": bannerText,
    "bulk-select-banner-action": bannerAction,
    "link-dialog": linkDialog,
    "links-total-badge": totalBadge,
    "pagination-info": paginationInfo,
    "tab-links": tabLinks,
    "tab-users": tabUsers,
    "tab-domains": tabDomains,
  };

  const doc = {
    nodeType: 9,
    textContent: null,
    body: {
      addEventListener(type, fn) {
        (listeners.body[type] ||= []).push(fn);
      },
    },
    addEventListener(type, fn) {
      (listeners.document[type] ||= []).push(fn);
    },
    getElementById(id) {
      return byId[id] || null;
    },
    querySelector(selector) {
      if (selector === "#total") return totalInput;
      if (selector === "#limit") return limitInput;
      if (selector === "#skip") return skipInput;
      if (selector === "dialog.dialog[open]") return linkDialog.open ? linkDialog : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".table-card .nav .limit button" || selector === "table .nav .limit button") return limitButtons;
      if (selector === ".pagination .prev") return prevButtons;
      if (selector === ".pagination .next") return nextButtons;
      if (selector === ".table-footer") return [tableFooter];
      if (selector === "input.link-select-checkbox") return linkCheckboxes;
      return [];
    },
  };

  const win = {
    addEventListener(type, fn) {
      (listeners.window[type] ||= []).push(fn);
    },
    location: { search: options.search || "", replace() {} },
  };

  const context = vm.createContext({
    document: doc,
    window: win,
    URLSearchParams,
    htmx: {
      defineExtension() {},
      trigger(target, eventName) {
        htmxTriggers.push({ target, eventName });
      },
      ajax(method, url, opts) {
        htmxAjaxCalls.push({ method, url, opts });
      },
    },
    setTimeout,
    clearTimeout,
  });

  const source = fs.readFileSync(path.resolve(__dirname, "../../static/scripts/main.js"), "utf8");
  vm.runInContext(source, context);

  return {
    context,
    doc,
    listeners,
    htmxTriggers,
    htmxAjaxCalls,
    totalInput,
    limitInput,
    skipInput,
    sortInput,
    orderInput,
    searchInput,
    filterDomainSelect,
    selectAllCheckbox,
    bulkActionBar,
    bulkSelectedCount,
    bulkDeleteBtn,
    bulkDeleteLabel,
    banner,
    bannerText,
    bannerAction,
    linkDialog,
    tableFooter,
    paginationInfo,
    totalBadge,
    thead,
    thCreated,
    thViews,
    thUrl,
    sortCreatedBtn,
    sortViewsBtn,
    sortUrlBtn,
    getLinkCheckboxes: () => linkCheckboxes,
    setVisibleLinkIds,
    footNav,
    tabLinks,
    tabUsers,
    tabDomains,
    tabNav,
  };
}

test("delegated set-limit click updates #limit, resets #skip, toggles aria-pressed, and updates bottom pagination footer", () => {
  const env = loadMainScript();

  const dispatchDocumentClick = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {}, stopPropagation() {} };
    for (const fn of env.listeners.document.click) {
      fn(evt);
    }
  };

  // Footer is visible for total=23
  assert.equal(env.tableFooter.classList.contains("hidden"), false);
  assert.equal(env.totalBadge.textContent, "23");
  assert.equal(env.paginationInfo.textContent, "Showing 11\u201320 of 23");

  // Click "20" (total=23 -> next still enabled, prev disabled because skip resets to 0)
  dispatchDocumentClick(env.footNav.btn20);
  assert.equal(env.limitInput.value, "20");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.footNav.btn10.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.btn20.getAttribute("aria-pressed"), "true");
  assert.equal(env.footNav.btn20.classList.contains("active"), true);
  assert.equal(env.footNav.btn50.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.prev.disabled, true);
  assert.equal(env.footNav.next.disabled, false);
  assert.equal(env.paginationInfo.textContent, "Showing 1\u201320 of 23");

  // Click "50" (total=23 <= 50 -> next becomes disabled)
  dispatchDocumentClick(env.footNav.btn50);
  assert.equal(env.limitInput.value, "50");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.footNav.btn10.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.btn20.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.btn50.getAttribute("aria-pressed"), "true");
  assert.equal(env.footNav.prev.disabled, true);
  assert.equal(env.footNav.next.disabled, true);

  // Click "10" back (total=23 > 10 -> next re-enabled)
  dispatchDocumentClick(env.footNav.btn10);
  assert.equal(env.limitInput.value, "10");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.footNav.btn10.getAttribute("aria-pressed"), "true");
  assert.equal(env.footNav.btn50.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.next.disabled, false);
});

test("bottom pagination footer hides automatically when there are no links or only one page", () => {
  const emptyEnv = loadMainScript({ total: 0, skip: 0 });
  assert.equal(emptyEnv.tableFooter.classList.contains("hidden"), true);
  assert.equal(emptyEnv.totalBadge.textContent, "0");

  const singlePageEnv = loadMainScript({ total: 7, skip: 0 });
  assert.equal(singlePageEnv.tableFooter.classList.contains("hidden"), true);
  assert.equal(singlePageEnv.totalBadge.textContent, "7");
});

test("sortable table headers update aria-sort on active <th> only and trigger reloadMainTable", () => {
  const env = loadMainScript({ total: 15, skip: 10 });

  const dispatchClick = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {}, stopPropagation() {} };
    for (const fn of env.listeners.document.click) fn(evt);
  };

  // Click active Created at -> toggles desc to asc
  dispatchClick(env.sortCreatedBtn);
  assert.equal(env.sortInput.value, "created_at");
  assert.equal(env.orderInput.value, "asc");
  assert.equal(env.thCreated.getAttribute("aria-sort"), "ascending");
  assert.equal(env.thViews.hasAttribute("aria-sort"), false);
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.htmxTriggers.some((t) => t.eventName === "reloadMainTable"), true);

  // Click Views -> moves aria-sort to Views (descending by default for numeric metrics)
  dispatchClick(env.sortViewsBtn);
  assert.equal(env.sortInput.value, "views");
  assert.equal(env.orderInput.value, "desc");
  assert.equal(env.thViews.getAttribute("aria-sort"), "descending");
  assert.equal(env.thCreated.hasAttribute("aria-sort"), false);

  // Click Original URL -> moves aria-sort to Original URL (ascending by default for text)
  dispatchClick(env.sortUrlBtn);
  assert.equal(env.sortInput.value, "target");
  assert.equal(env.orderInput.value, "asc");
  assert.equal(env.thUrl.getAttribute("aria-sort"), "ascending");
  assert.equal(env.thViews.hasAttribute("aria-sort"), false);
});

test("delegated set-tab click switches active tab and aria-selected when event.currentTarget is document", () => {
  const env = loadMainScript();

  const evt = { target: env.tabDomains, currentTarget: env.doc, preventDefault() {}, stopPropagation() {} };
  for (const fn of env.listeners.document.click) {
    fn(evt);
  }

  assert.equal(env.tabLinks.classList.contains("active"), false);
  assert.equal(env.tabLinks.getAttribute("aria-selected"), "false");
  assert.equal(env.tabDomains.classList.contains("active"), true);
  assert.equal(env.tabDomains.getAttribute("aria-selected"), "true");
});

test("getQueryParams uses URLSearchParams and preserves '=' inside parameter values", () => {
  const env = loadMainScript({ search: "?id=abc-123&token=aGVsbG8==" });
  const params = env.context.getQueryParams();
  assert.equal(params.id, "abc-123");
  assert.equal(params.token, "aGVsbG8==");
});

test("bulk link selection via header checkbox, contextual action bar, domain filter reset, and native dialog open work", () => {
  const env = loadMainScript({
    total: 5,
    skip: 0,
    visibleLinkIds: ["id-1", "id-2", "id-3"],
  });

  const dispatchClick = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {}, stopPropagation() {} };
    for (const fn of env.listeners.document.click) fn(evt);
  };
  const dispatchChange = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {} };
    for (const fn of env.listeners.document.change) fn(evt);
  };
  const dispatchBodyEvent = (type, detail = {}) => {
    for (const fn of env.listeners.body[type] || []) fn({ detail });
  };

  // Initially 0 selected -> contextual bar hidden
  assert.equal(env.selectAllCheckbox.disabled, false);
  assert.equal(env.bulkActionBar.classList.contains("hidden"), true);
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(env.banner.classList.contains("hidden"), true);

  // Select single link -> indeterminate header checkbox, contextual bulk action bar visible with count 1
  const [cb1, cb2, cb3] = env.getLinkCheckboxes();
  cb1.checked = true;
  dispatchChange(cb1);
  assert.equal(env.selectAllCheckbox.indeterminate, true);
  assert.equal(env.selectAllCheckbox.checked, false);
  assert.equal(env.bulkActionBar.classList.contains("hidden"), false);
  assert.equal(env.bulkSelectedCount.textContent, "1 selected");
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), false);
  assert.equal(cb1.parentNode.classList.contains("selected"), true);

  // Toggle header select-all checkbox -> selects all 3 visible links and shows banner (total=5 > visible=3)
  env.selectAllCheckbox.checked = true;
  dispatchChange(env.selectAllCheckbox);
  assert.equal(cb1.checked, true);
  assert.equal(cb2.checked, true);
  assert.equal(cb3.checked, true);
  assert.equal(env.selectAllCheckbox.checked, true);
  assert.equal(env.selectAllCheckbox.indeterminate, false);
  assert.equal(env.bulkSelectedCount.textContent, "3 selected");
  assert.equal(env.banner.classList.contains("hidden"), false);
  assert.match(env.bannerAction.textContent, /Select all 5 links/);

  // Filter by domain -> clears selection, resets skip to 0, triggers reloadMainTable
  env.filterDomainSelect.value = "dysto.cc";
  dispatchChange(env.filterDomainSelect);
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.bulkActionBar.classList.contains("hidden"), true);
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(env.banner.classList.contains("hidden"), true);
  assert.equal(env.htmxTriggers.some((t) => t.eventName === "reloadMainTable"), true);

  // Simulate filtered reload returning 2 visible links out of 4 matching in dysto.cc
  env.totalInput.value = "4";
  env.setVisibleLinkIds(["dysto-1", "dysto-2"]);
  dispatchBodyEvent("htmx:afterSettle");

  // Select all visible via header checkbox -> only selects the 2 filtered links, banner scopes to dysto.cc
  env.selectAllCheckbox.checked = true;
  dispatchChange(env.selectAllCheckbox);
  assert.equal(env.bulkSelectedCount.textContent, "2 selected");
  assert.equal(env.banner.classList.contains("hidden"), false);
  assert.equal(env.bannerAction.textContent, "Select all 4 links in dysto.cc");

  // Click "Select all 4 links in dysto.cc" -> opens bulk delete via native <dialog>.showModal()
  dispatchClick(env.bannerAction);
  assert.equal(env.bulkSelectedCount.textContent, "4 selected");
  dispatchClick(env.bulkDeleteBtn);
  assert.equal(env.linkDialog.open, true);
  assert.equal(env.htmxAjaxCalls.length, 1);
  assert.equal(env.htmxAjaxCalls[0].url, "/confirm-links-delete");
  assert.deepEqual(JSON.parse(JSON.stringify(env.htmxAjaxCalls[0].opts.values)), {
    all: "true",
    domain: "dysto.cc",
    search: "",
  });

  // Unchecking one row drops selectAllMatching and keeps only the remaining visible row selected
  const [d1, d2] = env.getLinkCheckboxes();
  d1.checked = false;
  dispatchChange(d1);
  assert.equal(env.bulkSelectedCount.textContent, "1 selected");
  assert.equal(d2.checked, true);

  // Opening bulk delete now sends explicit ids array with only ["dysto-2"]
  dispatchClick(env.bulkDeleteBtn);
  assert.equal(env.htmxAjaxCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(env.htmxAjaxCalls[1].opts.values)), { ids: ["dysto-2"] });

  // clearLinkSelection event clears everything
  dispatchBodyEvent("clearLinkSelection");
  assert.equal(env.bulkActionBar.classList.contains("hidden"), true);
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(d2.checked, false);
});
