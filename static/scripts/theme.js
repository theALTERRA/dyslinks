(function () {
  var STORAGE_KEY = "kutt-theme";
  var LIGHT_THEME_COLOR = "#f8fafc";
  var DARK_THEME_COLOR = "#0b0f19";

  function getStoredTheme() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch (_) {
      // ignore storage errors (e.g. private browsing)
    }
    return null;
  }

  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function updateToggleButtons(theme) {
    var buttons = document.querySelectorAll(".theme-toggle");
    var label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    buttons.forEach(function (btn) {
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    });
  }

  function applyTheme(theme, persist) {
    var resolved = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved;

    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
    }

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, resolved);
      } catch (_) {
        // ignore storage errors
      }
    }

    updateToggleButtons(resolved);

    try {
      window.dispatchEvent(new CustomEvent("kutt:themechange", { detail: { theme: resolved } }));
    } catch (_) {
      // ignore if CustomEvent unavailable
    }
  }

  // Apply immediately before first paint to avoid FOUC
  var initialTheme = getStoredTheme() || getSystemTheme();
  applyTheme(initialTheme, false);

  // Sync toggle button labels once DOM is ready and after any HTMX swap
  document.addEventListener("DOMContentLoaded", function () {
    updateToggleButtons(document.documentElement.getAttribute("data-theme") || initialTheme);
  });

  document.addEventListener("htmx:afterSwap", function () {
    updateToggleButtons(document.documentElement.getAttribute("data-theme") || initialTheme);
  });

  // Event delegation so toggle keeps working even across HTMX body swaps
  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest(".theme-toggle") : null;
    if (!target) return;
    var current = document.documentElement.getAttribute("data-theme") || getSystemTheme();
    applyTheme(current === "dark" ? "light" : "dark", true);
  });

  // Follow OS preference changes if the user has not chosen an explicit override
  if (window.matchMedia) {
    var mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystemChange = function (e) {
      if (!getStoredTheme()) {
        applyTheme(e.matches ? "dark" : "light", false);
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", onSystemChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(onSystemChange);
    }
  }

  window.kuttTheme = {
    get: function () {
      return document.documentElement.getAttribute("data-theme") || getSystemTheme();
    },
    set: function (theme) {
      applyTheme(theme, true);
    },
    toggle: function () {
      var current = document.documentElement.getAttribute("data-theme") || getSystemTheme();
      applyTheme(current === "dark" ? "light" : "dark", true);
    }
  };
})();
