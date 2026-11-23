// active Chart.js instances so we can re-theme them live on dark/light switch
let dyslinksCharts = [];
let activeMapPath = null;

const CHART_FONT_FAMILY = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function getChartTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    isDark,
    accent: isDark ? "rgb(129, 140, 248)" : "rgb(79, 70, 229)",
    accentRgb: isDark ? "129, 140, 248" : "79, 70, 229",
    tooltipBg: isDark ? "rgba(24, 24, 27, 0.96)" : "rgba(255, 255, 255, 0.96)",
    tooltipTitle: isDark ? "#fafafa" : "#09090b",
    tooltipBody: isDark ? "#a5b4fc" : "#4f46e5",
    tooltipBorder: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(9, 9, 11, 0.08)",
    tickColor: isDark ? "#a1a1aa" : "#71717a",
    gridColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(9, 9, 11, 0.06)",
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
  let labels = [];

  if (period === "day") {
    const nowHour = new Date().getHours();
    for (let i = 23; i >= 0; --i) {
      let h = nowHour - i;
      if (h < 0) h = 24 + h;
      labels.push(`${String(Math.floor(h)).padStart(2, "0")}:00`);
    }
  }

  if (period === "week") {
    const nowDay = new Date().getDate();
    for (let i = 6; i >= 0; --i) {
      const date = new Date(new Date().setDate(nowDay - i));
      labels.push(`${date.getDate()} ${date.toLocaleString("default", { month: "short" })}`);
    }
  }

  if (period === "month") {
    const nowDay = new Date().getDate();
    for (let i = 29; i >= 0; --i) {
      const date = new Date(new Date().setDate(nowDay - i));
      labels.push(`${date.getDate()} ${date.toLocaleString("default", { month: "short" })}`);
    }
  }

  if (period === "year") {
    const nowMonth = new Date().getMonth();
    for (let i = 11; i >= 0; --i) {
      const date = new Date(new Date().setMonth(nowMonth - i));
      labels.push(`${date.toLocaleString("default", { month: "short" })} ${date.toLocaleString("default", { year: "numeric" })}`);
    }
  }

  return labels;
}

// change stats period for showing charts and data
function changeStatsPeriod(event) {
  const period = event.target.dataset.period;
  if (!period) return;
  const periodItems = document.querySelectorAll("#stats .stats-period [data-period]");
  const buttons = document.querySelectorAll("#stats .stats-nav .nav");
  if (!buttons || !periodItems) return;
  buttons.forEach(b => { b.disabled = false; });
  event.target.disabled = true;
  periodItems.forEach(el => {
    if (el.dataset.period === period) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
  dyslinksCharts.forEach(chart => {
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
  if (name === "firefox") return "Firefox";
  if (name === "chrome") return "Chrome";
  if (name === "edge") return "Edge";
  if (name === "opera") return "Opera";
  if (name === "safari") return "Safari";
  if (name === "other") return "Other";
  if (name === "ie") return "IE";
  return name;
}

// create views chart
function createViewsChart() {
  const canvases = document.querySelectorAll("canvas.visits");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(ctx => {
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

  canvases.forEach(ctx => {
    const data = JSON.parse(ctx.dataset.data);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => beautifyBrowserName(d.name)),
        datasets: [{
          label: "Views",
          data: data.map(d => d.value),
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

  canvases.forEach(ctx => {
    const data = JSON.parse(ctx.dataset.data);
    let max = Array.from(data).sort((a, b) => a.value > b.value ? -1 : 1)[0];

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

    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map(d => d.name.replace(/\[dot\]/g, ".")),
        datasets: [{
          label: "Views",
          data: data.map(d => d.value),
          backgroundColor: data.map(d => `rgba(${theme.accentRgb}, ${Math.max((d.value / max.value) - 0.15, 0.14).toFixed(2)})`),
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
            position: "left",
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
  if (name === "android") return "Android";
  if (name === "ios") return "iOS";
  if (name === "linux") return "Linux";
  if (name === "macos") return "macOS";
  if (name === "windows") return "Windows";
  if (name === "other") return "Other";
  return name;
}

// create operating systems chart
function createOsChart() {
  const canvases = document.querySelectorAll("canvas.os");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(ctx => {
    const data = JSON.parse(ctx.dataset.data);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => beautifyOsName(d.name)),
        datasets: [{
          label: "Views",
          data: data.map(d => d.value),
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
  container.textContent = "";

  const nonZero = entries
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!nonZero.length) {
    const empty = document.createElement("span");
    empty.className = "map-countries-empty";
    empty.textContent = "No country visits recorded in this period";
    container.appendChild(empty);
    return;
  }

  nonZero.slice(0, 8).forEach(item => {
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

    pill.appendChild(nameEl);
    pill.appendChild(countEl);
    container.appendChild(pill);
  });
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

  renderMapCountriesList(raw, nameById);
}

// handle map tooltip hover
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
  tooltip.classList.add("visible");
  tooltip.setAttribute("aria-hidden", "false");

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
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }
  if (activeMapPath) {
    activeMapPath.classList.remove("active");
    activeMapPath = null;
  }
}

function destroyCharts() {
  dyslinksCharts.forEach(chart => {
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
  const activeBtn = document.querySelector("#stats .stats-nav button[disabled]");
  feedMapData(activeBtn ? activeBtn.dataset.period : "day");
}

// re-theme charts automatically when user toggles dark/light mode
window.addEventListener("dyslinks:themechange", function () {
  if (document.querySelector("#stats canvas")) {
    createCharts();
  }
});
