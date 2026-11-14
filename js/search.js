/* ════════════════════════════════════════
   FIELD//WATCH — shared place search
   • Nominatim autofill (debounced, cached)
   • exact latitude/longitude entry
   • keyboard navigation
═══════════════════════════════════════ */
window.SEARCH = (function () {
	"use strict";

	const NOMINATIM = "https://nominatim.openstreetmap.org/search";
	const cache = new Map();
	const MAX_CACHE = 60;

	function esc(v) {
		return U.esc(v);
	}

	/* ── exact coordinate parsing ──
	   Accepts: "6.9271, 79.8542" | "6.9271 79.8542"
	            "6.9271N 79.8542E" | "N 6.9271 E 79.8542"
	            "6.9271° S, 79.8542° W" | "-6.9271, -79.8542" */
	function parseCoords(text) {
		if (text == null) return null;
		const s = String(text).trim().replace(/[°º]/g, " ").replace(/\s+/g, " ");
		const m = s.match(/^([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*([NSEW])?\s*[, ]\s*([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*([NSEW])?$/i);
		if (!m) return null;
		let lat = parseFloat(m[2]);
		let lon = parseFloat(m[5]);
		const a = (m[1] || m[3] || "").toUpperCase();
		const b = (m[4] || m[6] || "").toUpperCase();
		if (a === "S" || b === "S") lat = -Math.abs(lat);
		if (a === "N" || b === "N") lat = Math.abs(lat);
		if (a === "W" || b === "W") lon = -Math.abs(lon);
		if (a === "E" || b === "E") lon = Math.abs(lon);
		if (!isFinite(lat) || !isFinite(lon)) return null;
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
		return { lat: lat, lon: lon };
	}

	function coordPlace(lat, lon) {
		const ns = lat >= 0 ? "N" : "S";
		const ew = lon >= 0 ? "E" : "W";
		return {
			label: lat.toFixed(5) + ", " + lon.toFixed(5),
			short: Math.abs(lat).toFixed(4) + "°" + ns + " " + Math.abs(lon).toFixed(4) + "°" + ew,
			region: "exact coordinates",
			type: "coords",
			lat: lat,
			lon: lon,
			bbox: null,
			source: "coords"
		};
	}

	function fromHit(hit, query) {
		const label = hit.display_name || String(query);
		const parts = label.split(",").map(function (p) { return p.trim(); });
		return {
			label: label,
			short: hit.name || parts[0] || String(query),
			region: parts.slice(1).join(", "),
			type: hit.type || hit.class || "place",
			lat: Number(hit.lat),
			lon: Number(hit.lon),
			bbox: Array.isArray(hit.boundingbox) ? hit.boundingbox.map(Number) : null,
			source: "nominatim"
		};
	}

	async function query(q, limit, signal) {
		const key = limit + "|" + q.toLowerCase();
		if (cache.has(key)) return cache.get(key);
		const url = NOMINATIM + "?format=json&limit=" + limit + "&q=" + encodeURIComponent(q);
		const res = await fetch(url, { headers: { Accept: "application/json" }, signal: signal });
		if (!res.ok) throw new Error("Geocoder HTTP " + res.status);
		const arr = await res.json();
		const out = (Array.isArray(arr) ? arr : []).map(function (h) { return fromHit(h, q); });
		cache.set(key, out);
		if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
		return out;
	}

	function attach(opts) {
		const form = document.getElementById(opts.form);
		const input = document.getElementById(opts.input);
		const box = document.getElementById(opts.suggestions);
		if (!form || !input || !box) return null;

		const btn = form.querySelector(".search-btn");
		const btnLabel = (btn && btn.getAttribute("data-label")) || (btn ? btn.textContent.trim() : "GO");

		const coordToggle = opts.coordToggle ? document.getElementById(opts.coordToggle) : null;
		const coordForm = opts.coordForm ? document.getElementById(opts.coordForm) : null;
		const coordLat = opts.coordLat ? document.getElementById(opts.coordLat) : null;
		const coordLon = opts.coordLon ? document.getElementById(opts.coordLon) : null;

		let rows = [];
		let coordHint = null;
		let active = -1;
		let timer = null;
		let ctrl = null;
		let busy = false;
		let lastPlace = null;

		function fail(err) {
			if (opts.onError) opts.onError(err instanceof Error ? err : new Error(String(err)));
			else console.error(err);
		}

		function setBusy(b) {
			busy = b;
			if (!btn) return;
			btn.disabled = b;
			btn.innerHTML = b ? '<span class="spin"></span>…' : btnLabel;
		}

		function close() {
			box.hidden = true;
			box.innerHTML = "";
			rows = [];
			active = -1;
		}

		function draw() {
			let html = "";
			if (coordHint) {
				html += '<button type="button" class="sugg sugg-coord" data-kind="coord">' +
					'<span class="sugg-name">USE THESE COORDINATES</span>' +
					'<span class="sugg-region">' + esc(coordHint.lat.toFixed(5) + ", " + coordHint.lon.toFixed(5)) + "</span>" +
					'<span class="sugg-type">LAT/LON</span></button>';
			}
			rows.forEach(function (p, i) {
				html += '<button type="button" class="sugg" data-kind="place" data-i="' + i + '">' +
					'<span class="sugg-name">' + esc(p.short) + "</span>" +
					'<span class="sugg-region">' + esc(p.region || p.label) + "</span>" +
					'<span class="sugg-type">' + esc(p.type) + "</span></button>";
			});
			box.innerHTML = html;
			box.hidden = !html;
			active = -1;
		}

		function paint() {
			const total = rows.length + (coordHint ? 1 : 0);
			if (!total) return;
			const els = box.querySelectorAll(".sugg");
			for (let i = 0; i < els.length; i++) els[i].classList.toggle("active", i === active);
			const cur = els[active];
			if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
		}

		async function lookup(q) {
			if (ctrl) ctrl.abort();
			ctrl = new AbortController();
			try {
				const found = await query(q, 6, ctrl.signal);
				if (input.value.trim() !== q) return;
				rows = found;
				coordHint = parseCoords(q);
				draw();
			} catch (e) {
				if (!e || e.name !== "AbortError") {
					/* suggestions are best-effort: stay silent */
				}
			}
		}

		async function submitPlace(place) {
			if (busy || !place) return;
			setBusy(true);
			try {
				await opts.onPlace(place);
				lastPlace = place;
				input.value = place.label;
				if (coordLat && coordLon && place.lat != null) {
					coordLat.value = place.lat.toFixed(5);
					coordLon.value = place.lon.toFixed(5);
				}
			} catch (e) {
				fail(e);
			} finally {
				setBusy(false);
			}
		}

		async function submitQuery(q) {
			if (busy) return;
			if (!q) return;
			close();
			const c = parseCoords(q);
			if (c) {
				await submitPlace(coordPlace(c.lat, c.lon));
				return;
			}
			try {
				const found = await query(q, 1);
				if (!found.length) throw new Error('No place found for "' + q + '"');
				await submitPlace(found[0]);
			} catch (e) {
				fail(e);
			}
		}

		function pick(index) {
			const offset = coordHint ? 1 : 0;
			if (coordHint && index === 0) {
				const c = coordHint;
				close();
				submitPlace(coordPlace(c.lat, c.lon));
				return;
			}
			const place = rows[index - offset];
			if (!place) return;
			close();
			submitPlace(place);
		}

		input.addEventListener("input", function () {
			const q = input.value.trim();
			coordHint = parseCoords(q);
			if (q.length < 3) {
				rows = [];
				if (coordHint) draw();
				else close();
				return;
			}
			rows = [];
			if (coordHint) draw();
			clearTimeout(timer);
			timer = setTimeout(function () { lookup(q); }, 480);
		});

		input.addEventListener("keydown", function (e) {
			if (box.hidden) return;
			const total = rows.length + (coordHint ? 1 : 0);
			if (!total) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				active = (active + 1) % total;
				paint();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				active = (active - 1 + total) % total;
				paint();
			} else if (e.key === "Enter" && active >= 0) {
				e.preventDefault();
				pick(active);
			} else if (e.key === "Escape") {
				close();
			}
		});

		box.addEventListener("click", function (e) {
			const b = e.target.closest("button[data-kind]");
			if (!b) return;
			if (b.getAttribute("data-kind") === "coord" && coordHint) {
				const c = coordHint;
				close();
				submitPlace(coordPlace(c.lat, c.lon));
			} else {
				pick(Number(b.getAttribute("data-i")) + (coordHint ? 1 : 0));
			}
		});

		form.addEventListener("submit", function (e) {
			e.preventDefault();
			if (active >= 0 && !box.hidden) {
				pick(active);
				return;
			}
			submitQuery(input.value.trim());
		});

		document.addEventListener("click", function (e) {
			if (!box.hidden && !box.contains(e.target) && !form.contains(e.target)) close();
		});

		if (coordToggle && coordForm) {
			coordToggle.addEventListener("click", function () {
				const show = coordForm.hidden;
				coordForm.hidden = !show;
				coordToggle.classList.toggle("on", show);
				if (show) {
					if (lastPlace && lastPlace.lat != null) {
						if (coordLat) coordLat.value = lastPlace.lat.toFixed(5);
						if (coordLon) coordLon.value = lastPlace.lon.toFixed(5);
					}
					if (coordLat) coordLat.focus();
				}
			});
		}

		if (coordForm && coordLat && coordLon) {
			coordForm.addEventListener("submit", function (e) {
				e.preventDefault();
				const la = parseFloat(coordLat.value);
				const lo = parseFloat(coordLon.value);
				if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
					fail("Latitude must be −90…90 and longitude −180…180");
					return;
				}
				submitPlace(coordPlace(la, lo));
			});
		}

		return {
			submitQuery: submitQuery,
			submitPlace: submitPlace,
			setPlace: function (p) {
				if (!p) return;
				lastPlace = p;
				input.value = p.label;
				if (coordLat && coordLon && p.lat != null) {
					coordLat.value = p.lat.toFixed(5);
					coordLon.value = p.lon.toFixed(5);
				}
			},
			close: close
		};
	}

	return {
		attach: attach,
		parseCoords: parseCoords,
		coordPlace: coordPlace,
		query: query
	};
})();
