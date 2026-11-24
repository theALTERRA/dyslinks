// log htmx on dev
// htmx.logAll();

// add text/html accept header to receive html instead of json for the requests
document.body.addEventListener("htmx:configRequest", function (evt) {
  evt.detail.headers["Accept"] = "text/html,*/*";
});

// screen-reader polite live announcer
function announce(message) {
  const region = document.getElementById("live-announcer");
  if (!region || !message) return;
  region.textContent = "";
  setTimeout(function () {
    region.textContent = message;
  }, 40);
}

// redirect to homepage (restricted to safe relative same-origin paths)
function isSafeRedirectPath(destination) {
  return typeof destination === "string" && destination.startsWith("/") && !destination.startsWith("//");
}

function schedulePageRedirect(destination, delay) {
  if (window.__dyslinksRedirecting || !isSafeRedirectPath(destination)) return;
  window.__dyslinksRedirecting = true;
  setTimeout(function () {
    window.location.replace(destination);
  }, delay);
}

document.body.addEventListener("redirectToHomepage", function () {
  schedulePageRedirect("/", 1000);
});

function scheduleRedirects(root) {
  if (!root || window.__dyslinksRedirecting) return;
  const targets = [];
  if (root.matches && root.matches("[data-redirect]")) {
    targets.push(root);
  }
  if (root.querySelectorAll) {
    root.querySelectorAll("[data-redirect]").forEach(function (el) { targets.push(el); });
  }
  targets.forEach(function (el) {
    if (el.dataset.redirectScheduled === "true") return;
    const destination = el.dataset.redirect;
    if (!destination) return;
    el.dataset.redirectScheduled = "true";
    schedulePageRedirect(destination, 1000);
  });
}

// reset form if event is sent from the backend
function resetForm(id) {
  return function () {
    const form = document.getElementById(id);
    if (!form) return;
    form.reset();
  };
}
document.body.addEventListener("resetChangePasswordForm", resetForm("change-password"));
document.body.addEventListener("resetChangeEmailForm", resetForm("change-email"));
document.body.addEventListener("resetShortenerForm", function () {
  ["target", "customurl", "password", "expire_in", "description"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const domainEl = document.getElementById("domain");
  const labelVal = document.getElementById("customurl-label-value");
  if (domainEl && labelVal) {
    labelVal.textContent = domainEl.value + "/";
  }
});
document.body.addEventListener("closeAddDomainForm", function () {
  const showBtn = document.querySelector(".show-domain-form");
  if (showBtn) showBtn.classList.remove("hidden");
  const addDomainForm = document.getElementById("add-domain");
  if (addDomainForm) addDomainForm.remove();
});

// an htmx extension to use the specified params in the path instead of the query or body
htmx.defineExtension("path-params", {
  onEvent: function (name, evt) {
    if (name === "htmx:configRequest") {
      evt.detail.path = evt.detail.path.replace(/{([^}]+)}/g, function (_, param) {
        const val = evt.detail.parameters[param];
        delete evt.detail.parameters[param];
        return val === undefined ? "{" + param + "}" : encodeURIComponent(val);
      });
    }
  }
});

// get url query params via native URLSearchParams
function getQueryParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

// trim text
function trimText(selector, length) {
  const element = document.querySelector(selector);
  if (!element) return;
  let text = element.textContent;
  if (typeof text !== "string") return;
  text = text.trim();
  if (text.length > length) {
    element.textContent = Array.from(text).slice(0, length).join("") + "...";
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

// lazy-load qrcode.min.js only when user opens a QR code dialog (self-hosted, CSP 'self' safe)
let qrLibPromise = null;
function loadQRCodeLib() {
  if (typeof QRCode !== "undefined") return Promise.resolve();
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise(function (resolve, reject) {
    const script = document.createElement("script");
    script.src = "/libs/qrcode.min.js";
    script.onload = resolve;
    script.onerror = function () {
      qrLibPromise = null;
      reject(new Error("Failed to load QR code library"));
    };
    document.head.appendChild(script);
  });
  return qrLibPromise;
}

// show QR code in native modal dialog with visible close button
async function handleQRCode(element, id) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  const dialogContent = dialog.querySelector(".content-wrapper");
  if (!dialogContent) return;
  openDialog(id, "qrcode");
  dialog.setAttribute("aria-label", "QR Code");
  dialog.removeAttribute("aria-labelledby");

  try {
    await loadQRCodeLib();
  } catch (_) {
    const errP = document.createElement("p");
    errP.className = "error";
    errP.setAttribute("role", "alert");
    errP.textContent = "Could not load QR code generator.";
    dialogContent.replaceChildren(errP);
    return;
  }

  const content = document.createElement("div");
  content.className = "content";

  const title = document.createElement("h1");
  title.id = "dialog-title";
  title.className = "visually-hidden";
  title.textContent = "QR Code";

  const qrFrame = document.createElement("div");
  qrFrame.className = "qr-frame";

  const buttons = document.createElement("div");
  buttons.className = "buttons";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.dataset.action = "close-dialog";
  closeBtn.textContent = "Close";
  buttons.appendChild(closeBtn);

  content.append(title, qrFrame, buttons);
  dialogContent.replaceChildren(content);
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.removeAttribute("aria-label");

  new QRCode(qrFrame, {
    text: element.dataset.url,
    width: 200,
    height: 200,
    colorDark: "#0f172a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  if (typeof closeBtn.focus === "function") {
    closeBtn.focus();
  }
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
  announce("Copied to clipboard");
  const parent = element.parentNode;
  const container = element.closest ? (element.closest("#shorturl, #apikey, .short-link-wrapper, .short-link") || parent) : parent;
  const clipboard = (container && container.querySelector ? container.querySelector(".clipboard") : null)
    || (element.closest ? element.closest(".clipboard") : null);
  if (!clipboard || clipboard.classList.contains("copied")) return;
  clipboard.classList.add("copied");
  setTimeout(function () {
    clipboard.classList.remove("copied");
  }, 1000);
}

// native <dialog> management
function cleanupDialog(dialog) {
  if (!dialog) return;
  Array.from(dialog.classList).forEach(function (cls) {
    if (cls !== "dialog") dialog.classList.remove(cls);
  });
  dialog.classList.add("dialog");
  if (dialog.removeAttribute) {
    dialog.removeAttribute("aria-labelledby");
    dialog.removeAttribute("aria-label");
  }
  const wrapper = dialog.querySelector ? dialog.querySelector(".content-wrapper") : null;
  if (wrapper) {
    if (typeof wrapper.replaceChildren === "function") {
      wrapper.replaceChildren();
    } else {
      wrapper.textContent = "";
    }
  }
}

function openDialog(id, name) {
  const dialog = document.getElementById(id);
  if (!dialog) return;
  if (name) {
    dialog.classList.add(name);
  }
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      dialog.showModal();
    }
  } else {
    dialog.classList.add("open");
  }
}

function closeDialog(targetDialog) {
  const dialog = targetDialog
    || document.querySelector("dialog.dialog[open]")
    || document.querySelector(".dialog.open")
    || document.querySelector(".dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    cleanupDialog(dialog);
  }
}

// Clean up dialog state whenever native dialog closes (Esc, closedby="any", or .close())
document.addEventListener("close", function (event) {
  const target = event.target;
  if (target && target.tagName === "DIALOG" && target.classList && target.classList.contains("dialog")) {
    cleanupDialog(target);
  }
}, true);

// Fallback for browsers without native <dialog closedby="any"> (e.g. Safari)
// Uses pointerdown + pointerup bounding-rect check so text-selection drags onto the backdrop do not dismiss
if (typeof HTMLDialogElement !== "undefined" && !("closedBy" in HTMLDialogElement.prototype)) {
  let pressedOutsideDialog = null;

  function isOutsideDialog(evt, dialog) {
    const r = dialog.getBoundingClientRect();
    return evt.clientX < r.left || evt.clientX > r.right || evt.clientY < r.top || evt.clientY > r.bottom;
  }

  document.addEventListener("pointerdown", function (evt) {
    const target = evt.target;
    if (target && target.tagName === "DIALOG" && target.open && target.getAttribute("closedby") === "any") {
      pressedOutsideDialog = isOutsideDialog(evt, target) ? target : null;
    } else {
      pressedOutsideDialog = null;
    }
  });

  document.addEventListener("pointerup", function (evt) {
    if (pressedOutsideDialog && evt.target === pressedOutsideDialog && pressedOutsideDialog.open && isOutsideDialog(evt, pressedOutsideDialog)) {
      pressedOutsideDialog.close();
    }
    pressedOutsideDialog = null;
  });
}

// Accessible [popover="hint"] tooltip controller (WCAG 1.4.13: dismissible, hoverable, persistent + keyboard focus)
(function initTooltips() {
  if (typeof document.getElementById !== "function") return;
  const tooltip = document.getElementById("app-tooltip");
  if (!tooltip) return;

  const supportsAnchor = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("position-area: block-start");
  const supportsPopover = typeof HTMLElement !== "undefined" && Object.hasOwn(HTMLElement.prototype, "popover");

  // Graceful fallback when popover="hint" is unsupported (defaults to manual; ensure Escape dismisses)
  let activeTrigger = null;
  let hideTimer = null;

  function getTriggerAccessibleName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    return (el.textContent || "").trim();
  }

  function positionFallback(trigger) {
    const rect = trigger.getBoundingClientRect();
    const ttRect = tooltip.getBoundingClientRect();
    const pad = 8;
    const halfW = (ttRect.width || 60) / 2;
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centerX - halfW, pad), window.innerWidth - (ttRect.width || 120) - pad);
    let top = rect.top - (ttRect.height || 28) - 8;
    if (top < pad) {
      top = rect.bottom + 8;
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  function showTooltip(trigger) {
    const text = trigger && trigger.getAttribute ? trigger.getAttribute("data-tooltip") : null;
    if (!text) return;

    clearTimeout(hideTimer);

    if (activeTrigger && activeTrigger !== trigger) {
      if (supportsAnchor) activeTrigger.style.removeProperty("anchor-name");
      if (activeTrigger.getAttribute("aria-describedby") === "app-tooltip") {
        activeTrigger.removeAttribute("aria-describedby");
      }
    }

    activeTrigger = trigger;
    tooltip.textContent = text;

    // Only wire aria-describedby when tooltip adds information beyond the trigger's accessible name
    const name = getTriggerAccessibleName(trigger);
    if (name.toLowerCase() !== text.trim().toLowerCase() && !trigger.hasAttribute("aria-describedby")) {
      trigger.setAttribute("aria-describedby", "app-tooltip");
    }

    if (supportsAnchor) {
      trigger.style.setProperty("anchor-name", "--active-tooltip-anchor");
    }

    if (supportsPopover && typeof tooltip.showPopover === "function") {
      try {
        if (!tooltip.matches(":popover-open")) {
          tooltip.showPopover();
        }
      } catch (_) {
        tooltip.classList.add("visible");
      }
    } else {
      tooltip.classList.add("visible");
    }

    if (!supportsAnchor) {
      positionFallback(trigger);
    }
  }

  function hideTooltip(immediate) {
    clearTimeout(hideTimer);
    const doHide = function () {
      if (activeTrigger) {
        if (supportsAnchor) activeTrigger.style.removeProperty("anchor-name");
        if (activeTrigger.getAttribute("aria-describedby") === "app-tooltip") {
          activeTrigger.removeAttribute("aria-describedby");
        }
        activeTrigger = null;
      }
      if (supportsPopover && typeof tooltip.hidePopover === "function") {
        try {
          if (tooltip.matches(":popover-open")) {
            tooltip.hidePopover();
          }
        } catch (_) {
          // ignore
        }
      }
      tooltip.classList.remove("visible");
    };
    if (immediate) {
      doHide();
    } else {
      hideTimer = setTimeout(doHide, 120);
    }
  }

  document.addEventListener("pointerover", function (evt) {
    if (evt.target === tooltip || (evt.target && evt.target.closest && evt.target.closest("#app-tooltip"))) {
      clearTimeout(hideTimer);
      return;
    }
    const trigger = evt.target && evt.target.closest ? evt.target.closest("[data-tooltip]") : null;
    if (trigger) {
      showTooltip(trigger);
    }
  });

  document.addEventListener("pointerout", function (evt) {
    if (!activeTrigger) return;
    const related = evt.relatedTarget;
    if (related && (related === tooltip || related === activeTrigger || (related.closest && (related.closest("#app-tooltip") || related.closest("[data-tooltip]") === activeTrigger)))) {
      return;
    }
    hideTooltip(false);
  });

  document.addEventListener("focusin", function (evt) {
    const trigger = evt.target && evt.target.closest ? evt.target.closest("[data-tooltip]") : null;
    if (trigger) {
      showTooltip(trigger);
    }
  });

  document.addEventListener("focusout", function () {
    hideTooltip(true);
  });

  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape" && activeTrigger) {
      hideTooltip(true);
    }
  });

  window.addEventListener("scroll", function () {
    if (activeTrigger) hideTooltip(true);
  }, { passive: true, capture: true });
})();

// handle navigation in the table of links
function getLimitButtons() {
  const buttons = document.querySelectorAll(".table-card .nav .limit button");
  if (buttons && buttons.length) return Array.from(buttons);
  return Array.from(document.querySelectorAll("table .nav .limit button"));
}

function setLimitButtonState(button, isActive) {
  if (button.setAttribute) {
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
  if (button.classList) {
    button.classList.toggle("active", isActive);
  }
}

function setLinksLimit(event) {
  const buttons = getLimitButtons();
  const limitInput = document.querySelector("#limit");
  if (!limitInput || !buttons || !buttons.length) return;
  const button =
    (event && event.currentTarget && event.currentTarget.nodeType === 1 ? event.currentTarget : null) ||
    (event && event.target && event.target.closest ? event.target.closest("button") : null) ||
    (event && event.target);
  if (!button || typeof button.textContent !== "string") return;
  const nextLimit = button.textContent.trim();
  if (!nextLimit) return;
  limitInput.value = nextLimit;
  const skipInput = document.querySelector("#skip");
  if (skipInput) skipInput.value = 0;
  buttons.forEach(function (b) {
    setLimitButtonState(b, b.textContent.trim() === nextLimit);
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
  document.querySelectorAll(".pagination .next").forEach(function (elm) {
    elm.disabled = total <= nextSkip + limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(function (elm) {
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

  const limitButtons = getLimitButtons();

  if (total > 0 && skip >= total) {
    skip = Math.max(0, Math.floor((total - 1) / limit) * limit);
    skipElm.value = skip;
    document.querySelectorAll(".pagination .next").forEach(function (elm) {
      elm.disabled = total <= skip + limit;
    });
    document.querySelectorAll(".pagination .prev").forEach(function (elm) {
      elm.disabled = skip <= 0;
    });
    limitButtons.forEach(function (b) {
      setLimitButtonState(b, b.textContent.trim() === String(limit));
    });
    htmx.trigger("body", "reloadMainTable");
    return;
  }

  if (total === 0 && skip > 0) {
    skip = 0;
    skipElm.value = 0;
  }

  document.querySelectorAll(".pagination .next").forEach(function (elm) {
    elm.disabled = total <= skip + limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(function (elm) {
    elm.disabled = skip <= 0;
  });
  limitButtons.forEach(function (b) {
    setLimitButtonState(b, b.textContent.trim() === String(limit));
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
  document.querySelectorAll(".pagination .next").forEach(function (elm) {
    elm.disabled = total <= limit;
  });
  document.querySelectorAll(".pagination .prev").forEach(function (elm) {
    elm.disabled = true;
  });
}

// tab click
function setTab(event, targetId) {
  const target = targetId
    ? document.getElementById(targetId)
    : (
        (event && event.currentTarget && event.currentTarget.nodeType === 1 ? event.currentTarget : null) ||
        (event && event.target && event.target.closest ? event.target.closest("[role='tab'], a, button") : null) ||
        (event && event.target)
      );
  const nav = target && target.closest ? target.closest("nav") : null;
  if (!nav) return;
  Array.from(nav.children).forEach(function (tab) {
    tab.classList.remove("active");
    if (tab.setAttribute) tab.setAttribute("aria-selected", "false");
  });
  target.classList.add("active");
  if (target.setAttribute) target.setAttribute("aria-selected", "true");
}

// search change & clear (visibility of clear button is handled in CSS via :has(input:placeholder-shown))
function onSearchChange() {
  resetTableNav();
  clearLinkSelection();
}

function clearSearchInput(event) {
  event.preventDefault();
  const button = event.target && event.target.closest ? event.target.closest("button") : null;
  const input = button && button.parentElement ? button.parentElement.querySelector("input") : null;
  if (!input) return;
  input.value = "";
  if (typeof input.focus === "function") input.focus();
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
    const row = cb.closest ? cb.closest("tr") : null;
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
    if (selectAllBtn.setAttribute) {
      selectAllBtn.setAttribute("aria-pressed", allVisibleSelected ? "true" : "false");
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

document.body.addEventListener("clearLinkSelection", function () {
  clearLinkSelection();
});

document.body.addEventListener("linkDeleted", function (evt) {
  const id = evt && evt.detail ? evt.detail.value : null;
  if (id) {
    selectedLinkIds.delete(id);
    syncLinkSelectionUI();
  }
});

// Sync native <details id="advanced-options-details"> state into hidden show_advanced input
document.addEventListener("toggle", function (evt) {
  const target = evt.target;
  if (target && target.id === "advanced-options-details") {
    const hiddenInput = document.getElementById("show-advanced-input");
    if (hiddenInput) {
      hiddenInput.value = target.open ? "1" : "";
    }
  }
}, true);

// Sync accessible title & autofocus when HTMX swaps content into an open <dialog>
function syncDialogContent(root) {
  const dialog = root && root.closest ? root.closest("dialog.dialog") : null;
  if (!dialog) return;
  const heading = dialog.querySelector("#dialog-title, h1, h2");
  if (heading) {
    if (!heading.id) heading.id = "dialog-title";
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.removeAttribute("aria-label");
  }
  const focusTarget = dialog.querySelector("[autofocus]");
  if (focusTarget && typeof focusTarget.focus === "function") {
    focusTarget.focus();
  }
}

updateLinksNav();
syncLinkSelectionUI();
scheduleRedirects(document);

document.body.addEventListener("htmx:load", function (evt) {
  scheduleRedirects(evt.detail && evt.detail.elt ? evt.detail.elt : document);
});

document.body.addEventListener("htmx:afterSwap", function (evt) {
  syncLinkSelectionUI();
  scheduleRedirects(document);
  if (evt && evt.target) {
    syncDialogContent(evt.target);
  }
});

document.body.addEventListener("htmx:afterSettle", function () {
  updateLinksNav();
  syncLinkSelectionUI();
  scheduleRedirects(document);
});

document.body.addEventListener("htmx:afterOnLoad", function (evt) {
  if (evt.target && evt.target.matches && evt.target.matches("[data-update-nav]")) {
    updateLinksNav();
    syncLinkSelectionUI();
  }
});

document.body.addEventListener("htmx:beforeRequest", function (evt) {
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
    if (target.setAttribute) target.setAttribute("aria-expanded", "true");
    const existingContent = tr.querySelector(".content");
    if (existingContent) {
      evt.preventDefault();
      tr.classList.remove("show");
      if (target.setAttribute) target.setAttribute("aria-expanded", "false");
      tr.removeChild(existingContent);
    }
  }
});

document.body.addEventListener("htmx:afterRequest", function (evt) {
  const target = evt.target;
  if (target && target.matches && target.matches("[data-hide-on-success]") && evt.detail && evt.detail.successful) {
    target.classList.add("hidden");
  }
});

// Delegated event handlers (strict CSP — no inline onclick/onchange/hx-on)
document.addEventListener("click", function (event) {
  const el = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
  if (!el) return;
  const action = el.dataset.action;

  if (action === "copy-link") {
    handleShortURLCopyLink(el);
  } else if (action === "open-dialog") {
    if (el.dataset.dialog) openDialog(el.dataset.dialog);
  } else if (action === "close-dialog") {
    const ownDialog = el.closest ? el.closest("dialog.dialog, .dialog") : null;
    closeDialog(ownDialog);
  } else if (action === "open-qrcode") {
    if (el.dataset.dialog) handleQRCode(el, el.dataset.dialog);
  } else if (action === "cancel-add-domain") {
    const showBtn = document.querySelector(".show-domain-form");
    if (showBtn) showBtn.classList.remove("hidden");
    const addDomainForm = document.querySelector("#add-domain");
    if (addDomainForm) addDomainForm.remove();
  } else if (action === "close-edit-row") {
    const tr = el.closest ? el.closest("tr") : null;
    if (!tr) return;
    tr.classList.remove("show");
    const prevRow = tr.previousElementSibling;
    const editBtn = prevRow && prevRow.querySelector ? prevRow.querySelector("[data-action='toggle-edit-row']") : null;
    if (editBtn) editBtn.setAttribute("aria-expanded", "false");
    const content = tr.querySelector(".content");
    if (content) tr.removeChild(content);
  } else if (action === "set-tab") {
    setTab({ currentTarget: el, target: event.target }, el.dataset.tabTarget || undefined);
  } else if (action === "set-limit") {
    if (el.getAttribute && el.getAttribute("aria-pressed") === "true") {
      event.stopPropagation();
      return;
    }
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
  } else if (action === "toggle-password") {
    const wrapper = el.closest ? el.closest(".password-input-wrapper") : null;
    const input = wrapper ? wrapper.querySelector("input") : null;
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    el.setAttribute("aria-pressed", showing ? "false" : "true");
    el.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  }
});

document.addEventListener("input", function (event) {
  const el = event.target;
  if (el && el.dataset && el.dataset.action === "search-input") {
    onSearchChange(event);
  }
});

document.addEventListener("change", function (event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  const action = el.dataset.action;

  if (action === "update-domain-label") {
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
  onEvent: function (name, event) {
    if (name !== "htmx:afterProcessNode") {
      return;
    }
    const attr = function (node, property) {
      if (node == undefined) { return undefined; }
      return node.getAttribute(property) || node.getAttribute("data-" + property) || attr(node.parentElement, property);
    };
    const load = function (node) {
      const done = function (html) {
        if (!node.preloadAlways) {
          node.preloadState = "DONE";
        }
        if (attr(node, "preload-images") == "true") {
          document.createElement("div").innerHTML = html;
        }
      };

      return function () {
        if (node.preloadState !== "READY") {
          return;
        }
        const hxGet = node.getAttribute("hx-get") || node.getAttribute("data-hx-get");
        if (hxGet) {
          htmx.ajax("GET", hxGet, {
            source: node,
            handler: function (elt, info) {
              done(info.xhr.responseText);
            }
          });
          return;
        }
        if (node.getAttribute("href")) {
          const r = new XMLHttpRequest();
          r.open("GET", node.getAttribute("href"));
          r.onload = function () { done(r.responseText); };
          r.send();
        }
      };
    };
    const init = function (node) {
      if (node.getAttribute("href") + node.getAttribute("hx-get") + node.getAttribute("data-hx-get") == "") {
        return;
      }
      if (node.preloadState !== undefined) {
        return;
      }
      let on = attr(node, "preload") || "mousedown";
      const always = on.indexOf("always") !== -1;
      if (always) {
        on = on.replace("always", "").trim();
      }
      node.addEventListener(on, function () {
        if (node.preloadState === "PAUSE") {
          node.preloadState = "READY";
          if (on === "mouseover") {
            window.setTimeout(load(node), 100);
          } else {
            load(node)();
          }
        }
      });
      switch (on) {
        case "mouseover":
          node.addEventListener("touchstart", load(node), { passive: true });
          node.addEventListener("mouseout", function (evt) {
            if ((evt.target === node) && (node.preloadState === "READY")) {
              node.preloadState = "PAUSE";
            }
          });
          break;

        case "mousedown":
          node.addEventListener("touchstart", load(node), { passive: true });
          break;
      }
      node.preloadState = "PAUSE";
      node.preloadAlways = always;
      htmx.trigger(node, "preload:init");
    };
    const parent = event.target || event.detail.elt;
    parent.querySelectorAll("[preload]").forEach(function (node) {
      init(node);
      node.querySelectorAll("a,[hx-get],[data-hx-get]").forEach(init);
    });
  }
});
