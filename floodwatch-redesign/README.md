# FloodWatch

Real-time, street-level flood risk for the Des Plaines River in Lake County, IL - built for the 2026 Congressional App Challenge

## Team

Pratham Rajpal
Sritejas Bommisetty

## What it shows

- Live USGS gauge heights, checked every 15 minutes, with a rising/falling/steady trend (latest reading vs. ~3 hours earlier).
- A river cross-section drawn on a true feet scale, with the next NWS-listed impact, NWS flood stage and major flood stage marked.
- Status (Normal / Watch / Warning / Major) from NWS thresholds; the four Lake County gauges in `js/thresholds.js` were checked by hand.
- Nearby gauges for any town or your location (NWS NWPS API), a map (Leaflet + OpenStreetMap), and a 7-day history page per verified gauge.
- Demo mode for presentations: add `?demo=watch`, `?demo=warning` or `?demo=major` to the URL. Heights are simulated and labeled as such.

Plain HTML/CSS/JS, no build step. Open `index.html` through any static server, or deploy with GitHub Pages.
