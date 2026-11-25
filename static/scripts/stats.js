// active Chart.js instances so we can re-theme them live on dark/light switch
let dyslinksCharts = [];
let activeMapPath = null;

const CHART_FONT_FAMILY = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function getChartTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    isDark,
    accent: isDark ? "rgb(139, 124, 248)" : "rgb(124, 107, 246)",
    accentRgb: isDark ? "139, 124, 248" : "124, 107, 246",
    tooltipBg: isDark ? "rgba(25, 25, 34, 0.96)" : "rgba(255, 255, 255, 0.96)",
    tooltipTitle: isDark ? "#f4f4f5" : "#18181b",
    tooltipBody: isDark ? "#a69bff" : "#7c6bf6",
    tooltipBorder: isDark ? "#2c2c38" : "#e4e4e7",
    tickColor: isDark ? "#8e8e9a" : "#71717a",
    gridColor: isDark ? "rgba(34, 34, 41, 0.85)" : "rgba(228, 228, 231, 0.75)",
    legendColor: isDark ? "#d4d4d8" : "#3f3f46",
  };
}

function getTooltipOptions(theme, enabled = true) {
  return {
    enabled,
    backgroundColor: theme.tooltipBg,
    titleColor: theme.tooltipTitle,
    titleFont: { family: CHART_FONT_FAMILY, weight: "600", size: 12 },
    bodyFont: { family: CHART_FONT_FAMILY, weight: "600", size: 13 },
    bodyColor: theme.tooltipBody,
    padding: 10,
    cornerRadius: 8,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    displayColors: false,
  };
}

// create views chart label
function createViewsChartLabel(ctx) {
  const period = ctx.dataset.period;
  const now = new Date();
  const labels = [];

  if (period === "day") {
    const nowHour = now.getHours();
    for (let i = 23; i >= 0; --i) {
      let h = nowHour - i;
      if (h < 0) h = 24 + h;
      labels.push(`${String(Math.floor(h)).padStart(2, "0")}:00`);
    }
  }

  if (period === "week") {
    for (let i = 6; i >= 0; --i) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      labels.push(`${date.getDate()} ${date.toLocaleString("default", { month: "short" })}`);
    }
  }

  if (period === "month") {
    for (let i = 29; i >= 0; --i) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      labels.push(`${date.getDate()} ${date.toLocaleString("default", { month: "short" })}`);
    }
  }

  if (period === "year") {
    for (let i = 11; i >= 0; --i) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${date.toLocaleString("default", { month: "short" })} ${date.toLocaleString("default", { year: "numeric" })}`);
    }
  }

  return labels;
}

// change stats period for showing charts and data
function changeStatsPeriod(event) {
  const btn = event.currentTarget || (event.target.closest ? event.target.closest("button[data-period]") : event.target);
  const period = btn && btn.dataset ? btn.dataset.period : null;
  if (!period) return;
  const periodItems = document.querySelectorAll("#stats .stats-period [data-period]");
  const buttons = document.querySelectorAll("#stats .stats-nav .nav");
  if (!buttons || !periodItems) return;
  mapTooltipHoverOut();
  buttons.forEach(function (b) {
    const isActive = b === btn;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  periodItems.forEach(function (el) {
    el.classList.toggle("hidden", el.dataset.period !== period);
  });
  dyslinksCharts.forEach(function (chart) {
    try {
      if (chart.canvas && !chart.canvas.classList.contains("hidden")) {
        chart.resize();
      }
    } catch (_) {
      // ignore resize errors
    }
  });
  feedMapData(period);
}

// beautify browser labels
function beautifyBrowserName(name) {
  const map = {
    firefox: "Firefox",
    chrome: "Chrome",
    edge: "Edge",
    opera: "Opera",
    safari: "Safari",
    other: "Other",
    ie: "IE",
  };
  return map[name] || name;
}

// create views chart
function createViewsChart() {
  const canvases = document.querySelectorAll("canvas.visits");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(function (ctx) {
    const data = JSON.parse(ctx.dataset.data);
    const period = ctx.dataset.period;

    const labels = createViewsChartLabel(ctx);
    const maxTicksLimitX = period === "year" ? 6 : period === "month" ? 15 : 12;

    const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, `rgba(${theme.accentRgb}, 0.36)`);
    gradient.addColorStop(1, `rgba(${theme.accentRgb}, 0.02)`);

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Views",
          data,
          tension: 0.3,
          elements: {
            point: {
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: theme.accent
            }
          },
          fill: {
            target: "start",
          },
          backgroundColor: gradient,
          borderColor: theme.accent,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        interaction: {
          intersect: false,
          usePointStyle: true,
          mode: "index",
        },
        scales: {
          y: {
            grace: "10%",
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: {
              precision: 0,
              maxTicksLimit: 5,
              color: theme.tickColor
            }
          },
          x: {
            grid: { color: theme.gridColor },
            ticks: {
              maxTicksLimit: maxTicksLimitX,
              color: theme.tickColor
            }
          }
        }
      }
    });

    dyslinksCharts.push(chart);
  });
}

// create browsers chart
function createBrowsersChart() {
  const canvases = document.querySelectorAll("canvas.browsers");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(function (ctx) {
    const data = JSON.parse(ctx.dataset.data);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(function (d) { return beautifyBrowserName(d.name); }),
        datasets: [{
          label: "Views",
          data: data.map(function (d) { return d.value; }),
          backgroundColor: `rgba(${theme.accentRgb}, 0.72)`,
          borderColor: theme.accent,
          borderWidth: 1,
          borderRadius: 6,
          barThickness: 18,
          maxBarThickness: 22,
          hoverBackgroundColor: `rgba(${theme.accentRgb}, 0.92)`,
          hoverBorderWidth: 1.5
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        interaction: {
          intersect: false,
          mode: "index",
          axis: "y"
        },
        scales: {
          x: {
            grace: "10%",
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: {
              precision: 0,
              maxTicksLimit: 6,
              color: theme.tickColor
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
              color: theme.tickColor
            }
          }
        }
      }
    });

    dyslinksCharts.push(chart);
  });
}

// create referrers chart
function createReferrersChart() {
  const canvases = document.querySelectorAll("canvas.referrers");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(function (ctx) {
    const data = JSON.parse(ctx.dataset.data);
    let max = data.toSorted(function (a, b) { return b.value - a.value; })[0];

    let tooltipEnabled = true;
    let hoverBackgroundColor = `rgba(${theme.accentRgb}, 0.95)`;
    let hoverBorderWidth = 2;
    let borderColor = `rgba(${theme.accentRgb}, 0.9)`;
    if (data.length === 0) {
      data.push({ name: "No views", value: 1 });
      max = { value: 1000 };
      tooltipEnabled = false;
      hoverBackgroundColor = `rgba(${theme.accentRgb}, 0.14)`;
      hoverBorderWidth = 1;
      borderColor = `rgba(${theme.accentRgb}, 0.25)`;
    }

    const maxVal = max && max.value > 0 ? max.value : 1;

    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map(function (d) { return d.name.replace(/\[dot\]/g, "."); }),
        datasets: [{
          label: "Views",
          data: data.map(function (d) { return d.value; }),
          backgroundColor: data.map(function (d) { return `rgba(${theme.accentRgb}, ${Math.max((d.value / maxVal) - 0.15, 0.14).toFixed(2)})`; }),
          borderWidth: 1,
          borderColor,
          hoverBackgroundColor,
          hoverBorderWidth,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: window.innerWidth <= 640 ? "bottom" : "left",
            labels: {
              boxWidth: 14,
              boxHeight: 14,
              padding: 14,
              color: theme.legendColor,
              font: { family: CHART_FONT_FAMILY, size: 12.5 }
            }
          },
          tooltip: getTooltipOptions(theme, tooltipEnabled)
        }
      }
    });

    dyslinksCharts.push(chart);
  });
}

// beautify OS labels
function beautifyOsName(name) {
  const map = {
    android: "Android",
    ios: "iOS",
    linux: "Linux",
    macos: "macOS",
    windows: "Windows",
    other: "Other",
  };
  return map[name] || name;
}

// create operating systems chart
function createOsChart() {
  const canvases = document.querySelectorAll("canvas.os");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(function (ctx) {
    const data = JSON.parse(ctx.dataset.data);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(function (d) { return beautifyOsName(d.name); }),
        datasets: [{
          label: "Views",
          data: data.map(function (d) { return d.value; }),
          backgroundColor: `rgba(${theme.accentRgb}, 0.72)`,
          borderColor: theme.accent,
          borderWidth: 1,
          borderRadius: 6,
          barThickness: 18,
          maxBarThickness: 22,
          hoverBackgroundColor: `rgba(${theme.accentRgb}, 0.92)`,
          hoverBorderWidth: 1.5
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        interaction: {
          intersect: false,
          mode: "index",
          axis: "y"
        },
        scales: {
          x: {
            grace: "10%",
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: {
              precision: 0,
              maxTicksLimit: 6,
              color: theme.tickColor
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
              color: theme.tickColor
            }
          }
        }
      }
    });

    dyslinksCharts.push(chart);
  });
}

// render compact country breakdown below map for small/unknown regions
function renderMapCountriesList(entries, nameById) {
  const container = document.getElementById("map-countries-list");
  if (!container) return;

  const nonZero = entries
    .filter(function (item) { return item.value > 0; })
    .toSorted(function (a, b) { return b.value - a.value; });

  if (!nonZero.length) {
    const empty = document.createElement("span");
    empty.className = "map-countries-empty";
    empty.textContent = "No country visits recorded in this period";
    container.replaceChildren(empty);
    return;
  }

  const pills = nonZero.slice(0, 8).map(function (item) {
    const code = String(item.name || "").toLowerCase();
    const label = code === "unknown"
      ? "Unknown"
      : (nameById[code] || code.toUpperCase());

    const pill = document.createElement("span");
    pill.className = "map-country-pill";

    const nameEl = document.createElement("span");
    nameEl.className = "map-country-name";
    nameEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "map-country-count";
    countEl.textContent = String(item.value);

    pill.append(nameEl, countEl);
    return pill;
  });

  container.replaceChildren(...pills);
}

// add data to the map
function feedMapData(period) {
  const map = document.querySelector("svg.map");
  if (!map) return;
  const paths = map.querySelectorAll("path");
  if (!paths || !paths.length) return;

  let raw = [];
  try {
    raw = JSON.parse(map.dataset[period || "day"] || "[]");
  } catch (_) {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];

  const nameById = Object.create(null);
  for (let i = 0; i < paths.length; ++i) {
    const id = String(paths[i].dataset.id || "").toLowerCase();
    if (id) {
      nameById[id] = paths[i].getAttribute("aria-label") || id.toUpperCase();
    }
  }

  const countsById = Object.create(null);
  let maxMapped = 0;
  for (let i = 0; i < raw.length; ++i) {
    const key = String(raw[i].name || "").toLowerCase();
    const val = Number(raw[i].value) || 0;
    countsById[key] = (countsById[key] || 0) + val;
    if (nameById[key] && countsById[key] > maxMapped) {
      maxMapped = countsById[key];
    }
  }

  const denom = maxMapped > 0 ? maxMapped : 1;

  for (let i = 0; i < paths.length; ++i) {
    const id = String(paths[i].dataset.id || "").toLowerCase();
    const views = countsById[id] || 0;
    paths[i].dataset.views = String(views);
    for (let j = 0; j < 7; j++) {
      paths[i].classList.remove(`color-${j}`);
    }
    if (views > 0) {
      const level = Math.min(6, Math.max(1, Math.ceil((views / denom) * 6)));
      paths[i].classList.add(`color-${level}`);
    }
  }

  const aggregatedEntries = Object.entries(countsById).map(function ([name, value]) { return { name, value }; });
  renderMapCountriesList(aggregatedEntries, nameById);
}

// handle map tooltip hover (uses top-layer popover="manual" when supported)
function mapTooltipHoverOver(evt) {
  const e = evt || window.event;
  const tooltip = document.querySelector("#map-tooltip");
  if (!tooltip || !e || !e.target) return;
  const target = e.target.closest ? e.target.closest("path[data-id]") : e.target;
  if (!target || !target.dataset || !target.dataset.id) {
    mapTooltipHoverOut();
    return;
  }

  if (activeMapPath && activeMapPath !== target) {
    activeMapPath.classList.remove("active");
  }
  activeMapPath = target;
  target.classList.add("active");

  const name = target.getAttribute("aria-label") || target.dataset.id.toUpperCase();
  const views = target.dataset.views || "0";
  tooltip.textContent = `${name}: ${views}`;

  if (typeof tooltip.showPopover === "function") {
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

  const x = typeof e.clientX === "number" ? e.clientX : 0;
  const y = typeof e.clientY === "number" ? e.clientY : 0;
  const pad = 12;
  const halfW = (tooltip.offsetWidth || 80) / 2;
  const clampedX = Math.min(Math.max(x, halfW + pad), window.innerWidth - halfW - pad);
  const clampedY = Math.max(y, 44);
  tooltip.style.left = clampedX + "px";
  tooltip.style.top = clampedY + "px";
}

function mapTooltipHoverOut() {
  const tooltip = document.querySelector("#map-tooltip");
  if (tooltip) {
    if (typeof tooltip.hidePopover === "function") {
      try {
        if (tooltip.matches(":popover-open")) {
          tooltip.hidePopover();
        }
      } catch (_) {
        // ignore
      }
    }
    tooltip.classList.remove("visible");
  }
  if (activeMapPath) {
    activeMapPath.classList.remove("active");
    activeMapPath = null;
  }
}

window.addEventListener("scroll", mapTooltipHoverOut, { passive: true });
document.addEventListener("keydown", function (evt) {
  if (evt.key === "Escape" && activeMapPath) {
    mapTooltipHoverOut();
  }
});
document.addEventListener("pointerdown", function (evt) {
  if (activeMapPath && (!evt.target || !evt.target.closest || !evt.target.closest("svg.map"))) {
    mapTooltipHoverOut();
  }
});

function destroyCharts() {
  dyslinksCharts.forEach(function (chart) {
    try {
      chart.destroy();
    } catch (_) {
      // ignore destroy errors
    }
  });
  dyslinksCharts = [];
}

// create stats charts
function createCharts() {
  if (typeof Chart === "undefined") {
    setTimeout(function () { createCharts(); }, 100);
    return;
  }
  if (Chart.defaults && Chart.defaults.font) {
    Chart.defaults.font.family = CHART_FONT_FAMILY;
  }
  destroyCharts();
  createViewsChart();
  createBrowsersChart();
  createReferrersChart();
  createOsChart();
  const activeBtn = document.querySelector("#stats .stats-nav button[aria-pressed='true']")
    || document.querySelector("#stats .stats-nav button.active");
  feedMapData(activeBtn ? activeBtn.dataset.period : "day");
}

// re-theme charts automatically when user toggles dark/light mode
window.addEventListener("dyslinks:themechange", function () {
  if (document.querySelector("#stats canvas")) {
    createCharts();
  }
});

// Strict-CSP HTMX hooks & delegated stats UI listeners
document.addEventListener("htmx:configRequest", function (evt) {
  if (evt.target && evt.target.id === "stats-section") {
    const params = typeof getQueryParams === "function" ? getQueryParams() : {};
    const id = params.id || "";
    evt.detail.path = "/api/links/" + encodeURIComponent(id) + "/stats";
  }
});

document.addEventListener("htmx:afterSwap", function (evt) {
  if (evt.target && evt.target.id === "stats-section") {
    if (typeof trimText === "function") trimText(".stats-info p", 80);
    if (typeof formatDateHour === "function") formatDateHour("#stats .last-update-value");
    createCharts();
  }
});

document.addEventListener("click", function (evt) {
  const btn = evt.target && evt.target.closest ? evt.target.closest("[data-action='stats-period']") : null;
  if (btn) {
    changeStatsPeriod({ currentTarget: btn, target: evt.target });
  }
});

document.addEventListener("mousemove", function (evt) {
  if (evt.target && evt.target.closest && evt.target.closest("svg.map")) {
    mapTooltipHoverOver(evt);
  } else if (activeMapPath) {
    mapTooltipHoverOut();
  }
});

document.addEventListener("pointerdown", function (evt) {
  if (evt.target && evt.target.closest && evt.target.closest("svg.map")) {
    mapTooltipHoverOver(evt);
  }
});
