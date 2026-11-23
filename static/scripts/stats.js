// active Chart.js instances so we can re-theme them live on dark/light switch
let dyslinksCharts = [];

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
  const canvases = document.querySelector("#stats").querySelectorAll("[data-period]");
  const buttons = document.querySelector("#stats").querySelectorAll(".nav");
  if (!buttons || !canvases) return;
  buttons.forEach(b => b.disabled = false);
  event.target.disabled = true;
  canvases.forEach(canvas => {
    if (canvas.dataset.period === period) {
      canvas.classList.remove("hidden");
    } else {
      canvas.classList.add("hidden");
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

    const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, `rgba(${theme.accentRgb}, 0.42)`);
    gradient.addColorStop(1, `rgba(${theme.accentRgb}, 0.02)`);

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Views",
          data,
          tension: 0.35,
          elements: {
            point: {
              pointRadius: 0,
              pointHoverRadius: 5
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
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        responsive: true,
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
    // reset the display: block style that chart.js applies automatically
    ctx.style.display = "";
  });
}

// create browsers chart
function createBrowsersChart() {
  const canvases = document.querySelectorAll("canvas.browsers");
  if (!canvases || !canvases.length) return;
  const theme = getChartTheme();

  canvases.forEach(ctx => {
    const data = JSON.parse(ctx.dataset.data);

    const gradient = ctx.getContext("2d").createLinearGradient(500, 0, 0, 0);
    const gradientHover = ctx.getContext("2d").createLinearGradient(500, 0, 0, 0);
    gradient.addColorStop(0, `rgba(${theme.accentRgb}, 0.85)`);
    gradient.addColorStop(1, `rgba(${theme.accentRgb}, 0.2)`);
    gradientHover.addColorStop(0, `rgba(${theme.accentRgb}, 0.95)`);
    gradientHover.addColorStop(1, `rgba(${theme.accentRgb}, 0.45)`);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => beautifyBrowserName(d.name)),
        datasets: [{
          label: "Views",
          data: data.map(d => d.value),
          backgroundColor: gradient,
          borderColor: theme.accent,
          borderWidth: 1,
          borderRadius: 6,
          hoverBackgroundColor: gradientHover,
          hoverBorderWidth: 1.5
        }]
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        responsive: true,
        interaction: {
          intersect: false,
          mode: "index",
          axis: "y"
        },
        scales: {
          x: {
            grace: "5%",
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: {
              maxTicksLimit: 6,
              color: theme.tickColor
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: theme.tickColor }
          }
        }
      }
    });

    dyslinksCharts.push(chart);
    // reset the display: block style that chart.js applies automatically
    ctx.style.display = "";
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
      data.push({ name: "No views.", value: 1 });
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
        plugins: {
          legend: {
            position: "left",
            labels: {
              boxWidth: 18,
              color: theme.legendColor,
              font: { size: 12 }
            }
          },
          tooltip: getTooltipOptions(theme, tooltipEnabled)
        },
        responsive: false,
      }
    });

    dyslinksCharts.push(chart);
    // reset the display: block style that chart.js applies automatically
    ctx.style.display = "";
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

    const gradient = ctx.getContext("2d").createLinearGradient(500, 0, 0, 0);
    const gradientHover = ctx.getContext("2d").createLinearGradient(500, 0, 0, 0);
    gradient.addColorStop(0, `rgba(${theme.accentRgb}, 0.85)`);
    gradient.addColorStop(1, `rgba(${theme.accentRgb}, 0.2)`);
    gradientHover.addColorStop(0, `rgba(${theme.accentRgb}, 0.95)`);
    gradientHover.addColorStop(1, `rgba(${theme.accentRgb}, 0.45)`);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => beautifyOsName(d.name)),
        datasets: [{
          label: "Views",
          data: data.map(d => d.value),
          backgroundColor: gradient,
          borderColor: theme.accent,
          borderWidth: 1,
          borderRadius: 6,
          hoverBackgroundColor: gradientHover,
          hoverBorderWidth: 1.5
        }]
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: {
            display: false,
          },
          tooltip: getTooltipOptions(theme)
        },
        responsive: true,
        interaction: {
          intersect: false,
          mode: "index",
          axis: "y"
        },
        scales: {
          x: {
            grace: "5%",
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: {
              maxTicksLimit: 6,
              color: theme.tickColor
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: theme.tickColor }
          }
        }
      }
    });

    dyslinksCharts.push(chart);
    // reset the display: block style that chart.js applies automatically
    ctx.style.display = "";
  });
}

// add data to the map
function feedMapData(period) {
  const map = document.querySelector("svg.map");
  if (!map) return;
  const paths = map.querySelectorAll("path");
  if (!paths || !paths.length) return;

  let data = JSON.parse(map.dataset[period || "day"]);
  if (!data) return;

  let max = data.sort((a, b) => a.value > b.value ? -1 : 1)[0];

  if (!max) max = { value: 1 };

  data = data.reduce((a, c) => ({ ...a, [c.name]: c.value }), {});

  for (let i = 0; i < paths.length; ++i) {
    const id = paths[i].dataset.id;
    const views = data[id] || 0;
    paths[i].dataset.views = views;
    const colorLevel = Math.ceil((views / max.value) * 6);
    for (let j = 1; j < 7; j++) {
      paths[i].classList.remove(`color-${j}`);
    }
    paths[i].classList.add(`color-${colorLevel}`);
    paths[i].dataset.views = views;
  }
}

// handle map tooltip hover
function mapTooltipHoverOver(evt) {
  const e = evt || window.event;
  const tooltip = document.querySelector("#map-tooltip");
  if (!tooltip || !e || !e.target) return;
  if (!e.target.dataset.id) return mapTooltipHoverOut();
  if (!tooltip.classList.contains("active")) {
    tooltip.classList.add("visible");
  }
  tooltip.dataset.tooltip = `${e.target.ariaLabel}: ${e.target.dataset.views || 0}`;
  const rect = e.target.getBoundingClientRect();
  tooltip.style.top = rect.top + (rect.height / 2) + "px";
  tooltip.style.left = rect.left + (rect.width / 2) + "px";
  e.target.classList.add("active");
}

function mapTooltipHoverOut() {
  const tooltip = document.querySelector("#map-tooltip");
  const map = document.querySelector("svg.map");
  if (!tooltip || !map) return;
  const paths = map.querySelectorAll("path");
  tooltip.classList.remove("visible");
  for (let i = 0; i < paths.length; ++i) {
    paths[i].classList.remove("active");
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
