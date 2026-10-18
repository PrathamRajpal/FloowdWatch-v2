// Leaflet map of the gauges currently shown on the dashboard.
let floodMap = null;
let gaugeLayer = null;

function initMap() {
  const el = document.getElementById("map");
  if (typeof L === "undefined") {
    el.innerHTML = '<p class="map-fallback">The map couldn\'t load. Check your connection; the gauge list above still works.</p>';
    return null;
  }
  floodMap = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([42.28, -87.93], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(floodMap);
  gaugeLayer = L.layerGroup().addTo(floodMap);
  return floodMap;
}

function popupNode(m) {
  const box = document.createElement("div");
  box.className = "map-popup";
  const title = document.createElement("strong");
  title.textContent = gaugeLabel(m);
  box.appendChild(title);

  const line = document.createElement("div");
  const info = TIER_INFO[m.tier] || TIER_INFO.Unknown;
  line.textContent = m.hasData
    ? `${ft(m.height)} ft · ${info.label}${m.trend ? " · " + trendText(m.trend) : ""}`
    : "No recent reading";
  box.appendChild(line);

  if (m.hasData && m.risk.next) {
    const next = document.createElement("div");
    next.className = "map-popup-sub";
    next.textContent = `${m.headroom.toFixed(2)} ft below next listed impact (${ft(m.risk.next.stage)} ft)`;
    box.appendChild(next);
  }

  const link = detailLink(m);
  const a = document.createElement("a");
  a.href = link.href;
  a.textContent = link.text + " →";
  if (link.external) { a.target = "_blank"; a.rel = "noopener"; }
  box.appendChild(a);
  return box;
}

function updateMap(models, origin) {
  if (!floodMap && !initMap()) return;
  gaugeLayer.clearLayers();
  const points = [];

  models.forEach(m => {
    if (m.lat == null || m.lon == null) return;
    const info = TIER_INFO[m.tier] || TIER_INFO.Unknown;
    L.circleMarker([m.lat, m.lon], {
      radius: 9,
      color: "#FFFFFF",
      weight: 2.5,
      fillColor: info.water,
      fillOpacity: 1
    })
      .bindPopup(popupNode(m))
      .bindTooltip(gaugeLabel(m), { direction: "top", offset: [0, -8] })
      .addTo(gaugeLayer);
    points.push([m.lat, m.lon]);
  });

  if (origin) {
    L.circleMarker([origin.lat, origin.lon], {
      radius: 6, color: "#0B1F33", weight: 2, fillColor: "#FFFFFF", fillOpacity: 1
    }).bindTooltip(origin.label === "your location" ? "You" : origin.label).addTo(gaugeLayer);
    points.push([origin.lat, origin.lon]);
  }

  if (points.length) {
    floodMap.fitBounds(points, { padding: [36, 36], maxZoom: 12 });
  }
}
