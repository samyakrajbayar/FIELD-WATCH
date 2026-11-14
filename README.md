# FIELD//WATCH — Agricultural Satellite & Soil Decision-Support System

Track any field from orbit: 7-day satellite pass replay, Sentinel-2 and Landsat surface reflectance imagery, 16-day Open-Meteo atmospheric and soil stack, a real-time 3D terrain engine, and a client-side AI agronomist.

---

## Overview

**FIELD//WATCH** operates as a zero-installation, privacy-first web application accessible on desktop, tablet, and mobile devices. It provides real-time field monitoring and agronomic decision support for any farm coordinate on Earth. It integrates NASA/USGS Landsat and ESA Sentinel-2 Earth observations, a 7-day satellite pass tracker, an interactive 3D digital twin, and a comprehensive microclimate deck tracking multi-depth soil moisture, soil temperature, reference evapotranspiration ($\text{ET}_0$), and vapor pressure deficit (VPD).

---

## Key Features

1. **Precision Ground Track & Orbit Replay**
   - Live NORAD Two-Line Element (TLE) ephemeris propagation using `satellite.js` with SGP4/SDP4 models.
   - Calculates 7-day pass predictions for **Sentinel-2** ($\le 145\text{ km}$ swath limit) and **Landsat 8 & 9** ($\le 93\text{ km}$ swath limit).
   - In-browser 2-hour caching via `localStorage`.

2. **Earth Observation Pixels (STAC)**
   - Connects to Microsoft Planetary Computer STAC API.
   - Retrieves cloud-calibrated, high-resolution optical imagery crops centered precisely on a $0.03^\circ$ bounding box ($\approx 6.6\text{ km} \times 6.6\text{ km}$) around the farm.

3. **16-Day Weather & Multi-Depth Soil Stack**
   - 7 days of historical weather combined with a 9-day forward forecast via Open-Meteo APIs.
   - Volumetric soil moisture at $0\text{--}1\text{ cm}$ and $3\text{--}9\text{ cm}$ depth.
   - Soil temperatures, FAO-56 Penman-Monteith $\text{ET}_0$, and cumulative 7-day water balance.
   - Convective available potential energy (CAPE), dew point, relative humidity, and vertical pressure levels ($1000\text{--}300\text{ hPa}$).

4. **Real-Time 3D Digital Twin (`scene.html`)**
   - WebGL / Three.js 3D terrain engine with dynamic elevation relief from Open-Meteo.
   - Drapes real satellite imagery directly onto the terrain grid.
   - Real-time animated atmospheric layers: particle wind flow vectors, sun rays/angles, and live volumetric cloud decks.

5. **Dual-Engine Agronomic Decision Support**
   - **Deterministic Local Engine:** 12+ offline agronomy rules evaluating irrigation shortfalls, topsoil drying, frost warnings, heat stress, mildew leaf-wetness incubation, and low-drift spray windows.
   - **BYOK AI Agronomist:** Connects client-side to any OpenAI-compatible API endpoint (OpenAI, Z.ai/GLM) using the grower's own key without sending farm data to intermediary servers.

---

## Tech Stack

* **Languages:** Vanilla JavaScript (ES6+), HTML5, CSS3, SVG
* **3D Engine:** Three.js with OrbitControls
* **GIS & Orbit:** Leaflet.js (1.9.4), satellite.js (5.0.0)
* **Custom Charts:** Zero-dependency mathematical SVG renderers for wind roses, meteograms, and atmospheric soundings
* **Data Sources:** NASA / USGS Landsat 8/9, ESA Sentinel-2, CelesTrak, Open-Meteo, OpenStreetMap / Nominatim

---

## Quick Start

Serve the project folder using any local HTTP server:

```bash
# Using Python
python -m http.server 8000
```

Open in your browser:
* **Main Dashboard:** [http://localhost:8000/index.html](http://localhost:8000/index.html)
* **3D Field Simulator:** [http://localhost:8000/scene.html](http://localhost:8000/scene.html)

---

## License

MIT License. Built for growers, agronomists, and researchers worldwide.
