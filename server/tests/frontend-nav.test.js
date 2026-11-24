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
  const skipInput = createElement({ tagName: "input", id: "skip", value: "10" });

  // Two sets of limit + pagination buttons (top toolbar and bottom footer)
  const makeNav = () => ({
    btn10: createElement({ tagName: "button", textContent: "10", classes: ["active"], attrs: { "aria-pressed": "true" }, dataset: { action: "set-limit" } }),
    btn20: createElement({ tagName: "button", textContent: "20", attrs: { "aria-pressed": "false" }, dataset: { action: "set-limit" } }),
    btn50: createElement({ tagName: "button", textContent: "50", attrs: { "aria-pressed": "false" }, dataset: { action: "set-limit" } }),
    prev: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "prev" }, disabled: false }),
    next: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "next" }, disabled: false }),
  });

  const headNav = makeNav();
  const footNav = makeNav();
  const limitButtons = [headNav.btn10, headNav.btn20, headNav.btn50, footNav.btn10, footNav.btn20, footNav.btn50];
  const prevButtons = [headNav.prev, footNav.prev];
  const nextButtons = [headNav.next, footNav.next];

  const tabLinks = createElement({ tagName: "button", id: "tab-links", attrs: { role: "tab", "aria-selected": "true" }, dataset: { action: "set-tab" }, classes: ["active"] });
  const tabUsers = createElement({ tagName: "button", id: "tab-users", attrs: { role: "tab", "aria-selected": "false" }, dataset: { action: "set-tab" } });
  const tabDomains = createElement({ tagName: "button", id: "tab-domains", attrs: { role: "tab", "aria-selected": "false" }, dataset: { action: "set-tab" } });
  const tabNav = createElement({ tagName: "nav", children: [tabLinks, tabUsers, tabDomains] });

  const searchInput = createElement({ tagName: "input", id: "search", value: "" });
  const filterDomainSelect = createElement({ tagName: "select", id: "filter-domain", value: "", dataset: { action: "filter-domain" } });
  const selectAllBtn = createElement({ tagName: "button", id: "select-all-links-btn", textContent: "Select all", dataset: { action: "toggle-select-all-links-btn" }, disabled: true });
  const selectAllCheckbox = createElement({ tagName: "input", id: "select-all-links-checkbox", dataset: { action: "toggle-select-all-links-checkbox" }, disabled: true });
  const bulkDeleteLabel = createElement({ tagName: "span", textContent: "Delete selected", classes: ["bulk-delete-label"] });
  const bulkDeleteBtn = createElement({ tagName: "button", id: "bulk-delete-links-btn", classes: ["hidden"], dataset: { action: "open-bulk-delete" }, children: [bulkDeleteLabel] });
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
    search: searchInput,
    "filter-domain": filterDomainSelect,
    "select-all-links-btn": selectAllBtn,
    "select-all-links-checkbox": selectAllCheckbox,
    "bulk-delete-links-btn": bulkDeleteBtn,
    "bulk-select-banner": banner,
    "bulk-select-banner-text": bannerText,
    "bulk-select-banner-action": bannerAction,
    "link-dialog": linkDialog,
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
    searchInput,
    filterDomainSelect,
    selectAllBtn,
    selectAllCheckbox,
    bulkDeleteBtn,
    bulkDeleteLabel,
    banner,
    bannerText,
    bannerAction,
    linkDialog,
    getLinkCheckboxes: () => linkCheckboxes,
    setVisibleLinkIds,
    headNav,
    footNav,
    tabLinks,
    tabUsers,
    tabDomains,
    tabNav,
  };
}

test("delegated set-limit click updates #limit, resets #skip, and toggles aria-pressed on 10/20/50 buttons", () => {
  const env = loadMainScript();

  const dispatchDocumentClick = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {}, stopPropagation() {} };
    for (const fn of env.listeners.document.click) {
      fn(evt);
    }
  };

  // Click "20" (total=23 -> next still enabled, prev disabled because skip resets to 0)
  dispatchDocumentClick(env.headNav.btn20);
  assert.equal(env.limitInput.value, "20");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.getAttribute("aria-pressed"), "false");
  assert.equal(env.headNav.btn20.getAttribute("aria-pressed"), "true");
  assert.equal(env.headNav.btn20.classList.contains("active"), true);
  assert.equal(env.headNav.btn50.getAttribute("aria-pressed"), "false");
  assert.equal(env.footNav.btn20.getAttribute("aria-pressed"), "true");
  assert.equal(env.headNav.prev.disabled, true);
  assert.equal(env.headNav.next.disabled, false);

  // Click "50" from footer (total=23 <= 50 -> next becomes disabled)
  dispatchDocumentClick(env.footNav.btn50);
  assert.equal(env.limitInput.value, "50");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.getAttribute("aria-pressed"), "false");
  assert.equal(env.headNav.btn20.getAttribute("aria-pressed"), "false");
  assert.equal(env.headNav.btn50.getAttribute("aria-pressed"), "true");
  assert.equal(env.footNav.btn50.getAttribute("aria-pressed"), "true");
  assert.equal(env.headNav.prev.disabled, true);
  assert.equal(env.headNav.next.disabled, true);

  // Click "10" back (total=23 > 10 -> next re-enabled)
  dispatchDocumentClick(env.headNav.btn10);
  assert.equal(env.limitInput.value, "10");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.getAttribute("aria-pressed"), "true");
  assert.equal(env.headNav.btn50.getAttribute("aria-pressed"), "false");
  assert.equal(env.headNav.next.disabled, false);
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

test("bulk link selection, select all, domain filter reset, and native dialog open work", () => {
  const env = loadMainScript({
    total: 5,
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

  // Initially 0 selected
  assert.equal(env.selectAllBtn.disabled, false);
  assert.equal(env.selectAllBtn.textContent, "Select all");
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(env.banner.classList.contains("hidden"), true);

  // Select single link -> indeterminate header checkbox, bulk delete visible with count 1
  const [cb1, cb2, cb3] = env.getLinkCheckboxes();
  cb1.checked = true;
  dispatchChange(cb1);
  assert.equal(env.selectAllCheckbox.indeterminate, true);
  assert.equal(env.selectAllCheckbox.checked, false);
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), false);
  assert.equal(env.bulkDeleteLabel.textContent, "Delete (1)");
  assert.equal(cb1.parentNode.classList.contains("selected"), true);

  // Click Select all button -> selects all 3 visible links and shows banner (total=5 > visible=3)
  dispatchClick(env.selectAllBtn);
  assert.equal(cb1.checked, true);
  assert.equal(cb2.checked, true);
  assert.equal(cb3.checked, true);
  assert.equal(env.selectAllBtn.textContent, "Deselect all");
  assert.equal(env.selectAllCheckbox.checked, true);
  assert.equal(env.selectAllCheckbox.indeterminate, false);
  assert.equal(env.bulkDeleteLabel.textContent, "Delete (3)");
  assert.equal(env.banner.classList.contains("hidden"), false);
  assert.match(env.bannerAction.textContent, /Select all 5 links/);

  // Filter by domain -> clears selection, resets skip to 0, triggers reloadMainTable
  env.filterDomainSelect.value = "dysto.cc";
  dispatchChange(env.filterDomainSelect);
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(env.banner.classList.contains("hidden"), true);
  assert.equal(env.htmxTriggers.some((t) => t.eventName === "reloadMainTable"), true);

  // Simulate filtered reload returning 2 visible links out of 4 matching in dysto.cc
  env.totalInput.value = "4";
  env.setVisibleLinkIds(["dysto-1", "dysto-2"]);
  dispatchBodyEvent("htmx:afterSettle");

  // Click Select all -> only selects the 2 filtered links, banner scopes to dysto.cc
  dispatchClick(env.selectAllBtn);
  assert.equal(env.bulkDeleteLabel.textContent, "Delete (2)");
  assert.equal(env.banner.classList.contains("hidden"), false);
  assert.equal(env.bannerAction.textContent, "Select all 4 links in dysto.cc");

  // Click "Select all 4 links in dysto.cc" -> opens bulk delete via native <dialog>.showModal()
  dispatchClick(env.bannerAction);
  assert.equal(env.bulkDeleteLabel.textContent, "Delete (4)");
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
  assert.equal(env.bulkDeleteLabel.textContent, "Delete (1)");
  assert.equal(d2.checked, true);

  // Opening bulk delete now sends explicit ids array with only ["dysto-2"]
  dispatchClick(env.bulkDeleteBtn);
  assert.equal(env.htmxAjaxCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(env.htmxAjaxCalls[1].opts.values)), { ids: ["dysto-2"] });

  // clearLinkSelection event clears everything
  dispatchBodyEvent("clearLinkSelection");
  assert.equal(env.bulkDeleteBtn.classList.contains("hidden"), true);
  assert.equal(d2.checked, false);
});
