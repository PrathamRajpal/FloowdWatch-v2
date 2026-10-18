// Shared helpers used by the dashboard and the gauge detail page.
// Depends on thresholds.js (getRiskStatus) being loaded first.

const TIER_INFO = {
  Normal:  { key: "normal",  label: "Normal",  water: "#3A86DA", ink: "#1E5E3B" },
  Watch:   { key: "watch",   label: "Watch",   water: "#E0921F", ink: "#8A4F00" },
  Warning: { key: "warning", label: "Warning", water: "#D25F1C", ink: "#A33B0B" },
  Major:   { key: "major",   label: "Major",   water: "#B3263A", ink: "#8E1426" },
  Unknown: { key: "unknown", label: "No data", water: "#9AA9B7", ink: "#4E6072" }
};

const TIER_ORDER = { Major: 4, Warning: 3, Watch: 2, Normal: 1, Unknown: 0 };

const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // a reading older than 2 hours is flagged
const TREND_WINDOW_HOURS = 3;
const STEADY_BAND_FT = 0.05;              // changes smaller than this count as "steady"

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

// Feet with up to 2 decimals, trailing zeros trimmed (7.50 -> 7.5, 8.00 -> 8).
function ft(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

// "DES PLAINES RIVER AT LINCOLNSHIRE, IL" -> { river: "Des Plaines River", place: "Lincolnshire, IL" }
function splitSiteName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  const match = name.match(/^(.*?)\s+(at|near|nr)\s+(.*)$/i);
  const river = match ? match[1] : name;
  const place = match ? match[3] : "";
  return { river: titleCase(river), place: titleCase(place) };
}

function titleCase(text) {
  const keepUpper = new Set(["IL", "US", "USGS", "NWS", "II"]);
  const lower = new Set(["of", "and", "the", "at", "near"]);
  const expand = { WF: "West Fork", EF: "East Fork", NB: "North Branch", SB: "South Branch", N: "North", S: "South" };
  return String(text || "")
    .replace(/\bMC\s+(\w)/gi, (_, c) => "Mc" + c.toUpperCase())
    .split(" ")
    .map((word, i) => {
      const bare = word.replace(/[^A-Za-z]/g, "");
      const upper = bare.toUpperCase();
      if (expand[upper] && word.length <= 3) return word.toUpperCase().replace(upper, expand[upper]);
      if (keepUpper.has(upper)) return word.toUpperCase();
      if (/^Mc[A-Z]/.test(word)) return "Mc" + word.slice(2, 3).toUpperCase() + word.slice(3).toLowerCase();
      const lw = word.toLowerCase();
      if (i > 0 && lower.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(" ");
}

// Turns one USGS timeSeries entry into clean, chronological readings.
function parseSeries(entry) {
  if (!entry) return null;
  const noData = entry.variable?.noDataValue;
  const raw = entry.values?.[0]?.value || [];
  const readings = raw
    .map(r => ({ time: new Date(r.dateTime), height: parseFloat(r.value) }))
    .filter(r => !Number.isNaN(r.height) && r.height !== noData && !Number.isNaN(r.time.getTime()))
    .sort((a, b) => a.time - b.time);
  const geo = entry.sourceInfo?.geoLocation?.geogLocation;
  return {
    siteName: entry.sourceInfo?.siteName || "",
    lat: geo ? Number(geo.latitude) : null,
    lon: geo ? Number(geo.longitude) : null,
    readings,
    latest: readings.length ? readings[readings.length - 1] : null
  };
}

// Compares the latest reading with the one closest to TREND_WINDOW_HOURS earlier.
function computeTrend(readings) {
  if (!readings || readings.length < 2) return null;
  const latest = readings[readings.length - 1];
  const target = latest.time.getTime() - TREND_WINDOW_HOURS * 3600 * 1000;
  let base = null;
  for (const r of readings) {
    if (r.time.getTime() <= target) base = r; else break;
  }
  if (!base) {
    base = readings[0];
    // Not enough history to say anything meaningful.
    if (latest.time - base.time < 60 * 60 * 1000) return null;
  }
  const hours = (latest.time - base.time) / 3600000;
  const delta = latest.height - base.height;
  const dir = Math.abs(delta) < STEADY_BAND_FT ? "steady" : delta > 0 ? "rising" : "falling";
  return { dir, delta, hours };
}

function trendText(trend) {
  if (!trend) return "Trend unavailable";
  const hrs = Math.round(trend.hours);
  const span = `${hrs} hr`;
  if (trend.dir === "steady") return `Steady over ${span}`;
  const sign = trend.delta > 0 ? "+" : "−";
  return `${trend.dir === "rising" ? "Rising" : "Falling"} ${sign}${Math.abs(trend.delta).toFixed(2)} ft in ${span}`;
}

// Splits the trend into a short word and the detail, for the big readout.
function trendParts(trend) {
  if (!trend) return { word: "Unavailable", detail: "not enough recent readings" };
  const hrs = Math.round(trend.hours);
  if (trend.dir === "steady") return { word: "Steady", detail: `within 0.05 ft over ${hrs} hr` };
  const sign = trend.delta > 0 ? "+" : "−";
  return {
    word: trend.dir === "rising" ? "Rising" : "Falling",
    detail: `${sign}${Math.abs(trend.delta).toFixed(2)} ft in ${hrs} hr`
  };
}

function trendIcon(trend) {
  const dir = trend ? trend.dir : "none";
  const paths = {
    rising: '<path d="M4 14l6-6 4 4 6-6"/><path d="M14 6h6v6"/>',
    falling: '<path d="M4 6l6 6 4-4 6 6"/><path d="M14 14h6V8"/>',
    steady: '<path d="M3 10h14"/><path d="M13 6l4 4-4 4"/>',
    none: '<path d="M4 10h12" stroke-dasharray="2 3"/>'
  };
  return `<svg class="trend-icon trend-${dir}" width="18" height="18" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[dir]}</svg>`;
}

function timeAgo(date, now = new Date()) {
  const mins = Math.max(0, Math.round((now - date) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs} hr ${rem} min ago` : `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function clockTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isStale(date, now = new Date()) {
  return now - date > STALE_AFTER_MS;
}

// Top of the drawn scale: always shows major flood stage, the current level and the next impact.
function scaleMaxFor(height, categories, next) {
  const peak = Math.max(
    Number(categories?.major) || 0,
    Number(height) || 0,
    next ? Number(next.stage) : 0
  );
  return Math.max(4, Math.ceil(peak + 1));
}

function niceStep(max) {
  if (max <= 6) return 1;
  if (max <= 14) return 2;
  if (max <= 30) return 5;
  return 10;
}

// Cross-section of the river channel with a true feet scale.
// Lines: next listed impact, NWS flood stage (minor), NWS major flood stage.
// compact = true draws a narrower diagram so text stays readable on phones.
function crossSectionSVG({ height, categories, next, tier, label, compact = false }) {
  const W = compact ? 380 : 640, H = compact ? 300 : 340;
  const top = 26, bottom = H - 44, axisX = compact ? 34 : 46, right = W - 6;
  const max = scaleMaxFor(height, categories, next);
  const y = v => bottom - (v / max) * (bottom - top);
  const info = TIER_INFO[tier] || TIER_INFO.Unknown;

  // Channel shape (screen space): banks slope from the top of the scale to the channel bottom.
  const span = right - axisX;
  const bankTopL = axisX + span * 0.08, bedL = axisX + span * 0.32,
        bedR = axisX + span * 0.62, bankTopR = axisX + span * 0.88;
  const atLevel = py => {
    const t = (bottom - py) / (bottom - top);
    return [bedL - t * (bedL - bankTopL), bedR + t * (bankTopR - bedR)];
  };

  const wy = y(Math.max(0, Math.min(height, max)));
  const [wl, wr] = atLevel(wy);

  // Surface ripple
  let ripple = "";
  const segs = Math.max(2, Math.round((wr - wl) / 40));
  const segW = (wr - wl) / segs;
  ripple = `M${wl.toFixed(1)} ${wy.toFixed(1)}`;
  for (let i = 0; i < segs; i++) ripple += ` q ${(segW / 2).toFixed(1)} -5 ${segW.toFixed(1)} 0`;

  // Axis ticks
  const step = niceStep(max);
  let ticks = "";
  for (let v = 0; v <= max; v += step) {
    const ty = y(v).toFixed(1);
    ticks += `<line x1="${(axisX - 5).toFixed(1)}" y1="${ty}" x2="${axisX}" y2="${ty}" stroke="#8A99A8" stroke-width="1"/>`;
    ticks += `<text x="${axisX - 9}" y="${(+ty + 4).toFixed(1)}" text-anchor="end" class="xs-tick">${v}</text>`;
  }

  // Threshold lines (deduplicated when two thresholds share a height)
  const lines = [];
  const add = (stage, text, color, dash) => {
    if (stage == null || Number.isNaN(Number(stage)) || stage > max) return;
    const existing = lines.find(l => Math.abs(l.stage - stage) < 0.01);
    if (existing) { existing.text += ` · ${text}`; return; }
    lines.push({ stage: Number(stage), text, color, dash });
  };
  if (next) add(next.stage, compact ? "next impact" : "next listed impact", "#B86A00", "7 6");
  add(categories?.minor, compact ? "flood stage" : "NWS flood stage", "#A33B0B", "2 5");
  add(categories?.major, compact ? "major" : "major flood stage", "#8E1426", "2 5");

  // Keep labels from colliding: sort top-down and push apart.
  const placed = lines
    .map(l => ({ ...l, ly: y(l.stage) - 7 }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].ly - placed[i - 1].ly < 16) placed[i].ly = placed[i - 1].ly + 16;
  }
  const lineSVG = placed.map(l => {
    const ly = y(l.stage).toFixed(1);
    return `<line x1="${axisX}" y1="${ly}" x2="${right}" y2="${ly}" stroke="${l.color}" stroke-width="2" stroke-dasharray="${l.dash}"/>
      <text x="${right}" y="${l.ly.toFixed(1)}" text-anchor="end" class="xs-line" fill="${l.color}">${escapeHTML(ft(l.stage))} ft · ${escapeHTML(l.text)}</text>`;
  }).join("");

  // Current level label: inside the water if there's room, otherwise above the surface.
  const roomInside = bottom - wy > 76;
  let labelY = roomInside ? wy + 52 : wy - 38;
  // Don't let the current-level label sit on top of a threshold label line.
  if (!roomInside) {
    for (const l of placed) {
      if (Math.abs(l.ly - labelY) < 44) labelY = Math.min(labelY, l.ly - 34);
    }
    labelY = Math.max(labelY, top + 30);
  }
  const labelFill = roomInside ? "#FFFFFF" : info.ink;
  const subFill = roomInside ? "rgba(255,255,255,0.85)" : "#3A4D60";

  const ground = `${axisX},${top} ${bankTopL},${top} ${bedL},${bottom} ${bedR},${bottom} ${bankTopR},${top} ${right},${top} ${right},${H} ${axisX},${H}`;
  const bankLine = `${axisX},${top} ${bankTopL},${top} ${bedL},${bottom} ${bedR},${bottom} ${bankTopR},${top} ${right},${top}`;

  const aria = `Diagram: ${label || "river"} at ${ft(height)} feet.` +
    (next ? ` Next listed impact at ${ft(next.stage)} feet.` : "") +
    (categories?.minor ? ` NWS flood stage ${ft(categories.minor)} feet.` : "");

  return `<svg class="xsection" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(aria)}">
    <polygon points="${wl.toFixed(1)},${wy.toFixed(1)} ${wr.toFixed(1)},${wy.toFixed(1)} ${bedR},${bottom} ${bedL},${bottom}" fill="${info.water}"/>
    <path d="${ripple}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="3" stroke-linecap="round"/>
    <polygon points="${ground}" fill="#DCD3C3"/>
    <polyline points="${bankLine}" fill="none" stroke="#9C8E76" stroke-width="2"/>
    <line x1="${axisX}" y1="${top}" x2="${axisX}" y2="${bottom}" stroke="#8A99A8" stroke-width="1"/>
    <text x="${axisX - 9}" y="${top - 10}" text-anchor="end" class="xs-tick">ft</text>
    ${ticks}
    ${lineSVG}
    <text x="${((bedL + bedR) / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="xs-level" fill="${labelFill}">${escapeHTML(ft(height))} ft</text>
    <text x="${((bedL + bedR) / 2).toFixed(1)}" y="${(labelY + 22).toFixed(1)}" text-anchor="middle" class="xs-sub" fill="${subFill}">${compact ? "now" : "current gauge height"}</text>
  </svg>`;
}

// Small vertical tube for list rows, on the same scale as the cross-section.
function tubeSVG({ height, categories, next, tier }) {
  const W = 22, H = 64, pad = 2;
  const max = scaleMaxFor(height, categories, next);
  const info = TIER_INFO[tier] || TIER_INFO.Unknown;
  const inner = H - pad * 2;
  const fillH = Number.isFinite(height) ? Math.max(2, Math.min(1, height / max) * inner) : 0;
  const markY = categories?.minor ? pad + inner - (categories.minor / max) * inner : null;
  return `<svg class="tube" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${(W - 2) / 2}" fill="#E3EAF0" stroke="#C9D4DE"/>
    <rect x="${pad + 1}" y="${(pad + inner - fillH).toFixed(1)}" width="${W - pad * 2 - 2}" height="${fillH.toFixed(1)}" rx="${(W - pad * 2 - 2) / 2}" fill="${info.water}"/>
    ${markY !== null && markY > pad ? `<line x1="0" y1="${markY.toFixed(1)}" x2="${W}" y2="${markY.toFixed(1)}" stroke="#A33B0B" stroke-width="1.5" stroke-dasharray="2 2"/>` : ""}
  </svg>`;
}

function tierBadge(tier) {
  const info = TIER_INFO[tier] || TIER_INFO.Unknown;
  return `<span class="tier tier-${info.key}"><span class="tier-dot" aria-hidden="true"></span>${escapeHTML(info.label)}</span>`;
}
