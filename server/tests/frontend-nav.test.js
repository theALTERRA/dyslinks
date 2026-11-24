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
    get length() {
      return set.size;
    },
  };
}

function createElement({ tagName, id = "", textContent = "", dataset = {}, classes = [], value = "", disabled = false, parentNode = null, children = [] }) {
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id,
    textContent,
    dataset,
    classList: createClassList(classes),
    value,
    disabled,
    parentNode,
    children,
    matches(selector) {
      if (selector === "[data-action]") return Boolean(this.dataset && this.dataset.action);
      if (selector === "button") return this.tagName === "BUTTON";
      if (selector === "a") return this.tagName === "A";
      if (selector === "nav") return this.tagName === "NAV";
      return false;
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

function loadMainScript() {
  const listeners = { document: {}, body: {}, window: {} };

  const totalInput = createElement({ tagName: "input", id: "total", value: "23" });
  const limitInput = createElement({ tagName: "input", id: "limit", value: "10" });
  const skipInput = createElement({ tagName: "input", id: "skip", value: "10" });

  // Two sets of limit + pagination buttons (thead and tfoot)
  const makeNav = () => ({
    btn10: createElement({ tagName: "button", textContent: "10", dataset: { action: "set-limit" }, disabled: true }),
    btn20: createElement({ tagName: "button", textContent: "20", dataset: { action: "set-limit" }, disabled: false }),
    btn50: createElement({ tagName: "button", textContent: "50", dataset: { action: "set-limit" }, disabled: false }),
    prev: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "prev" }, disabled: false }),
    next: createElement({ tagName: "button", dataset: { action: "set-skip", direction: "next" }, disabled: false }),
  });

  const headNav = makeNav();
  const footNav = makeNav();
  const limitButtons = [headNav.btn10, headNav.btn20, headNav.btn50, footNav.btn10, footNav.btn20, footNav.btn50];
  const prevButtons = [headNav.prev, footNav.prev];
  const nextButtons = [headNav.next, footNav.next];

  const tabLinks = createElement({ tagName: "a", id: "tab-links", dataset: { action: "set-tab" }, classes: ["active"] });
  const tabUsers = createElement({ tagName: "a", id: "tab-users", dataset: { action: "set-tab" } });
  const tabDomains = createElement({ tagName: "a", id: "tab-domains", dataset: { action: "set-tab" } });
  const tabNav = createElement({ tagName: "nav", children: [tabLinks, tabUsers, tabDomains] });

  const byId = {
    total: totalInput,
    limit: limitInput,
    skip: skipInput,
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
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "table .nav .limit button") return limitButtons;
      if (selector === ".pagination .prev") return prevButtons;
      if (selector === ".pagination .next") return nextButtons;
      return [];
    },
  };

  const win = {
    addEventListener(type, fn) {
      (listeners.window[type] ||= []).push(fn);
    },
    location: { search: "", replace() {} },
  };

  const context = vm.createContext({
    document: doc,
    window: win,
    htmx: {
      defineExtension() {},
      trigger() {},
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
    totalInput,
    limitInput,
    skipInput,
    headNav,
    footNav,
    tabLinks,
    tabUsers,
    tabDomains,
    tabNav,
  };
}

test("delegated set-limit click updates #limit, resets #skip, and toggles 10/20/50 buttons", () => {
  const env = loadMainScript();

  const dispatchDocumentClick = (target) => {
    const evt = { target, currentTarget: env.doc, preventDefault() {} };
    for (const fn of env.listeners.document.click) {
      fn(evt);
    }
  };

  // Click "20" (total=23 -> next still enabled, prev disabled because skip resets to 0)
  dispatchDocumentClick(env.headNav.btn20);
  assert.equal(env.limitInput.value, "20");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.disabled, false);
  assert.equal(env.headNav.btn20.disabled, true);
  assert.equal(env.headNav.btn50.disabled, false);
  assert.equal(env.footNav.btn20.disabled, true);
  assert.equal(env.headNav.prev.disabled, true);
  assert.equal(env.headNav.next.disabled, false);

  // Click "50" from tfoot (total=23 <= 50 -> next becomes disabled)
  dispatchDocumentClick(env.footNav.btn50);
  assert.equal(env.limitInput.value, "50");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.disabled, false);
  assert.equal(env.headNav.btn20.disabled, false);
  assert.equal(env.headNav.btn50.disabled, true);
  assert.equal(env.footNav.btn50.disabled, true);
  assert.equal(env.headNav.prev.disabled, true);
  assert.equal(env.headNav.next.disabled, true);

  // Click "10" back (total=23 > 10 -> next re-enabled)
  dispatchDocumentClick(env.headNav.btn10);
  assert.equal(env.limitInput.value, "10");
  assert.equal(env.skipInput.value, 0);
  assert.equal(env.headNav.btn10.disabled, true);
  assert.equal(env.headNav.btn50.disabled, false);
  assert.equal(env.headNav.next.disabled, false);
});

test("delegated set-tab click switches active tab when event.currentTarget is document", () => {
  const env = loadMainScript();

  const evt = { target: env.tabDomains, currentTarget: env.doc, preventDefault() {} };
  for (const fn of env.listeners.document.click) {
    fn(evt);
  }

  assert.equal(env.tabLinks.classList.contains("active"), false);
  assert.equal(env.tabDomains.classList.contains("active"), true);
});
