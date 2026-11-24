// log htmx on dev
// htmx.logAll();

// add text/html accept header to receive html instead of json for the requests
document.body.addEventListener("htmx:configRequest", function(evt) {
  evt.detail.headers["Accept"] = "text/html,*/*";
});

// redirect to homepage
function schedulePageRedirect(destination, delay) {
  if (window.__dyslinksRedirecting || !destination) return;
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
  const button = event.currentTarget || closest("button", event.target) || event.target;
  const nextLimit = button.textContent.trim();
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
    : (event.currentTarget || closest("a", event.target) || event.target);
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
}

function clearSearchInput(event) {
  event.preventDefault();
  const button = closest("button", event.target);
  const input = button && button.parentElement ? button.parentElement.querySelector("input") : null;
  if (!input) return;
  input.value = "";
  button.style.display = "none";
  resetTableNav();
  htmx.trigger("body", "reloadMainTable");
}

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
scheduleRedirects(document);

document.body.addEventListener("htmx:load", function(evt) {
  scheduleRedirects(evt.detail && evt.detail.elt ? evt.detail.elt : document);
});

document.body.addEventListener("htmx:afterSwap", function() {
  scheduleRedirects(document);
});

document.body.addEventListener("htmx:afterSettle", function() {
  onSearchInputLoad();
  updateLinksNav();
  scheduleRedirects(document);
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