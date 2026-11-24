// log htmx on dev
// htmx.logAll();

// add text/html accept header to receive html instead of json for the requests
document.body.addEventListener("htmx:configRequest", function(evt) {
  evt.detail.headers["Accept"] = "text/html,*/*";
});

// redirect to homepage (restricted to safe relative same-origin paths)
function isSafeRedirectPath(destination) {
  return typeof destination === "string" && destination.startsWith("/") && !destination.startsWith("//");
}

function schedulePageRedirect(destination, delay) {
  if (window.__dyslinksRedirecting || !isSafeRedirectPath(destination)) return;
  window.__dyslinksRedirecting = true;
  setTimeout(() => {
    window.location.replace(destination);
  }, delay);
}

document.body.addEventListener("redirectToHomepage", function() {
  schedulePageRedirect("/", 1000);
});

function scheduleRedirects(root) {
  if (!root || window.__dyslinksRedirecting) return;
  const targets = [];
  if (root.matches && root.matches("[data-redirect]")) {
    targets.push(root);
  }
  if (root.querySelectorAll) {
    root.querySelectorAll("[data-redirect]").forEach(el => targets.push(el));
  }
  targets.forEach(el => {
    if (el.dataset.redirectScheduled === "true") return;
    const destination = el.dataset.redirect;
    if (!destination) return;
    el.dataset.redirectScheduled = "true";
    schedulePageRedirect(destination, 1000);
  });
}

// reset form if event is sent from the backend
function resetForm(id) {
  return function() {
    const form = document.getElementById(id);
    if (!form) return;
    form.reset();
  }
}
document.body.addEventListener("resetChangePasswordForm", resetForm("change-password"));
document.body.addEventListener("resetChangeEmailForm", resetForm("change-email"));
document.body.addEventListener("resetShortenerForm", function() {
  ["target", "customurl", "password", "expire_in", "description"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const domainEl = document.getElementById("domain");
  const labelVal = document.getElementById("customurl-label-value");
  if (domainEl && labelVal) {
    labelVal.textContent = domainEl.value + "/";
  }
});
document.body.addEventListener("closeAddDomainForm", function() {
  const showBtn = document.querySelector(".show-domain-form");
  if (showBtn) showBtn.classList.remove("hidden");
  const addDomainForm = document.getElementById("add-domain");
  if (addDomainForm) addDomainForm.remove();
});

// an htmx extension to use the specifed params in the path instead of the query or body
htmx.defineExtension("path-params", {
  onEvent: function(name, evt) {
    if (name === "htmx:configRequest") {
      evt.detail.path = evt.detail.path.replace(/{([^}]+)}/g, function(_, param) {
        var val = evt.detail.parameters[param]
        delete evt.detail.parameters[param]
        return val === undefined ? "{" + param + "}" : encodeURIComponent(val)
      })
    }
  }
})

// find closest element
function closest(selector, elm) {
  let element = elm || this;

  while (element && element.nodeType === 1) {
    if (element.matches(selector)) {
      return element;
    }

    element = element.parentNode;
  }

  return null;
};

// get url query param
function getQueryParams() {
  const search = window.location.search.replace("?", "");
  const query = {};
  search.split("&").map(q => {
    const keyvalue = q.split("=");
    query[keyvalue[0]] = keyvalue[1];
  });
  return query;
}

// trim text
function trimText(selector, length) {
  const element = document.querySelector(selector);
  if (!element) return;
  let text = element.textContent;
  if (typeof text !== "string") return;
  text = text.trim();
  if (text.length > length) {
    element.textContent = text.split("").slice(0, length).join("") + "...";
  }
}

function formatDateHour(selector) {
  const element = document.querySelector(selector);
  if (!element) return;
  const dateString = element.dataset.date;
  if (!dateString) return;
  const date = new Date(dateString);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  element.textContent = hours + ":" + minutes;
}

// show QR code
function handleQRCode(element, id) {
  const dialog = document.getElementById(id);
  const dialogContent = dialog.querySelector(".content-wrapper");
  if (!dialogContent) return;
  openDialog(id, "qrcode");
  dialogContent.textContent = "";
  const qrFrame = document.createElement("div");
  qrFrame.className = "qr-frame";
  dialogContent.appendChild(qrFrame);
  new QRCode(qrFrame, {
    text: element.dataset.url,
    width: 200,
    height: 200,
    colorDark : "#0f172a",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
}

// copy the link to clipboard (with fallback for non-HTTPS contexts)
async function handleCopyLink(element) {
  const url = element && element.dataset ? element.dataset.url : null;
  if (!url) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch (_) {
      // fall through to textarea copy fallback
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return !!copied;
  } catch (_) {
    return false;
  }
}

// copy the link and toggle copy button style
async function handleShortURLCopyLink(element) {
  const copied = await handleCopyLink(element);
  if (!copied) return;
  const clipboard = element.parentNode.querySelector(".clipboard") || closest(".clipboard", element);
  if (!clipboard || clipboard.classList.contains("copied")) return;
  clipboard.classList.add("copied");
  setTimeout(function() {
    clipboard.classList.remove("copied");
  }, 1000);
}

// open and close dialog
function openDialog(id, name) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  dialog.classList.add("open");
  if (name) {
    dialog.classList.add(name);
  }
}

function closeDialog(targetDialog) {
  const dialog = targetDialog || document.querySelector(".dialog.open") || document.querySelector(".dialog");
  if (!dialog) return;
  while (dialog.classList.length > 0) {
    dialog.classList.remove(dialog.classList[0]);
  }
  dialog.classList.add("dialog");
  const wrapper = dialog.querySelector(".content-wrapper");
  if (wrapper) {
    wrapper.textContent = "";
  }
}

window.addEventListener("click", function(event) {
  if (
    event.target &&
    event.target.classList &&
    event.target.classList.contains("dialog") &&
    event.target.classList.contains("open")
  ) {
    closeDialog(event.target);
  }
});

window.addEventListener("keydown", function(event) {
  if (event.key === "Escape") {
    const dialog = document.querySelector(".dialog.open");
    if (dialog) closeDialog(dialog);
  }
});

// handle navigation in the table of links
function setLinksLimit(event) {
  const buttons = Array.from(document.querySelectorAll("table .nav .limit button"));
  const limitInput = document.querySelector("#limit");
  if (!limitInput || !buttons || !buttons.length) return;
  const button =
    (event && event.currentTarget && event.currentTarget.nodeType === 1 ? event.currentTarget : null) ||
    closest("button", event && event.target) ||
    (event && event.target);
  if (!button || typeof button.textContent !== "string") return;
  const nextLimit = button.textContent.trim();
  if (!nextLimit) return;
  limitInput.value = nextLimit;
  const skipInput = document.querySelector("#skip");
  if (skipInput) skipInput.value = 0;
  buttons.forEach(b => {
    b.disabled = b.textContent.trim() === nextLimit;
  });
  updateLinksNav();
}

function setLinksSkip(event, action) {
  const limitElm = document.querySelector("#limit");
  const totalElm = document.querySelector("#total");
  const skipElm = document.querySelector("#skip");
  if (!limitElm || !totalElm || !skipElm) return;
  const skip = parseInt(skipElm.value, 10) || 0;
  const limit = parseInt(limitElm.value, 10) || 10;
  const total = parseInt(totalElm.value, 10) || 0;
  if (action === "next" && skip + limit >= total) return;
  if (action === "prev" && skip <= 0) return;
  const nextSkip = action === "next" ? skip + limit : Math.max(skip - limit, 0);
  skipElm.value = nextSkip;
  document.querySelectorAll(".pagination .next").forEach(elm => {
    elm.disabled = total <= nextSkip + limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(elm => {
    elm.disabled = nextSkip <= 0;
  });
}

function updateLinksNav() {
  const totalElm = document.querySelector("#total");
  const skipElm = document.querySelector("#skip");
  const limitElm = document.querySelector("#limit");
  if (!totalElm || !skipElm || !limitElm) return;
  const parsedTotal = parseInt(totalElm.value, 10);
  const parsedSkip = parseInt(skipElm.value, 10);
  const parsedLimit = parseInt(limitElm.value, 10);
  const total = Number.isNaN(parsedTotal) ? 0 : parsedTotal;
  let skip = Number.isNaN(parsedSkip) ? 0 : Math.max(parsedSkip, 0);
  const limit = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? 10 : parsedLimit;

  if (total > 0 && skip >= total) {
    skip = Math.max(0, Math.floor((total - 1) / limit) * limit);
    skipElm.value = skip;
    document.querySelectorAll(".pagination .next").forEach(elm => {
      elm.disabled = total <= skip + limit;
    });
    document.querySelectorAll(".pagination .prev").forEach(elm => {
      elm.disabled = skip <= 0;
    });
    document.querySelectorAll("table .nav .limit button").forEach(b => {
      b.disabled = b.textContent.trim() === String(limit);
    });
    htmx.trigger("body", "reloadMainTable");
    return;
  }

  if (total === 0 && skip > 0) {
    skip = 0;
    skipElm.value = 0;
  }

  document.querySelectorAll(".pagination .next").forEach(elm => {
    elm.disabled = total <= skip + limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(elm => {
    elm.disabled = skip <= 0;
  });
  document.querySelectorAll("table .nav .limit button").forEach(b => {
    b.disabled = b.textContent.trim() === String(limit);
  });
}

function resetTableNav() {
  const totalElm = document.querySelector("#total");
  const skipElm = document.querySelector("#skip");
  const limitElm = document.querySelector("#limit");
  if (!totalElm || !skipElm || !limitElm) return;
  skipElm.value = 0;
  const parsedTotal = parseInt(totalElm.value, 10);
  const parsedLimit = parseInt(limitElm.value, 10);
  const total = Number.isNaN(parsedTotal) ? 0 : parsedTotal;
  const limit = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? 10 : parsedLimit;
  document.querySelectorAll(".pagination .next").forEach(elm => {
    elm.disabled = total <= limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(elm => {
    elm.disabled = true;
  });
}

// tab click
function setTab(event, targetId) {
  const target = targetId
    ? document.getElementById(targetId)
    : (
        (event && event.currentTarget && event.currentTarget.nodeType === 1 ? event.currentTarget : null) ||
        closest("a", event && event.target) ||
        (event && event.target)
      );
  const nav = target ? closest("nav", target) : null;
  if (!nav) return;
  Array.from(nav.children).forEach(function (tab) {
    tab.classList.remove("active");
  });
  target.classList.add("active");
}

// show clear search button
function onSearchChange(event) {
  const clearButton = event.target.parentElement.querySelector("button.clear");
  if (clearButton) {
    clearButton.style.display = event.target.value.length > 0 ? "flex" : "none";
  }
  resetTableNav();
  clearLinkSelection();
}

function clearSearchInput(event) {
  event.preventDefault();
  const button = closest("button", event.target);
  const input = button && button.parentElement ? button.parentElement.querySelector("input") : null;
  if (!input) return;
  input.value = "";
  button.style.display = "none";
  resetTableNav();
  clearLinkSelection();
  htmx.trigger("body", "reloadMainTable");
}

// bulk selection & domain filtering for user links table
const selectedLinkIds = new Set();
let selectAllMatching = false;

function getVisibleLinkCheckboxes() {
  return Array.from(document.querySelectorAll("input.link-select-checkbox"));
}

function getActiveLinkFilters() {
  const domainEl = document.getElementById("filter-domain");
  const searchEl = document.getElementById("search");
  return {
    domain: domainEl && typeof domainEl.value === "string" ? domainEl.value.trim() : "",
    search: searchEl && typeof searchEl.value === "string" ? searchEl.value.trim() : "",
  };
}

function getLinksTotal() {
  const totalElm = document.querySelector("#total");
  const parsed = totalElm ? parseInt(totalElm.value, 10) : 0;
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function syncLinkSelectionUI() {
  const selectAllBtn = document.getElementById("select-all-links-btn");
  const selectAllCheckbox = document.getElementById("select-all-links-checkbox");
  const bulkDeleteBtn = document.getElementById("bulk-delete-links-btn");
  if (!selectAllBtn && !selectAllCheckbox && !bulkDeleteBtn) return;

  const checkboxes = getVisibleLinkCheckboxes();
  const total = getLinksTotal();
  if (total === 0 || checkboxes.length === 0) {
    selectAllMatching = false;
  }

  let checkedVisibleCount = 0;
  checkboxes.forEach(function (cb) {
    const isChecked = selectAllMatching || selectedLinkIds.has(cb.value);
    cb.checked = isChecked;
    if (isChecked) checkedVisibleCount++;
    const row = closest("tr", cb);
    if (row && row.classList) {
      row.classList.toggle("selected", isChecked);
    }
  });

  const visibleCount = checkboxes.length;
  const allVisibleSelected = visibleCount > 0 && checkedVisibleCount === visibleCount;
  const selectedCount = selectAllMatching ? total : selectedLinkIds.size;

  if (selectAllCheckbox) {
    selectAllCheckbox.disabled = visibleCount === 0;
    selectAllCheckbox.checked = allVisibleSelected;
    selectAllCheckbox.indeterminate = !allVisibleSelected && checkedVisibleCount > 0;
  }

  if (selectAllBtn) {
    selectAllBtn.disabled = visibleCount === 0;
    selectAllBtn.textContent = allVisibleSelected ? "Deselect all" : "Select all";
    if (selectAllBtn.classList) {
      selectAllBtn.classList.toggle("active", allVisibleSelected);
    }
  }

  if (bulkDeleteBtn) {
    if (bulkDeleteBtn.classList) {
      bulkDeleteBtn.classList.toggle("hidden", selectedCount === 0);
    }
    bulkDeleteBtn.disabled = selectedCount === 0;
    const label = bulkDeleteBtn.querySelector ? bulkDeleteBtn.querySelector(".bulk-delete-label") : null;
    if (label) {
      label.textContent = selectedCount > 0 ? "Delete (" + selectedCount + ")" : "Delete selected";
    }
  }

  const banner = document.getElementById("bulk-select-banner");
  const bannerText = document.getElementById("bulk-select-banner-text");
  const bannerAction = document.getElementById("bulk-select-banner-action");
  if (banner && bannerText && bannerAction) {
    const showBanner = visibleCount > 0 && total > visibleCount && (allVisibleSelected || selectAllMatching);
    if (banner.classList) {
      banner.classList.toggle("hidden", !showBanner);
    }
    if (showBanner) {
      const filters = getActiveLinkFilters();
      let suffix = "";
      if (filters.domain && filters.search) {
        suffix = ' in ' + filters.domain + ' matching "' + filters.search + '"';
      } else if (filters.domain) {
        suffix = " in " + filters.domain;
      } else if (filters.search) {
        suffix = ' matching "' + filters.search + '"';
      }

      if (selectAllMatching) {
        bannerText.textContent = "All " + total + " links" + suffix + " are selected.";
        bannerAction.textContent = "Clear selection";
        bannerAction.dataset.action = "clear-link-selection";
      } else {
        bannerText.textContent = "All " + visibleCount + " links on this page are selected.";
        bannerAction.textContent = "Select all " + total + " links" + suffix;
        bannerAction.dataset.action = "select-all-matching";
      }
    }
  }
}

function clearLinkSelection() {
  selectedLinkIds.clear();
  selectAllMatching = false;
  syncLinkSelectionUI();
}

function toggleSelectLink(checkbox) {
  if (!checkbox || !checkbox.value) return;
  if (selectAllMatching) {
    selectAllMatching = false;
    selectedLinkIds.clear();
    getVisibleLinkCheckboxes().forEach(function (cb) {
      if (cb.checked && cb.value) {
        selectedLinkIds.add(cb.value);
      }
    });
  } else if (checkbox.checked) {
    selectedLinkIds.add(checkbox.value);
  } else {
    selectedLinkIds.delete(checkbox.value);
  }
  syncLinkSelectionUI();
}

function toggleSelectAllLinks(forceChecked) {
  const checkboxes = getVisibleLinkCheckboxes();
  if (!checkboxes.length) return;
  const shouldSelect = typeof forceChecked === "boolean"
    ? forceChecked
    : !(selectAllMatching || checkboxes.every(function (cb) { return selectedLinkIds.has(cb.value); }));

  if (shouldSelect) {
    checkboxes.forEach(function (cb) {
      if (cb.value) selectedLinkIds.add(cb.value);
    });
  } else {
    selectAllMatching = false;
    checkboxes.forEach(function (cb) {
      if (cb.value) selectedLinkIds.delete(cb.value);
    });
  }
  syncLinkSelectionUI();
}

function selectAllMatchingLinks() {
  if (getLinksTotal() <= 0) return;
  selectAllMatching = true;
  getVisibleLinkCheckboxes().forEach(function (cb) {
    if (cb.value) selectedLinkIds.add(cb.value);
  });
  syncLinkSelectionUI();
}

function openBulkDeleteDialog(button) {
  const total = getLinksTotal();
  const count = selectAllMatching ? total : selectedLinkIds.size;
  if (count <= 0) return;

  const filters = getActiveLinkFilters();
  const values = selectAllMatching
    ? { all: "true", domain: filters.domain, search: filters.search }
    : { ids: Array.from(selectedLinkIds) };

  openDialog("link-dialog");
  htmx.ajax("POST", "/confirm-links-delete", {
    target: "#link-dialog .content-wrapper",
    source: button,
    values: values,
  });
}

document.body.addEventListener("clearLinkSelection", function() {
  clearLinkSelection();
});

document.body.addEventListener("linkDeleted", function(evt) {
  const id = evt && evt.detail ? evt.detail.value : null;
  if (id) {
    selectedLinkIds.delete(id);
    syncLinkSelectionUI();
  }
});

// detect if search inputs have value on load to show clear button
function onSearchInputLoad() {
  ["search", "search_user", "search_domain"].forEach(function (id) {
    const input = document.getElementById(id);
    if (!input || !input.parentElement) return;
    const clearButton = input.parentElement.querySelector("button.clear");
    if (!clearButton) return;
    clearButton.style.display = input.value.length > 0 ? "flex" : "none";
  });
}

onSearchInputLoad();
updateLinksNav();
syncLinkSelectionUI();
scheduleRedirects(document);

document.body.addEventListener("htmx:load", function(evt) {
  scheduleRedirects(evt.detail && evt.detail.elt ? evt.detail.elt : document);
});

document.body.addEventListener("htmx:afterSwap", function() {
  syncLinkSelectionUI();
  scheduleRedirects(document);
});

document.body.addEventListener("htmx:afterSettle", function() {
  onSearchInputLoad();
  updateLinksNav();
  syncLinkSelectionUI();
  scheduleRedirects(document);
});

document.body.addEventListener("htmx:afterOnLoad", function(evt) {
  if (evt.target && evt.target.matches && evt.target.matches("[data-update-nav]")) {
    updateLinksNav();
    syncLinkSelectionUI();
  }
});

document.body.addEventListener("htmx:beforeRequest", function(evt) {
  const target = evt.target;
  if (!target || !target.matches) return;

  if (target.matches("[data-prevent-active-request].active")) {
    evt.preventDefault();
    return;
  }

  if (target.matches("[data-action='toggle-edit-row']")) {
    const tr = evt.detail && evt.detail.target;
    if (!tr) return;
    tr.classList.add("show");
    const existingContent = tr.querySelector(".content");
    if (existingContent) {
      evt.preventDefault();
      tr.classList.remove("show");
      tr.removeChild(existingContent);
    }
  }
});

document.body.addEventListener("htmx:afterRequest", function(evt) {
  const target = evt.target;
  if (target && target.matches && target.matches("[data-hide-on-success]") && evt.detail && evt.detail.successful) {
    target.classList.add("hidden");
  }
});

// Delegated event handlers (strict CSP — no inline onclick/onchange/hx-on)
document.addEventListener("click", function(event) {
  const el = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
  if (!el) return;
  const action = el.dataset.action;

  if (action === "copy-link") {
    handleShortURLCopyLink(el);
  } else if (action === "open-dialog") {
    if (el.dataset.dialog) openDialog(el.dataset.dialog);
  } else if (action === "close-dialog") {
    closeDialog();
  } else if (action === "open-qrcode") {
    if (el.dataset.dialog) handleQRCode(el, el.dataset.dialog);
  } else if (action === "cancel-add-domain") {
    const showBtn = document.querySelector(".show-domain-form");
    if (showBtn) showBtn.classList.remove("hidden");
    const addDomainForm = document.querySelector("#add-domain");
    if (addDomainForm) addDomainForm.remove();
  } else if (action === "close-edit-row") {
    const tr = el.closest("tr");
    if (!tr) return;
    tr.classList.remove("show");
    const content = tr.querySelector(".content");
    if (content) tr.removeChild(content);
  } else if (action === "set-tab") {
    setTab({ currentTarget: el, target: event.target }, el.dataset.tabTarget || undefined);
  } else if (action === "set-limit") {
    setLinksLimit({ currentTarget: el, target: event.target });
  } else if (action === "set-skip") {
    setLinksSkip({ currentTarget: el, target: event.target }, el.dataset.direction);
  } else if (action === "clear-search") {
    clearSearchInput(event);
  } else if (action === "toggle-select-all-links-btn") {
    toggleSelectAllLinks();
  } else if (action === "select-all-matching") {
    selectAllMatchingLinks();
  } else if (action === "clear-link-selection") {
    clearLinkSelection();
  } else if (action === "open-bulk-delete") {
    openBulkDeleteDialog(el);
  }
});

document.addEventListener("input", function(event) {
  const el = event.target;
  if (el && el.dataset && el.dataset.action === "search-input") {
    onSearchChange(event);
  }
});

document.addEventListener("change", function(event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  const action = el.dataset.action;

  if (action === "toggle-advanced") {
    const opts = document.getElementById("advanced-options");
    if (opts) opts.classList.toggle("hidden", !el.checked);
  } else if (action === "update-domain-label") {
    const span = document.querySelector("#customurl-label span");
    if (span) span.textContent = el.value + "/";
  } else if (action === "reset-table-nav") {
    resetTableNav();
  } else if (action === "toggle-verification-email") {
    canSendVerificationEmail();
  } else if (action === "toggle-select-link") {
    toggleSelectLink(el);
  } else if (action === "toggle-select-all-links-checkbox") {
    toggleSelectAllLinks(el.checked);
  } else if (action === "filter-domain") {
    resetTableNav();
    clearLinkSelection();
    htmx.trigger("body", "reloadMainTable");
  }
});

// create user checkbox control
function canSendVerificationEmail() {
  const verified = document.getElementById("create-user-verified");
  const banned = document.getElementById("create-user-banned");
  const checkbox = document.getElementById("send-email-label");
  if (!verified || !banned || !checkbox) return;
  const canSend = !verified.checked && !banned.checked;
  checkbox.classList.toggle("hidden", !canSend);
}

// htmx prefetch extension
// https://github.com/bigskysoftware/htmx-extensions/blob/main/src/preload/README.md
htmx.defineExtension("preload", {
  onEvent: function(name, event) {
    if (name !== "htmx:afterProcessNode") {
      return
    }
    var attr = function(node, property) {
      if (node == undefined) { return undefined }
      return node.getAttribute(property) || node.getAttribute("data-" + property) || attr(node.parentElement, property)
    }
    var load = function(node) {
      var done = function(html) {
        if (!node.preloadAlways) {
          node.preloadState = "DONE"
        }

        if (attr(node, "preload-images") == "true") {
          document.createElement("div").innerHTML = html
        }
      }

      return function() {
        if (node.preloadState !== "READY") {
          return
        }
        var hxGet = node.getAttribute("hx-get") || node.getAttribute("data-hx-get")
        if (hxGet) {
          htmx.ajax("GET", hxGet, {
            source: node,
            handler: function(elt, info) {
              done(info.xhr.responseText)
            }
          })
          return
        }
        if (node.getAttribute("href")) {
          var r = new XMLHttpRequest()
          r.open("GET", node.getAttribute("href"))
          r.onload = function() { done(r.responseText) }
          r.send()
        }
      }
    }
    var init = function(node) {
      if (node.getAttribute("href") + node.getAttribute("hx-get") + node.getAttribute("data-hx-get") == "") {
        return
      }
      if (node.preloadState !== undefined) {
        return
      }
      var on = attr(node, "preload") || "mousedown"
      const always = on.indexOf("always") !== -1
      if (always) {
        on = on.replace("always", "").trim()
      }
      node.addEventListener(on, function(evt) {
        if (node.preloadState === "PAUSE") {
          node.preloadState = "READY"
          if (on === "mouseover") {
            window.setTimeout(load(node), 100)
          } else {
            load(node)()
          }
        }
      })
      switch (on) {
        case "mouseover":
          node.addEventListener("touchstart", load(node))
          node.addEventListener("mouseout", function(evt) {
            if ((evt.target === node) && (node.preloadState === "READY")) {
              node.preloadState = "PAUSE"
            }
          })
          break

        case "mousedown":
          node.addEventListener("touchstart", load(node))
          break
      }
      node.preloadState = "PAUSE"
      node.preloadAlways = always
      htmx.trigger(node, "preload:init")
    }
    const parent = event.target || event.detail.elt;
    parent.querySelectorAll("[preload]").forEach(function(node) {
      init(node)
      node.querySelectorAll("a,[hx-get],[data-hx-get]").forEach(init)
    })
  }
})