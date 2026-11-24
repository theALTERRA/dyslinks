(function () {
  const STORAGE_KEY = "dyslinks-theme";
  const LIGHT_THEME_COLOR = "#fafafa";
  const DARK_THEME_COLOR = "#09090b";

  function getStoredTheme() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
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

  function setStoredTheme(override) {
    try {
      if (override === "dark" || override === "light") {
        window.localStorage.setItem(STORAGE_KEY, override);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  function updateToggleButtons(resolved) {
    const buttons = document.querySelectorAll(".theme-toggle");
    const tooltip = resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";
    buttons.forEach(function (btn) {
      btn.setAttribute("data-tooltip", tooltip);
    });
  }

  function syncTheme(override) {
    const hasOverride = override === "dark" || override === "light";
    const resolved = hasOverride ? override : getSystemTheme();

    const metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) {
      metaScheme.setAttribute("content", hasOverride ? override : "light dark");
    }

    document.documentElement.setAttribute("data-theme", resolved);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
    }

    updateToggleButtons(resolved);

    try {
      window.dispatchEvent(new CustomEvent("dyslinks:themechange", { detail: { theme: resolved } }));
    } catch (_) {
      // ignore if CustomEvent unavailable
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || getSystemTheme();
    const target = current === "dark" ? "light" : "dark";
    const system = getSystemTheme();
    // Two-state toggle: if toggling back to match system preference, remove override so OS changes are followed again.
    const nextOverride = target === system ? null : target;
    setStoredTheme(nextOverride);
    syncTheme(nextOverride);
  }

  // Apply immediately before first paint to avoid FOUC
  syncTheme(getStoredTheme());

  document.addEventListener("DOMContentLoaded", function () {
    updateToggleButtons(document.documentElement.getAttribute("data-theme") || getSystemTheme());
  });

  document.addEventListener("htmx:afterSwap", function () {
    updateToggleButtons(document.documentElement.getAttribute("data-theme") || getSystemTheme());
  });

  // Event delegation so toggle keeps working across HTMX swaps
  document.addEventListener("click", function (event) {
    const target = event.target && event.target.closest ? event.target.closest(".theme-toggle") : null;
    if (!target) return;
    toggleTheme();
  });

  // Follow OS preference changes when no explicit override is stored (never retroactively delete stored overrides)
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", function () {
      const stored = getStoredTheme();
      if (!stored) {
        syncTheme(null);
      }
    });
  }

  // Sync theme override across tabs
  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) {
      syncTheme(getStoredTheme());
    }
  });

  window.dyslinksTheme = {
    get: function () {
      return document.documentElement.getAttribute("data-theme") || getSystemTheme();
    },
    set: function (theme) {
      const override = theme === "dark" || theme === "light" ? theme : null;
      setStoredTheme(override);
      syncTheme(override);
    },
    toggle: toggleTheme,
  };
})();
