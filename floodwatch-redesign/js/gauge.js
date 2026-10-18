// Draws dashed threshold lines (next impact, flood stage, ...) across the history chart.
const thresholdLinesPlugin = {
  id: "thresholdLines",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales: { y } } = chart;
    (opts.lines || []).forEach(line => {
      const py = y.getPixelForValue(line.value);
      if (py < chartArea.top || py > chartArea.bottom) return;
      ctx.save();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, py);
      ctx.lineTo(chartArea.right, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = line.color;
      ctx.font = '500 12px "DM Mono", ui-monospace, monospace';
      ctx.textAlign = "right";
      ctx.fillText(line.label, chartArea.right - 6, py - 6);
      ctx.restore();
    });
  }
};

function renderReadout(gauge, latest, trend, risk) {
  const cats = gauge.categories;
  const row = (term, value, sub) =>
    `<div class="readout-row"><dt>${term}</dt><dd><span class="readout-value">${value}</span>${sub ? `<span class="readout-sub">${sub}</span>` : ""}</dd></div>`;
  const rel = stage => {
    const d = stage - latest.height;
    if (Math.abs(d) < 0.005) return "at this level now";
    return d > 0 ? `${d.toFixed(2)} ft higher than now` : `${Math.abs(d).toFixed(2)} ft above it now`;
  };

  let html = row("Height now", `${escapeHTML(ft(latest.height))} ft`,
    `${escapeHTML(timeAgo(latest.time))} · ${escapeHTML(clockTime(latest.time))}`);
  const tp = trendParts(trend);
  html += row("Trend", `${trendIcon(trend)}${escapeHTML(tp.word)}`, escapeHTML(tp.detail));
  if (risk.next) html += row("Next listed impact", `${escapeHTML(ft(risk.next.stage))} ft`, escapeHTML(rel(risk.next.stage)));
  html += row("NWS flood stage", `${escapeHTML(ft(cats.minor))} ft`, escapeHTML(rel(cats.minor)));
  document.getElementById("feature-readout").innerHTML = html;

  let impact = "";
  if (risk.affected.length) {
    impact += `<span class="impact-now"><strong>Happening at this level:</strong> ${escapeHTML(risk.affected[risk.affected.length - 1].statement)}</span>`;
  }
  if (risk.next) {
    impact += `<span><strong>At ${escapeHTML(ft(risk.next.stage))} ft:</strong> ${escapeHTML(risk.next.statement)}</span>`;
  }
  document.getElementById("feature-impact").innerHTML = impact;
}

function renderLadder(gauge, height) {
  const cats = gauge.categories;
  const catNames = { action: "NWS action stage", minor: "NWS flood stage (minor flooding)", moderate: "Moderate flood stage", major: "Major flood stage" };
  const items = gauge.impacts.map(i => ({ stage: i.stage, text: i.statement, kind: "impact" }));
  Object.entries(catNames).forEach(([key, name]) => {
    if (typeof cats[key] === "number") items.push({ stage: cats[key], text: name, kind: "category" });
  });
  items.sort((a, b) => b.stage - a.stage || (a.kind === "category" ? -1 : 1));

  let html = "";
  let nowPlaced = false;
  items.forEach(item => {
    if (!nowPlaced && item.stage <= height) {
      html += `<li class="ladder-now"><span class="ladder-stage">${escapeHTML(ft(height))} ft</span><span>River is here now</span></li>`;
      nowPlaced = true;
    }
    const reached = item.stage <= height;
    const text = item.kind === "category" ? `<strong>${escapeHTML(item.text)}</strong>` : escapeHTML(item.text);
    html += `<li class="${reached ? "is-reached" : ""}"><span class="ladder-stage">${escapeHTML(ft(item.stage))} ft</span><span>${text}</span></li>`;
  });
  if (!nowPlaced) {
    html += `<li class="ladder-now"><span class="ladder-stage">${escapeHTML(ft(height))} ft</span><span>River is here now, below every listed impact</span></li>`;
  }
  document.getElementById("impact-ladder").innerHTML = html;
}

function renderChart(readings, gauge, risk) {
  const heights = readings.map(r => r.height);
  const dataMin = Math.min(...heights);
  const dataMax = Math.max(...heights);
  // Always include the next listed impact so you can see how far away it is.
  const top = Math.max(dataMax, risk.next ? risk.next.stage : dataMax) + 0.5;
  const bottom = Math.max(0, dataMin - 0.5);

  const lines = [];
  if (risk.next) lines.push({ value: risk.next.stage, label: `${ft(risk.next.stage)} ft · next listed impact`, color: "#B86A00" });
  [["action", "action stage", "#8A4F00"], ["minor", "flood stage", "#A33B0B"], ["major", "major flood stage", "#8E1426"]]
    .forEach(([key, label, color]) => {
      const v = gauge.categories[key];
      if (typeof v === "number" && !lines.some(l => Math.abs(l.value - v) < 0.01)) {
        lines.push({ value: v, label: `${ft(v)} ft · ${label}`, color });
      }
    });

  const offChart = lines.filter(l => l.value > top || l.value < bottom);
  document.getElementById("chart-note").textContent = offChart.length
    ? `Not shown because they're above this range: ${offChart.map(l => l.label).join(", ")}.`
    : "";

  if (typeof Chart === "undefined") {
    document.getElementById("chart-note").textContent = "The chart library couldn't load. Check your connection and reload.";
    return;
  }

  new Chart(document.getElementById("history-chart"), {
    type: "line",
    data: {
      labels: readings.map(r => r.time.toLocaleString([], { weekday: "short", hour: "numeric" })),
      datasets: [{
        label: "Gauge height (ft)",
        data: heights,
        borderColor: "#3A86DA",
        backgroundColor: "rgba(58, 134, 218, 0.12)",
        fill: "start",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        thresholdLines: { lines },
        tooltip: {
          callbacks: {
            title: items => readings[items[0].dataIndex].time.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
            label: item => `${ft(item.parsed.y)} ft`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, color: "#56697C", font: { family: "Figtree" } } },
        y: {
          min: Math.floor(bottom * 2) / 2,
          max: Math.ceil(top * 2) / 2,
          grid: { color: "#E7EDF2" },
          ticks: { color: "#56697C", font: { family: "DM Mono" }, callback: v => `${v} ft` }
        }
      }
    },
    plugins: [thresholdLinesPlugin]
  });
}

async function loadGaugeDetail() {
  const statusEl = document.getElementById("status");
  const siteId = new URLSearchParams(window.location.search).get("id");
  const gauge = gaugeThresholds[siteId];
  const showError = msg => { statusEl.hidden = false; statusEl.textContent = msg; };

  if (!siteId || !gauge) {
    document.getElementById("gauge-title").textContent = "Gauge not found";
    document.getElementById("data-status").textContent = "";
    showError("Go back to the dashboard and pick a gauge.");
    return;
  }

  document.getElementById("nws-link").href = `https://water.noaa.gov/gauges/${encodeURIComponent(gauge.nwsId)}`;

  try {
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${siteId}&parameterCd=00065&period=P7D&siteStatus=all&format=json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`USGS returned status ${response.status}`);
    }
    const data = await response.json();
    const series = parseSeries(data.value.timeSeries[0]);

    if (!series || !series.latest) {
      throw new Error("No readings returned for this gauge");
    }

    const names = splitSiteName(series.siteName);
    const latest = series.latest;
    const risk = getRiskStatus(latest.height, gauge);
    const trend = computeTrend(series.readings);

    document.title = `FloodWatch: ${names.river}${names.place ? " at " + names.place : ""}`;
    document.getElementById("gauge-title").textContent = names.place ? `${names.river} at ${names.place}` : names.river;
    document.getElementById("gauge-eyebrow").textContent = `USGS ${siteId} · NWS ${gauge.nwsId}`;
    document.getElementById("data-status").textContent = `USGS · checked ${clockTime(new Date())}`;

    document.getElementById("feature-status").innerHTML =
      `${tierBadge(risk.tier)}<span class="verified">Verified thresholds</span>` +
      (isStale(latest.time) ? `<span class="ago is-stale">Latest reading is ${escapeHTML(timeAgo(latest.time).replace(" ago", ""))} old</span>` : "");
    renderReadout(gauge, latest, trend, risk);

    const drawDiagram = () => {
      document.getElementById("feature-diagram").innerHTML = crossSectionSVG({
        height: latest.height, categories: gauge.categories, next: risk.next, tier: risk.tier,
        label: series.siteName, compact: window.matchMedia("(max-width: 600px)").matches
      });
    };
    drawDiagram();
    window.matchMedia("(max-width: 600px)").addEventListener("change", drawDiagram);
    document.getElementById("feature").hidden = false;

    renderLadder(gauge, latest.height);
    renderChart(series.readings, gauge, risk);
  } catch (error) {
    console.error("Failed to load gauge detail:", error);
    document.getElementById("gauge-title").textContent = "Gauge detail";
    document.getElementById("data-status").textContent = "Couldn't reach USGS";
    showError("Couldn't load this gauge's history from USGS just now. Try reloading in a minute.");
    renderLadder(gauge, -Infinity);
    document.querySelector("#impact-ladder .ladder-now")?.remove();
  }
}

loadGaugeDetail();
