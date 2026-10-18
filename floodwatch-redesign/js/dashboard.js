const TOWNS = {
  "lincolnshire":  { label: "Lincolnshire, IL",  lat: 42.19,  lon: -87.91 },
  "buffalo-grove": { label: "Buffalo Grove, IL", lat: 42.166, lon: -87.963 },
  "vernon-hills":  { label: "Vernon Hills, IL",  lat: 42.219, lon: -87.980 },
  "gurnee":        { label: "Gurnee, IL",        lat: 42.370, lon: -87.902 }
};

function verifiedGauges() {
  return Object.entries(gaugeThresholds).map(([usgsId, g]) => ({ usgsId, verified: true, ...g }));
}

const state = {
  gauges: verifiedGauges(),
  models: [],
  selectedId: null,     // gauge the user picked for the diagram; null = automatic
  origin: null,         // { lat, lon, label } when a town or "my location" is chosen
  lastChecked: null
};

const demoTier = new URLSearchParams(window.location.search).get("demo");

function demoHeight(gauge, tier) {
  if (!gauge || !tier) {
    return null;
  }

  const keyFor = { watch: "action", warning: "minor", major: "major" };
  const key = keyFor[tier.toLowerCase()];

  return gauge.categories[key] || null;
}

// One gauge + its USGS series -> everything the page needs to draw it.
function buildModel(gauge, entry) {
  const series = parseSeries(entry);
  const names = splitSiteName(series?.siteName || gauge.name || gauge.usgsId);
  const simulated = demoHeight(gauge, demoTier);
  const latest = series?.latest || null;
  const base = {
    id: gauge.usgsId,
    gauge,
    names,
    lat: series?.lat ?? null,
    lon: series?.lon ?? null,
    miles: gauge.miles,
    verified: !!gauge.verified,
    simulated: simulated !== null
  };

  if (simulated === null && !latest) {
    return { ...base, hasData: false, tier: "Unknown" };
  }

  const height = simulated !== null ? simulated : latest.height;
  const risk = getRiskStatus(height, gauge);
  return {
    ...base,
    hasData: true,
    height,
    risk,
    tier: risk.tier,
    time: simulated !== null ? null : latest.time,
    trend: simulated !== null ? null : computeTrend(series.readings),
    headroom: risk.next ? risk.next.stage - height : null
  };
}

function detailLink(m) {
  return m.verified
    ? { href: `gauge.html?id=${encodeURIComponent(m.id)}`, text: "7-day history", external: false }
    : { href: `https://water.noaa.gov/gauges/${encodeURIComponent(m.gauge.nwsId)}`, text: "View on NWS", external: true };
}

function linkHTML(m, cls = "row-link") {
  const l = detailLink(m);
  return `<a class="${cls}" href="${l.href}"${l.external ? ' target="_blank" rel="noopener"' : ""}>${escapeHTML(l.text)}<span aria-hidden="true"> →</span>${l.external ? '<span class="sr-only"> (opens in a new tab)</span>' : ""}</a>`;
}

// Which gauge goes in the big diagram: the user's pick, else the most serious, else the closest to its next impact.
function pickFeatured(models) {
  const live = models.filter(m => m.hasData);
  if (state.selectedId) {
    const chosen = live.find(m => m.id === state.selectedId);
    if (chosen) return chosen;
  }
  return live.slice().sort((a, b) =>
    (TIER_ORDER[b.tier] - TIER_ORDER[a.tier]) ||
    ((a.headroom ?? Infinity) - (b.headroom ?? Infinity))
  )[0] || null;
}

function gaugeLabel(m) {
  return m.names.place ? `${m.names.river} at ${m.names.place}` : m.names.river;
}

function renderSummary(models) {
  const live = models.filter(m => m.hasData);
  const heading = document.getElementById("summary-heading");
  const text = document.getElementById("summary-text");

  if (live.length === 0) {
    heading.textContent = "Local river conditions";
    text.textContent = "USGS isn't reporting recent readings for these gauges right now.";
    return;
  }

  const count = tier => live.filter(m => m.tier === tier).length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const major = count("Major"), warning = count("Warning"), watch = count("Watch");

  if (major) heading.textContent = `Major flooding at ${plural(major, "gauge")}.`;
  else if (warning) heading.textContent = `${plural(warning, "gauge")} at flood stage.`;
  else if (watch) heading.textContent = `${plural(watch, "gauge")} on watch, none at flood stage.`;
  else heading.textContent = live.length === 1 ? "The gauge is below flood levels." : `All ${live.length} gauges are below flood levels.`;

  const closest = live
    .filter(m => m.headroom !== null)
    .sort((a, b) => a.headroom - b.headroom)[0];
  const rising = live.filter(m => m.trend?.dir === "rising").length;

  let sentence = "";
  if (closest) {
    sentence = `Closest to its next listed impact: ${gaugeLabel(closest)}, ${closest.headroom.toFixed(2)} ft below ${ft(closest.risk.next.stage)} ft. `;
  }
  if (!demoTier) {
    sentence += rising === 0 ? "No gauges are rising right now." : `${plural(rising, "gauge")} rising over the last few hours.`;
  }
  if (live.length < models.length) {
    sentence += ` ${plural(models.length - live.length, "gauge")} not reporting.`;
  }
  text.textContent = sentence.trim();
}

function readoutRow(term, value, sub) {
  return `<div class="readout-row"><dt>${term}</dt><dd><span class="readout-value">${value}</span>${sub ? `<span class="readout-sub">${sub}</span>` : ""}</dd></div>`;
}

function aboveBelow(stage, height) {
  const diff = stage - height;
  if (Math.abs(diff) < 0.005) return "at this level now";
  return diff > 0 ? `${diff.toFixed(2)} ft higher than now` : `${Math.abs(diff).toFixed(2)} ft above it now`;
}

function renderFeature(models) {
  const wrap = document.getElementById("feature");
  const m = pickFeatured(models);
  if (!m) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const auto = !state.selectedId || state.selectedId !== m.id;
  document.getElementById("feature-kicker").textContent = auto
    ? (m.tier !== "Normal" ? "Most serious right now" : "Closest to its next listed impact")
    : "Selected gauge";
  document.getElementById("feature-name").innerHTML =
    `${escapeHTML(m.names.river)}${m.names.place ? ` <span class="feature-place">at ${escapeHTML(m.names.place)}</span>` : ""}`;

  document.getElementById("feature-status").innerHTML =
    `${tierBadge(m.tier)}${m.verified ? '<span class="verified">Verified thresholds</span>' : ""}${m.simulated ? '<span class="sim">Simulated</span>' : ""}`;

  const cats = m.gauge.categories || {};
  let rows = readoutRow("Height now", `${escapeHTML(ft(m.height))} ft`,
    m.time ? `${escapeHTML(timeAgo(m.time))} · ${escapeHTML(clockTime(m.time))}` : "simulated reading");
  const tp = m.simulated ? { word: "Not shown", detail: "simulated heights have no history" } : trendParts(m.trend);
  rows += readoutRow("Trend", `${trendIcon(m.trend)}${escapeHTML(tp.word)}`, escapeHTML(tp.detail));
  if (m.risk.next) {
    rows += readoutRow("Next listed impact", `${escapeHTML(ft(m.risk.next.stage))} ft`, escapeHTML(aboveBelow(m.risk.next.stage, m.height)));
  }
  if (cats.minor) {
    rows += readoutRow("NWS flood stage", `${escapeHTML(ft(cats.minor))} ft`, escapeHTML(aboveBelow(cats.minor, m.height)));
  }
  document.getElementById("feature-readout").innerHTML = rows;

  const impactEl = document.getElementById("feature-impact");
  let impactHTML = "";
  if (m.risk.affected.length) {
    const nowStatement = m.risk.affected[m.risk.affected.length - 1].statement;
    impactHTML += `<span class="impact-now"><strong>Happening at this level:</strong> ${escapeHTML(nowStatement)}</span>`;
  }
  if (m.risk.next) {
    impactHTML += `<span><strong>At ${escapeHTML(ft(m.risk.next.stage))} ft:</strong> ${escapeHTML(m.risk.next.statement)}</span>`;
  } else if ((m.gauge.impacts || []).length === 0) {
    impactHTML += `<span>NWS has not published street-level impacts for this gauge.</span>`;
  }
  impactEl.innerHTML = impactHTML;

  document.getElementById("feature-actions").innerHTML = linkHTML(m, "btn btn-dark");

  document.getElementById("feature-diagram").innerHTML = crossSectionSVG({
    height: m.height,
    categories: cats,
    next: m.risk.next,
    tier: m.tier,
    label: gaugeLabel(m),
    compact: compactQuery.matches
  });
}

const compactQuery = window.matchMedia("(max-width: 600px)");
compactQuery.addEventListener("change", () => { if (state.models.length) renderFeature(state.models); });

function rowHTML(m) {
  const info = TIER_INFO[m.tier] || TIER_INFO.Unknown;
  const place = [m.names.place, m.miles !== undefined ? `${m.miles.toFixed(1)} mi` : ""].filter(Boolean).join(" · ");
  const selected = state.selectedId === m.id;

  const nameCell = `
    <div class="row-name">
      ${m.hasData
        ? `<button type="button" class="name-btn" data-id="${escapeHTML(m.id)}" aria-pressed="${selected}" title="Show this gauge in the diagram">${escapeHTML(m.names.river)}</button>`
        : `<span class="name-btn is-static">${escapeHTML(m.names.river)}</span>`}
      <div class="row-place">${escapeHTML(place)}</div>
      <div class="row-tags">${tierBadge(m.tier)}${m.verified ? '<span class="verified">Verified</span>' : ""}</div>
    </div>`;

  if (!m.hasData) {
    return `<li class="gauge-row tier-${info.key}">
      <div class="row-tube">${tubeSVG({ height: NaN, categories: m.gauge.categories, tier: "Unknown" })}</div>
      ${nameCell}
      <div class="row-nodata">USGS is not reporting a recent reading for this gauge.</div>
      <div class="row-meta">${linkHTML(m)}</div>
    </li>`;
  }

  let nextCell;
  if (m.risk.next) {
    nextCell = `<div class="row-next">
        <div><span class="num-sm">${m.headroom.toFixed(2)} ft</span> <span class="muted">to ${escapeHTML(ft(m.risk.next.stage))} ft</span></div>
        <p class="row-impact">${escapeHTML(m.risk.next.statement)}</p>
      </div>`;
  } else if ((m.gauge.impacts || []).length === 0) {
    nextCell = `<div class="row-next"><p class="row-impact">NWS has not published street-level impacts for this gauge.</p></div>`;
  } else {
    nextCell = `<div class="row-next"><p class="row-impact">Above every impact NWS lists for this gauge.</p></div>`;
  }
  if (m.risk.affected.length) {
    const now = m.risk.affected[m.risk.affected.length - 1].statement;
    nextCell = nextCell.replace('<div class="row-next">',
      `<div class="row-next"><p class="row-now"><strong>Now:</strong> ${escapeHTML(now)}</p>`);
  }

  const stale = m.time && isStale(m.time);
  const meta = m.simulated
    ? `<span class="ago">Simulated</span>`
    : `<span class="ago${stale ? " is-stale" : ""}">${stale ? "Old reading · " : ""}${escapeHTML(timeAgo(m.time))}</span>`;

  return `<li class="gauge-row tier-${info.key}${selected ? " is-selected" : ""}">
    <div class="row-tube">${tubeSVG({ height: m.height, categories: m.gauge.categories, next: m.risk.next, tier: m.tier })}</div>
    ${nameCell}
    <div class="row-level">
      <div><span class="num">${escapeHTML(ft(m.height))}</span><span class="unit"> ft</span></div>
      <div class="trend trend-${m.trend ? m.trend.dir : "none"}">${trendIcon(m.trend)}<span>${escapeHTML(m.simulated ? "Demo" : trendText(m.trend))}</span></div>
    </div>
    ${nextCell}
    <div class="row-meta">${meta}${linkHTML(m)}</div>
  </li>`;
}

function renderList(models) {
  // Most serious first, then closest to its next impact, then gauges without data.
  const sorted = models.slice().sort((a, b) =>
    (b.hasData - a.hasData) ||
    (TIER_ORDER[b.tier] - TIER_ORDER[a.tier]) ||
    ((a.headroom ?? Infinity) - (b.headroom ?? Infinity))
  );
  document.getElementById("gauge-list").innerHTML = sorted.map(rowHTML).join("");
}

function renderAll() {
  renderSummary(state.models);
  renderFeature(state.models);
  renderList(state.models);
  if (typeof updateMap === "function") {
    updateMap(state.models, state.origin);
  }
}

function setDataStatus(text, isError = false) {
  const el = document.getElementById("data-status");
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

async function getGaugeData() {
  const statusEl = document.getElementById("status");
  document.getElementById("demo-flag").hidden = !demoTier;

  try {
    const siteList = state.gauges.map(g => g.usgsId).join(",");
    // Six hours of readings so we can tell whether each river is rising or falling.
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${siteList}&parameterCd=00065&period=PT6H&siteStatus=all&format=json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`USGS returned status ${response.status}`);
    }
    const data = await response.json();

    state.models = state.gauges.map(gauge => {
      const entry = data.value.timeSeries.find(e => e.sourceInfo.siteCode[0].value === gauge.usgsId);
      return buildModel(gauge, entry);
    });

    renderAll();
    state.lastChecked = new Date();
    setDataStatus(`USGS · checked ${clockTime(state.lastChecked)}`);
    statusEl.hidden = true;
    statusEl.textContent = "";
  } catch (error) {
    console.error("Failed to load gauge data:", error);
    setDataStatus("Couldn't reach USGS · retrying", true);
    statusEl.hidden = false;
    statusEl.textContent = state.models.length
      ? "Couldn't update from USGS just now. Showing the last readings we got; we'll retry automatically."
      : "Couldn't load readings from USGS just now. We'll retry automatically.";
    if (!state.models.length) {
      document.getElementById("summary-text").textContent =
        "River readings are temporarily unavailable. If you're worried about flooding, check NWS warnings at weather.gov.";
    }
  }
}

async function setLocation(lat, lon, label) {
  const locStatus = document.getElementById("location-status");
  locStatus.textContent = `Finding gauges near ${label}…`;

  try {
    const nearby = await loadNearbyGauges(lat, lon, 10);
    if (nearby.length === 0) {
      locStatus.textContent = "No gauges with flood data were found near that location.";
      return;
    }

    state.gauges = nearby.map(g =>
      gaugeThresholds[g.usgsId]
        ? { usgsId: g.usgsId, verified: true, miles: g.miles, ...gaugeThresholds[g.usgsId] }
        : g
    );
    state.origin = { lat, lon, label };
    state.selectedId = null;
    document.getElementById("scope").textContent = `Gauges near ${label}`;
    locStatus.textContent = `Showing the ${state.gauges.length} nearest gauges to ${label}.`;
    await getGaugeData();
  } catch (error) {
    console.error("Failed to load nearby gauges:", error);
    locStatus.textContent = "Couldn't look up nearby gauges just now.";
  }
}

document.getElementById("town-select").addEventListener("change", event => {
  const value = event.target.value;
  if (value === "default") {
    state.gauges = verifiedGauges();
    state.origin = null;
    state.selectedId = null;
    document.getElementById("scope").textContent = "Des Plaines River & nearby streams · Lake County, IL";
    document.getElementById("location-status").textContent = "";
    getGaugeData();
    return;
  }
  const town = TOWNS[value];
  setLocation(town.lat, town.lon, town.label);
});

document.getElementById("locate-btn").addEventListener("click", () => {
  const locStatus = document.getElementById("location-status");
  if (!navigator.geolocation) {
    locStatus.textContent = "Your browser doesn't support location. Pick a town instead.";
    return;
  }
  locStatus.textContent = "Asking for your location…";
  navigator.geolocation.getCurrentPosition(
    position => setLocation(position.coords.latitude, position.coords.longitude, "your location"),
    () => { locStatus.textContent = "Couldn't get your location. Pick a town instead."; }
  );
});

// Clicking a gauge name puts it in the diagram.
document.getElementById("gauge-list").addEventListener("click", event => {
  const btn = event.target.closest(".name-btn[data-id]");
  if (!btn) return;
  state.selectedId = btn.dataset.id;
  renderFeature(state.models);
  renderList(state.models);
  const feature = document.getElementById("feature");
  if (feature.getBoundingClientRect().top < 0 || window.innerWidth < 900) {
    feature.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  document.querySelector(`.name-btn[data-id="${CSS.escape(btn.dataset.id)}"]`)?.focus({ preventScroll: true });
});

// Keep "x min ago" honest between refreshes.
// (Skipped while the keyboard focus is inside the list so we never yank focus away.)
setInterval(() => {
  if (!state.models.length) return;
  renderFeature(state.models);
  if (!document.getElementById("gauge-list").contains(document.activeElement)) {
    renderList(state.models);
  }
}, 60 * 1000);

getGaugeData();
setInterval(getGaugeData, 15 * 60 * 1000);
