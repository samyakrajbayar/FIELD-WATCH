/* ════════════════════════════════════════
   FIELD//WATCH — app orchestration
═══════════════════════════════════════ */
(function () {
	"use strict";

	const $ = function (id) { return document.getElementById(id); };

	const state = {
		place: null,
		lat: null,
		lon: null,
		elevation: 0,
		weather: null,
		sat: null,
		scenes: [],
		matched: 0,
		insights: null,
		signal: null,
		map: null,
		marker: null,
		rect: null,
		passLayer: null,
		filter: "all",
		aiBusy: false
	};

	/* ══════════════════════════════════════
	   TOAST
	══════════════════════════════════════ */
	let toastTimer;
	function toast(msg, isError) {
		const el = $("toast");
		$("toast-text").textContent = msg;
		el.classList.toggle("error", !!isError);
		el.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
	}

	function tz() {
		return state.weather ? state.weather.timezone : undefined;
	}

	function cloudText(c) {
		return c == null || !isFinite(c) ? "CLOUD N/A" : Math.round(c) + "% CLOUD";
	}

	/* ══════════════════════════════════════
	   MAP
	══════════════════════════════════════ */
	function initMap() {
		const el = $("map-canvas");
		if (typeof L === "undefined") {
			el.innerHTML = '<div class="empty-note">MAP LIBRARY FAILED TO LOAD</div>';
			return;
		}
		const map = L.map(el, { zoomControl: true, scrollWheelZoom: true, worldCopyJump: true }).setView([18, 12], 2);
		L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
			maxZoom: 18,
			attribution: "&copy; OpenStreetMap contributors"
		}).addTo(map);
		state.map = map;
		state.passLayer = L.layerGroup().addTo(map);
	}

	function drawPlace() {
		if (!state.map || !state.place) return;
		const p = state.place;
		const latlng = [p.lat, p.lon];
		const bounds = [[p.lat - 0.03, p.lon - 0.03], [p.lat + 0.03, p.lon + 0.03]];

		if (!state.marker) {
			state.marker = L.marker(latlng).addTo(state.map);
		} else {
			state.marker.setLatLng(latlng);
		}
		state.marker.bindPopup("<b>" + U.esc(p.short) + "</b><br>" + p.lat.toFixed(4) + ", " + p.lon.toFixed(4));

		if (!state.rect) {
			state.rect = L.rectangle(bounds, {
				color: "#101b0f", weight: 2, fillColor: "#c6f24e", fillOpacity: 0.2, dashArray: "5 3"
			}).addTo(state.map);
		} else {
			state.rect.setBounds(bounds);
		}
		state.map.flyTo(latlng, 11, { duration: 1.2 });
	}

	function drawPassMarkers() {
		if (!state.map || !state.passLayer || !state.sat) return;
		state.passLayer.clearLayers();
		const list = state.sat.passes.filter(function (p) {
			return p.group !== "other" && p.closestLat != null;
		}).slice(-200);

		list.forEach(function (p) {
			const color = p.group === "sentinel2" ? "#8b5cf6" : "#ff7a3d";
			const m = L.circleMarker([p.closestLat, p.closestLon], {
				radius: 5, color: "#101b0f", weight: 2, fillColor: color, fillOpacity: 1
			});
			m.bindPopup("<b>" + U.esc(p.name) + "</b><br>" +
				U.fmtTime(p.closestT, tz()) + "<br>CLOSEST " + U.num(p.minDistKm, 0) + " KM");
			m.addTo(state.passLayer);
		});
	}

	/* ══════════════════════════════════════
	   HERO
	══════════════════════════════════════ */
	function updateHero() {
		const p = state.place;
		const w = state.weather;
		const s = state.sat;

		$("hc-place").textContent = p ? (p.short || p.label).slice(0, 26) : "—";
		$("hc-place").title = p ? p.label : "";
		$("hc-coords").textContent = p ? p.lat.toFixed(3) + " / " + p.lon.toFixed(3) : "—";
		$("hc-elev").textContent = w && w.elevation != null ? Math.round(w.elevation) + " M" : "…";
		$("hc-tz").textContent = w ? w.timezone.replace(/_/g, " ").toUpperCase() : "…";
		$("hc-tle").textContent = s ? s.catalog + " OBJ · " + (s.tleCached ? "CACHE" : "LIVE") : "…";
		$("hc-s2").textContent = s ? s.counts.sentinel2 + " PASSES" : "…";

		const link = $("open-3d");
		if (link && p) {
			link.href = "./scene.html?lat=" + p.lat.toFixed(5) + "&lon=" + p.lon.toFixed(5) +
				"&name=" + encodeURIComponent(p.short || p.label);
		}

		if (s) {
			$("hc-big").innerHTML = String(s.counts.total) + "<br>PASSES";
			$("hc-big-sub").textContent = "7-DAY REPLAY · " + s.tracked + " SATS · " + s.skipped + " SLOW SKIPPED";
		} else {
			$("hc-big").innerHTML = p ? "SCAN<br>NING" : "NO<br>TARGET";
			$("hc-big-sub").textContent = p ? "replaying 7 days of orbits…" : "search a place to begin";
		}
	}

	/* ══════════════════════════════════════
	   LOADERS
	══════════════════════════════════════ */
	function setSatProgress(pct, text) {
		$("sat-progress").style.width = Math.max(0, Math.min(100, pct)) + "%";
		$("sat-status").textContent = text;
	}

	async function loadWeather(signal) {
		try {
			const w = await WX.load({
				lat: state.lat,
				lon: state.lon,
				signal: signal,
				onStep: function (m) { $("weather-meta").textContent = "OPEN-METEO · " + m + "…"; }
			});
			if (signal.aborted) return;
			state.weather = w;
			state.elevation = w.elevation || 0;
			renderWeather(w);
			updateHero();
			/* times are place-local now that the timezone is known */
			if (state.sat) renderPasses();
			if (state.scenes.length) renderImagery();
		} catch (e) {
			if (e && e.name === "AbortError") return;
			$("weather-body").innerHTML = '<div class="empty-note wide">WEATHER DECK FAILED<br>' + U.esc(e.message) + "<br><br>Open-Meteo may be rate limiting. Try again in a minute.</div>";
			$("weather-meta").textContent = "OPEN-METEO · ERROR";
		}
	}

	async function loadImagery(signal) {
		const grid = $("imagery-grid");
		grid.innerHTML = '<div class="empty-note wide"><span class="spin"></span>QUERYING PLANETARY COMPUTER STAC…</div>';
		$("imagery-meta").textContent = "PLANETARY COMPUTER · SEARCHING…";
		try {
			const res = await IMAGERY.search({ lat: state.lat, lon: state.lon, days: 7, signal: signal });
			if (signal.aborted) return;
			state.scenes = res.scenes;
			state.matched = state.sat ? IMAGERY.matchPasses(state.scenes, state.sat.passes) : 0;
			renderImagery();
		} catch (e) {
			if (e && e.name === "AbortError") return;
			grid.innerHTML = '<div class="empty-note wide">IMAGERY SEARCH FAILED<br>' + U.esc(e.message) + "</div>";
			$("imagery-meta").textContent = "PLANETARY COMPUTER · ERROR";
		}
	}

	async function loadOrbits(signal, force) {
		setSatProgress(2, "FETCHING CELESTRAK TLE…");
		try {
			const res = await SAT.replay({
				lat: state.lat,
				lon: state.lon,
				elevation: state.elevation || 0,
				days: 7,
				force: !!force,
				signal: signal,
				onProgress: function (p) {
					const pct = p.total ? Math.round((p.satIndex / p.total) * 100) : 0;
					setSatProgress(pct, (p.phase === "done" ? "COMPLETE" : "SCANNING " + p.satIndex + "/" + p.total) +
						" · " + (p.passes || 0) + " PASSES · " + (p.steps || 0).toLocaleString() + " STEPS");
				}
			});
			if (signal.aborted) return;
			state.sat = res;
			$("pass-meta").textContent = "7 DAYS · " + res.tracked + " SATS";
			setSatProgress(100, "COMPLETE · " + res.counts.total + " PASSES · " + res.skipped + " <11 ORBITS/DAY SKIPPED");
			renderPasses();
			drawPassMarkers();
			updateHero();
			if (state.scenes.length) {
				state.matched = IMAGERY.matchPasses(state.scenes, res.passes);
				renderImagery();
			}
		} catch (e) {
			if (e && e.name === "AbortError") return;
			setSatProgress(0, "REPLAY ERROR — " + e.message);
			$("pass-list").innerHTML = '<div class="empty-note">ORBIT REPLAY FAILED<br>' + U.esc(e.message) +
				"<br><br>CelesTrak may be unreachable or rate limiting.</div>";
		}
	}

	/* ══════════════════════════════════════
	   SELECT PLACE
	══════════════════════════════════════ */
	async function selectPlace(place) {
		state.place = place;
		state.lat = place.lat;
		state.lon = place.lon;
		state.elevation = 0;
		state.weather = null;
		state.sat = null;
		state.scenes = [];
		state.matched = 0;
		state.insights = null;
		state.filter = "all";

		U.store.set("fw.last.v1", place);
		$("place-input").value = place.label;

		updateHero();
		drawPlace();
		if (state.passLayer) state.passLayer.clearLayers();

		$("pass-summary").innerHTML = ["TOTAL", "S2", "LANDSAT", "OTHER"].map(function (k) {
			return '<div class="stat"><b>—</b><span>' + k + "</span></div>";
		}).join("");
		$("pass-filters").innerHTML = "";
		$("pass-list").innerHTML = '<div class="empty-note"><span class="spin"></span>FETCHING CELESTRAK TLE + REPLAYING 7 DAYS…</div>';
		setSatProgress(1, "STARTING REPLAY…");
		$("weather-body").innerHTML = '<div class="empty-note wide"><span class="spin"></span>BUILDING THE WEATHER DECK…</div>';
		$("weather-meta").textContent = "OPEN-METEO · LOADING…";
		$("imagery-grid").innerHTML = '<div class="empty-note wide"><span class="spin"></span>QUERYING PLANETARY COMPUTER STAC…</div>';
		$("imagery-meta").textContent = "PLANETARY COMPUTER · LOADING…";
		$("ai-output").innerHTML = '<div class="empty-note dark"><span class="spin"></span>WAITING FOR THE WEATHER + ORBIT STACK…</div>';
		$("ai-run").disabled = true;

		if (state.signal) state.signal.abort();
		state.signal = new AbortController();
		const signal = state.signal.signal;

		await Promise.all([loadWeather(signal), loadImagery(signal), loadOrbits(signal)]);
		if (signal.aborted) return;

		$("ai-run").disabled = false;
		generateInsights();
	}

	/* ══════════════════════════════════════
	   PASS RENDERING
	══════════════════════════════════════ */
	function passTypeClass(group) {
		if (group === "sentinel2") return "s2";
		if (group === "landsat8" || group === "landsat9") return "ls";
		return "other";
	}

	function renderPasses() {
		const sat = state.sat;
		if (!sat) return;
		const c = sat.counts;
		$("pass-summary").innerHTML = [
			["TOTAL", c.total],
			["S2", c.sentinel2],
			["LANDSAT", c.landsat8 + c.landsat9],
			["OTHER", c.other]
		].map(function (row) {
			return '<div class="stat"><b>' + row[1] + "</b><span>" + row[0] + "</span></div>";
		}).join("");

		const sets = {
			all: sat.passes,
			sentinel2: sat.sentinel2,
			landsat: sat.landsat,
			other: sat.other
		};
		const labels = {
			all: "ALL " + c.total,
			sentinel2: "S2 " + c.sentinel2,
			landsat: "LANDSAT " + (c.landsat8 + c.landsat9),
			other: "OTHER " + c.other
		};

		$("pass-filters").innerHTML = Object.keys(sets).map(function (k) {
			return '<button type="button" data-filter="' + k + '" class="' + (state.filter === k ? "on" : "") + '">' + labels[k] + "</button>";
		}).join("");

		const rows = sets[state.filter].slice().sort(function (a, b) { return b.start - a.start; }).slice(0, 80);
		if (!rows.length) {
			$("pass-list").innerHTML = '<div class="empty-note">NO PASSES IN THIS FILTER FOR THE LAST 7 DAYS.</div>';
			return;
		}

		const html = rows.map(function (p) {
			const el = p.maxElDeg == null ? "—" : U.num(p.maxElDeg, 1) + "°";
			const dur = Math.max(0, Math.round(p.durationMs / 60000));
			const durText = dur < 1 ? "<1" : String(dur);
			const limit = p.limitKm ? "≤" + p.limitKm + " KM" : "≥10° EL";
			return '<div class="pass-row">' +
				'<div class="pr-name"><span class="pr-type ' + passTypeClass(p.group) + '">' + p.short + "</span><span>" + U.esc(p.name) + "</span></div>" +
				'<div class="pr-when">' + U.fmtDay(p.start, tz()) + " " + U.fmtHM(p.start, tz()) + "–" + U.fmtHM(p.end, tz()) + "</div>" +
				'<div class="pr-meta"><span>CLOSEST <b>' + U.num(p.minDistKm, 0) + " km</b></span>" +
				"<span>MAX EL <b>" + el + "</b></span>" +
				"<span>DUR <b>" + durText + " min</b></span>" +
				"<span>RULE <b>" + limit + "</b></span></div>" +
				"</div>";
		}).join("");

		$("pass-list").innerHTML = html +
			'<div class="empty-note">SHOWING ' + rows.length + " OF " + sets[state.filter].length + " PASSES IN THIS FILTER</div>";
	}

	/* ══════════════════════════════════════
	   IMAGERY RENDERING
	══════════════════════════════════════ */
	function renderImagery() {
		const grid = $("imagery-grid");
		const bbox = IMAGERY.bboxOf(state.lat, state.lon).join(",");
		$("imagery-meta").textContent = state.scenes.length + " SCENES · ±0.03° BOX · " + state.matched + " PASS MATCHES";

		if (!state.scenes.length) {
			grid.innerHTML = '<div class="empty-note wide">NO SENTINEL-2 OR LANDSAT SCENES OVER THIS BOX IN THE LAST 7 DAYS.<br><br>' +
				"BBOX " + U.esc(bbox) + " — try a larger area or a different place.</div>";
			return;
		}

		grid.innerHTML = state.scenes.map(function (s) {
			const isLandsat = s.collection === "landsat-c2-l2";
			const cloudBad = s.cloud != null && s.cloud >= 50;
			let match;
			if (s.pass) {
				const dm = Math.round(s.pass.deltaMin);
				const sign = dm >= 0 ? "+" : "";
				match = (s.pass.sameSatellite ? "PASS MATCH " : "SAME CONSTELLATION ") +
					"<b>" + sign + dm + " MIN</b><br>" +
					U.num(s.pass.minDistKm, 0) + " KM CLOSEST" +
					(s.pass.maxElDeg != null ? " · " + U.num(s.pass.maxElDeg, 0) + "° MAX" : "");
			} else {
				match = "NO PASS WITHIN −10 / +60 MIN";
			}
			return '<article class="scene">' +
				'<div class="scene-media">' +
				'<span class="scene-tag ' + (isLandsat ? "landsat" : "") + '">' + U.esc(s.satellite) + "</span>" +
				'<span class="scene-cloud ' + (cloudBad ? "bad" : "") + '">' + cloudText(s.cloud) + "</span>" +
				'<img src="' + U.esc(s.preview) + '" alt="' + U.esc(s.satellite) + ' preview over ' + U.esc(state.place.short) + '" loading="lazy" ' +
				'onerror="this.style.display=&quot;none&quot;">' +
				"</div>" +
				'<div class="scene-body">' +
				'<div class="scene-date">' + U.fmtDMY(s.time, tz()) + "</div>" +
				'<div class="scene-sub">' + U.fmtHM(s.time, tz()) + " LOCAL · " + (isLandsat ? "LANDSAT C2 L2" : "SENTINEL-2 L2A") + "</div>" +
				'<div class="scene-match ' + (s.pass ? "" : "none") + '">' + match + "</div>" +
				'<a class="scene-open" href="' + U.esc(s.itemUrl) + '" target="_blank" rel="noopener">STAC ITEM ↗</a>' +
				"</div></article>";
		}).join("");
	}

	/* ══════════════════════════════════════
	   WEATHER RENDERING
	══════════════════════════════════════ */
	function tile(cls, k, v, s) {
		return '<div class="tile ' + (cls || "") + '"><span class="k">' + k + '</span><span class="v">' + v +
			'</span><span class="s">' + (s || "") + "</span></div>";
	}

	function legend(items) {
		return items.map(function (it) {
			return '<span><i style="background:' + it[0] + '"></i>' + it[1] + "</span>";
		}).join("");
	}

	function chartCard(title, sub, span, body, legendHtml) {
		return '<article class="chart-card' + (span ? " span-" + span : "") + '">' +
			'<div class="chart-head"><h3>' + title + "</h3><span>" + sub + "</span></div>" +
			'<div class="chart-body">' + body + "</div>" +
			(legendHtml ? '<div class="chart-legend">' + legendHtml + "</div>" : "") +
			"</article>";
	}

	function kv(k, v) {
		return '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>";
	}

	function miniCard(title, tag, body) {
		return '<div class="mini-card"><h3>' + title + '</h3><span class="mini-tag">' + tag + "</span>" + body + "</div>";
	}

	function renderWeather(w) {
		const n = w.now;
		const a = w.agg;
		const tzName = w.timezone || "UTC";
		$("weather-meta").textContent = "OPEN-METEO · " + tzName.replace(/_/g, " ").toUpperCase() + " · 7D HISTORY + 7D FORECAST";

		const info = WX.codeInfo(n.code);

		const tiles = [
			tile("hero-tile", "TEMPERATURE", U.num(n.tempC, 1) + "<small>°C</small>", "feels " + U.num(n.feelsC, 1) + "° · " + info.label),
			tile("wind-tile", "WIND 10 M", U.num(n.windKph, 0) + "<small>km/h</small>", U.compass(n.windDir) + " " + U.num(n.windDir, 0) + "° · 80 m " + U.num(n.wind80, 0)),
			tile("", "GUSTS", U.num(n.gustKph, 0) + "<small>km/h</small>", "72 h max " + U.num(a.gustMax, 0)),
			tile("rain-tile", "RAIN 24 H", U.num(a.rain24, 1) + "<small>mm</small>", "next 24 h " + U.num(a.next24Prob, 0) + "% chance"),
			tile("", "HUMIDITY", U.num(n.rh, 0) + "<small>%</small>", "dew point " + U.num(n.dewC, 1) + "°"),
			tile("", "CLOUD COVER", U.num(n.cloud, 0) + "<small>%</small>", "low " + U.num(n.cloudLow, 0) + " · mid " + U.num(n.cloudMid, 0)),
			tile("", "PRESSURE", U.num(n.pressure, 0) + "<small>hPa</small>", "surface " + U.num(n.surfacePressure, 0)),
			tile("sun-tile", "UV INDEX", U.num(n.uv, 1), "today max " + U.num(a.uvMax, 1)),
			tile("", "VISIBILITY", U.num(n.visM != null ? n.visM / 1000 : null, 1) + "<small>km</small>", "horizontal"),
			tile("", "SOIL 3–9 CM", U.num(a.soilMoisture, 2), "m³/m³ · " + U.num(a.soilTemp, 1) + "°C"),
			tile("", "CAPE", U.num(n.cape, 0), "J/kg storm energy"),
			tile("", "FREEZING LEVEL", U.num(n.freezingM, 0) + "<small>m</small>", "above sea level")
		].join("");

		const daily = w.daily.slice(0, 7).map(function (d, i) {
			return '<div class="day-card' + (i === 0 ? " today" : "") + '">' +
				'<span class="dc-day">' + (i === 0 ? "TODAY" : U.fmtDay(d.t * 1000, tzName).toUpperCase()) + "</span>" +
				'<span class="dc-icon" title="' + U.esc(d.label) + " · sunrise " + U.fmtHM(d.sunrise, tzName) + " · sunset " + U.fmtHM(d.sunset, tzName) + '">' + d.icon + "</span>" +
				'<span class="dc-temp">' + U.num(d.tmax, 0) + "° <small style=\"opacity:.55\">/ " + U.num(d.tmin, 0) + "°</small></span>" +
				'<span class="dc-rain">' + U.num(d.rain, 1) + " mm · " + U.num(d.prob, 0) + "%</span>" +
				"</div>";
		}).join("");

		const roseLegend = legend(CHARTS.ROSE_BINS.map(function (b) { return [b.color, b.label + " KM/H"]; }));

		let charts = [
			chartCard("WIND SPEED + GUSTS", "72 H · KM/H", 2, CHARTS.windSpeed(w.hours, tzName),
				legend([["#101b0f", "SPEED 10 M"], ["#ff4d97", "GUSTS"]])),
			chartCard("WIND ROSE", "14-DAY FREQUENCY", 1, CHARTS.windRose(w.hours), roseLegend),
			chartCard("PRECIPITATION", "72 H · MM + PROBABILITY", 1, CHARTS.precip(w.hours, tzName),
				legend([["#8b5cf6", "MM / H"], ["#ff4d97", "PROB %"]])),
			chartCard("TEMP · DEW · HUMIDITY", "72 H", 1, CHARTS.tempHum(w.hours, tzName),
				legend([["#101b0f", "TEMP"], ["#8b5cf6", "DEW"], ["#14d6c4", "RH %"]])),
			chartCard("CLOUD LAYERS", "72 H · %", 1, CHARTS.clouds(w.hours, tzName),
				legend([["#14d6c4", "LOW"], ["#ffd633", "MID"], ["#8b5cf6", "HIGH"], ["#101b0f", "TOTAL"]])),
			chartCard("SOLAR RADIATION", "72 H · W/M²", 2, CHARTS.solar(w.hours, tzName),
				legend([["#ffd633", "GLOBAL"], ["#ff7a3d", "DIRECT"], ["#8b5cf6", "DIFFUSE"]])),
			chartCard("VERTICAL WIND PROFILE", "NOW · ECMWF PRESSURE LEVELS", 1,
				CHARTS.profile(w.profile, "VALID " + U.fmtTime(Date.now(), tzName)))
		];

		if (w.history.length) {
			charts.push(chartCard("36-DAY HISTORY", "ERA5 ARCHIVE · °C / MM", 3, CHARTS.history(w.history, tzName),
				legend([["#ff4d97", "TMAX"], ["#14d6c4", "TMIN"], ["#8b5cf6", "RAIN"]])));
		}

		const soil = miniCard("SOIL PROFILE", "OPEN-METEO LAND", [
			kv("TEMP 0 CM", U.num(n.soilT0, 1) + " °C"),
			kv("TEMP 6 CM", U.num(n.soilT6, 1) + " °C"),
			kv("MOISTURE 0–1 CM", U.num(n.soilM01, 2) + " m³/m³"),
			kv("MOISTURE 3–9 CM", U.num(n.soilM39, 2) + " m³/m³"),
			kv("7-DAY ET₀", U.num(a.et0_7d, 1) + " mm"),
			'<span class="note-line">ET₀ = FAO reference evapotranspiration, the crop water-use baseline.</span>'
		].join(""));

		const heights = miniCard("WIND BY HEIGHT", "10 / 80 / 120 M", [
			'<div class="kv"><span>10 M</span><b>' + U.num(n.windKph, 0) + " km/h · " + U.compass(n.windDir) + "</b></div>",
			'<div class="kv"><span>80 M</span><b>' + U.num(n.wind80, 0) + " km/h · " + U.compass(n.dir80) + "</b></div>",
			'<div class="kv"><span>120 M</span><b>' + U.num(n.wind120, 0) + " km/h · " + U.compass(n.dir120) + "</b></div>",
			'<div class="kv"><span>GUST FACTOR</span><b>' + (n.windKph ? U.num(n.gustKph / n.windKph, 2) : "—") + "×</b></div>",
			'<div class="kv"><span>VPD NOW</span><b>' + U.num(n.vpd, 2) + " kPa</b></div>"
		].join(""));

		const nowSec = Math.floor(Date.now() / 1000);
		const h24 = w.hours.filter(function (r) { return r.t >= nowSec - 86400 && r.t <= nowSec; });
		const h7 = w.hours.filter(function (r) { return r.t >= nowSec - 7 * 86400 && r.t <= nowSec; });
		function sumKey(rows, k) {
			return U.sum(rows.map(function (r) { return r[k]; }).filter(function (v) { return v != null && isFinite(v); }));
		}
		function maxKey(rows, k) {
			const v = rows.map(function (r) { return r[k]; }).filter(function (x) { return x != null && isFinite(x); });
			return v.length ? Math.max.apply(null, v) : null;
		}

		const precipCard = miniCard("PRECIPITATION BREAKDOWN", "RAIN · SHOWERS · SNOW", [
			kv("RAIN 24 H", U.num(sumKey(h24, "rain"), 1) + " mm"),
			kv("SHOWERS 24 H", U.num(sumKey(h24, "showers"), 1) + " mm"),
			kv("SNOWFALL 24 H", U.num(sumKey(h24, "snowfall"), 1) + " cm"),
			kv("TOTAL 7 D", U.num(a.rain7d, 1) + " mm"),
			kv("PEAK INTENSITY", U.num(maxKey(h24, "precipitation"), 1) + " mm/h"),
			kv("WET HOURS 7 D", h7.filter(function (r) { return r.precipitation > 0.1; }).length + " h")
		].join(""));

		let airCard;
		if (w.air) {
			const aq = w.air.now;
			airCard = miniCard("AIR QUALITY", "OPEN-METEO CAMS", [
				kv("PM2.5", U.num(aq.pm25, 1) + " µg/m³"),
				kv("PM10", U.num(aq.pm10, 1) + " µg/m³"),
				kv("OZONE", U.num(aq.ozone, 0) + " µg/m³"),
				kv("NO₂", U.num(aq.no2, 1) + " µg/m³"),
				kv("DUST", U.num(aq.dust, 1) + " µg/m³"),
				kv("US AQI", U.num(aq.usaqi, 0))
			].join(""));
		} else {
			airCard = miniCard("AIR QUALITY", "NO GRID", '<span class="note-line">No air-quality model covers this location. The rest of the weather deck is unaffected.</span>');
		}

		const adv = miniCard("ADVANCED ATMOSPHERE", "BOUNDARY LAYER + STABILITY", [
			kv("CAPE", U.num(n.cape, 0) + " J/kg"),
			kv("VPD", U.num(n.vpd, 2) + " kPa"),
			kv("BOUNDARY LAYER", U.num(n.blM, 0) + " m"),
			kv("FREEZING LEVEL", U.num(n.freezingM, 0) + " m"),
			kv("VISIBILITY", U.num(n.visM != null ? n.visM / 1000 : null, 1) + " km"),
			kv("DIRECT NORMAL IRR.", U.num(n.dni, 0) + " W/m²")
		].join(""));

		const minis = [soil, precipCard, heights, airCard, adv];
		if (w.marine) {
			const m = w.marine.now;
			minis.push(miniCard("MARINE", "COASTAL GRID", [
				kv("WAVE HEIGHT", U.num(m.height, 2) + " m"),
				kv("WAVE DIRECTION", U.compass(m.dir) + " (" + U.num(m.dir, 0) + "°)"),
				kv("WAVE PERIOD", U.num(m.period, 1) + " s"),
				'<span class="note-line">Ocean forcing near the coast — useful for coastal irrigation intakes and storm surge planning.</span>'
			].join("")));
		}

		$("weather-body").innerHTML =
			'<div class="now-grid">' + tiles + "</div>" +
			'<div class="daily-strip">' + daily + "</div>" +
			'<div class="chart-grid">' + charts.join("") + "</div>" +
			'<div class="mini-grid">' + minis.join("") + "</div>";
	}

	/* ══════════════════════════════════════
	   AI
	══════════════════════════════════════ */
	function buildDigest() {
		const base = WX.digest(state.weather);
		if (!base) return null;
		base.place = state.place ? state.place.label : null;
		base.coords = { lat: U.round(state.lat, 4), lon: U.round(state.lon, 4) };

		if (state.scenes.length) {
			base.imagery = state.scenes.slice(0, 4).map(function (s) {
				return {
					satellite: s.satellite,
					acquiredUtc: s.datetime,
					cloudPct: s.cloud == null ? null : Math.round(s.cloud),
					passDeltaMin: s.pass ? Math.round(s.pass.deltaMin) : null,
					passDistanceKm: s.pass ? Math.round(s.pass.minDistKm) : null
				};
			});
			if (state.scenes[0].cloud != null) base.agronomy.imageryClouds = Math.round(state.scenes[0].cloud);
		}

		if (state.sat) {
			const s = state.sat;
			const lastS2 = s.sentinel2.length ? s.sentinel2[s.sentinel2.length - 1] : null;
			base.satellites = {
				window: "last 7 days",
				tleCacheHours: 2,
				catalogObjects: s.catalog,
				trackedSatellites: s.tracked,
				skippedSlowOrbits: s.skipped,
				totalPasses: s.counts.total,
				sentinel2Passes: s.counts.sentinel2,
				landsatPasses: s.counts.landsat8 + s.counts.landsat9,
				lastSentinel2PassLocal: lastS2 ? U.fmtTime(lastS2.closestT, tz()) : null,
				passRule: "Sentinel-2 within 145 km, Landsat 8/9 within 93 km, other satellites at 10° elevation"
			};
		}
		return base;
	}

	async function generateInsights() {
		if (!state.weather || state.aiBusy) return;
		state.aiBusy = true;
		const btn = $("ai-run");
		btn.disabled = true;
		btn.innerHTML = '<span class="spin"></span>THINKING…';
		$("ai-output").innerHTML = '<div class="empty-note dark"><span class="spin"></span>READING THE FIELD RECORD…</div>';

		const digest = buildDigest();
		let result = null;
		let failed = false;

		try {
			if (AI.hasKey()) {
				result = await AI.run(digest);
			} else {
				result = AI.localInsights(digest);
			}
		} catch (e) {
			failed = true;
			result = AI.localInsights(digest);
			result.model = "LOCAL FALLBACK (AI ERROR)";
			result.local = true;
			toast("AI: " + e.message, true);
		}

		state.insights = result;
		state.aiBusy = false;
		btn.disabled = false;
		btn.textContent = "GENERATE INSIGHTS →";
		renderInsights();

		if (!failed && !AI.hasKey()) {
			/* quiet nudge, no blocking dialog */
			const status = $("ai-status");
			status.title = "Add an AI key for model-written insights";
		}
	}

	function renderInsights() {
		const r = state.insights;
		if (!r) return;

		const status = $("ai-status");
		if (r.local) {
			status.textContent = "LOCAL ENGINE";
			status.className = "ai-status local";
		} else {
			status.textContent = "AI LIVE";
			status.className = "ai-status live";
		}

		const cards = r.insights.map(function (it) {
			const sev = ["critical", "warning", "good", "info"].indexOf(it.severity) >= 0 ? it.severity : "info";
			return '<article class="ai-card">' +
				'<div class="ac-top"><span class="ai-sev ' + sev + '">' + sev.toUpperCase() + "</span></div>" +
				"<h4>" + U.esc(it.title) + "</h4>" +
				"<p>" + U.esc(it.detail) + "</p>" +
				(it.action ? '<div class="ac-action"><b>ACTION</b>' + U.esc(it.action) + "</div>" : "") +
				"</article>";
		}).join("");

		$("ai-output").innerHTML =
			'<div class="ai-summary">' + U.esc(r.summary || "") + "</div>" +
			cards +
			'<div class="ai-foot">ADVISORY ONLY · ' + U.esc(r.model || "LOCAL ENGINE") +
			" · GROUNDED IN OPEN-METEO, CELESTRAK TLE AND PLANETARY COMPUTER METADATA</div>";
	}

	/* ══════════════════════════════════════
	   SETTINGS DRAWER
	══════════════════════════════════════ */
	function openSettings() {
		$("settings-drawer").classList.add("open");
		$("settings-overlay").classList.add("open");
		$("settings-drawer").setAttribute("aria-hidden", "false");
	}
	function closeSettings() {
		$("settings-drawer").classList.remove("open");
		$("settings-overlay").classList.remove("open");
		$("settings-drawer").setAttribute("aria-hidden", "true");
	}

	function syncKeyUI() {
		const on = AI.hasKey();
		const badge = $("ai-key-badge");
		badge.textContent = on ? "✓" : "!";
		badge.classList.toggle("ok", on);
		const status = $("ai-status");
		if (!state.insights || state.insights.local) {
			status.textContent = on ? "AI READY" : "LOCAL ENGINE";
			status.className = "ai-status " + (on ? "live" : "local");
			if (on) status.textContent = "AI KEY SET";
		}
	}

	function initSettings() {
		const cfg = AI.getConfig();
		$("ai-provider").value = cfg.provider;
		$("ai-base").value = cfg.baseUrl;
		$("ai-model").value = cfg.model;
		$("ai-key").value = cfg.key;
		syncKeyUI();

		$("ai-provider").addEventListener("change", function () {
			const preset = AI.PRESETS[$("ai-provider").value];
			if (preset) {
				$("ai-base").value = preset.baseUrl;
				$("ai-model").value = preset.model;
			}
		});

		$("settings-form").addEventListener("submit", function (e) {
			e.preventDefault();
			const cfgNext = {
				provider: $("ai-provider").value,
				baseUrl: $("ai-base").value.trim(),
				model: $("ai-model").value.trim(),
				key: $("ai-key").value.trim()
			};
			AI.saveConfig(cfgNext);
			syncKeyUI();
			closeSettings();
			toast(cfgNext.key ? "AI KEY SAVED" : "SAVED · LOCAL MODE");
		});

		$("ai-clear").addEventListener("click", function () {
			const cfgNext = AI.getConfig();
			cfgNext.key = "";
			AI.saveConfig(cfgNext);
			$("ai-key").value = "";
			syncKeyUI();
			toast("AI KEY CLEARED · LOCAL MODE");
		});

		$("settings-close").addEventListener("click", closeSettings);
		$("settings-overlay").addEventListener("click", closeSettings);
		$("ai-key-btn").addEventListener("click", openSettings);
	}

	/* ══════════════════════════════════════
	   EVENTS + BOOT
	══════════════════════════════════════ */
	function boot() {
		initMap();
		initSettings();

		const search = SEARCH.attach({
			form: "search-form",
			input: "place-input",
			suggestions: "suggestions",
			coordToggle: "coord-toggle",
			coordForm: "coord-form",
			coordLat: "coord-lat",
			coordLon: "coord-lon",
			onPlace: selectPlace,
			onError: function (err) { toast(err && err.message ? err.message : String(err), true); }
		});

		$("quick-chips").addEventListener("click", function (e) {
			const btn = e.target.closest("button[data-place]");
			if (!btn) return;
			if (search) search.submitQuery(btn.getAttribute("data-place"));
		});

		$("pass-filters").addEventListener("click", function (e) {
			const btn = e.target.closest("button[data-filter]");
			if (!btn) return;
			state.filter = btn.getAttribute("data-filter");
			renderPasses();
		});

		$("ai-run").addEventListener("click", function () {
			generateInsights();
		});

		$("tle-refresh").addEventListener("click", async function () {
			const btn = $("tle-refresh");
			btn.disabled = true;
			btn.textContent = "↻ …";
			try {
				if (state.place && state.signal) {
					await loadOrbits(state.signal.signal, true);
					toast("TLE REFRESHED");
				} else {
					const t = await SAT.getTLE(true);
					toast("TLE CACHED · " + t.count + " OBJECTS");
				}
			} catch (e) {
				if (!e || e.name !== "AbortError") toast("TLE: " + e.message, true);
			} finally {
				btn.disabled = false;
				btn.textContent = "↻ TLE";
			}
		});

		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") closeSettings();
		});

		const saved = U.store.get("fw.last.v1", null);
		if (saved && saved.label) {
			$("place-input").value = saved.label;
		} else {
			$("place-input").value = "Colombo, Sri Lanka";
		}

		const cache = SAT.cacheInfo();
		if (cache) {
			$("hc-tle").textContent = cache.count + " OBJ · CACHE";
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
