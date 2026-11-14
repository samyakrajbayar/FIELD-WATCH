/* ════════════════════════════════════════
   FIELD//WATCH — hand-rolled SVG charts
   (no chart library: wind rose, time series, vertical profile)
═══════════════════════════════════════ */
window.CHARTS = (function () {
	"use strict";

	const INK = "#101b0f";
	const COL = {
		lime: "#c6f24e",
		teal: "#14d6c4",
		yellow: "#ffd633",
		violet: "#8b5cf6",
		pink: "#ff4d97",
		orange: "#ff7a3d",
		grid: "rgba(16,27,15,0.16)"
	};

	const ROSE_BINS = [
		{ label: "0–5", color: COL.lime },
		{ label: "5–15", color: COL.teal },
		{ label: "15–25", color: COL.yellow },
		{ label: "25–40", color: COL.orange },
		{ label: "40+", color: COL.pink }
	];

	function open(w, h, label) {
		return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + label +
			'" preserveAspectRatio="xMidYMid meet" font-family="DM Mono, monospace">';
	}

	function txt(x, y, s, size, anchor, color, weight) {
		return '<text x="' + x + '" y="' + y + '" font-size="' + (size || 9) + '" fill="' + (color || INK) +
			'" text-anchor="' + (anchor || "start") + '"' + (weight ? ' font-weight="' + weight + '"' : "") + ">" +
			String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</text>";
	}

	function linePath(vals, fx, fy) {
		let d = "", pen = false;
		for (let i = 0; i < vals.length; i++) {
			const v = vals[i];
			if (v == null || !isFinite(v)) { pen = false; continue; }
			d += (pen ? "L" : "M") + fx(i).toFixed(1) + "," + fy(v).toFixed(1) + " ";
			pen = true;
		}
		return d.trim();
	}

	function areaPath(vals, fx, fy, baseY) {
		let d = "", seg = [];
		const flush = () => {
			if (seg.length > 1) {
				d += "M" + fx(seg[0]).toFixed(1) + "," + baseY.toFixed(1) + " ";
				seg.forEach((i) => {
					d += "L" + fx(i).toFixed(1) + "," + fy(vals[i]).toFixed(1) + " ";
				});
				const last = seg[seg.length - 1];
				d += "L" + fx(last).toFixed(1) + "," + baseY.toFixed(1) + " Z ";
			}
			seg = [];
		};
		for (let i = 0; i < vals.length; i++) {
			const v = vals[i];
			if (v == null || !isFinite(v)) flush();
			else seg.push(i);
		}
		flush();
		return d.trim();
	}

	function extent(series, fallbackLo, fallbackHi) {
		let lo = Infinity, hi = -Infinity;
		series.forEach((arr) => arr.forEach((v) => {
			if (v != null && isFinite(v)) {
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}));
		if (!isFinite(lo) || !isFinite(hi)) return [fallbackLo || 0, fallbackHi || 1];
		if (lo === hi) { lo -= 1; hi += 1; }
		return [lo, hi];
	}

	function niceMax(v, step) {
		const s = step || 10;
		return Math.max(s, Math.ceil(v / s) * s);
	}

	/* ── shared frame ── */
	function frame(w, h, pad) {
		const iw = w - pad.l - pad.r;
		const ih = h - pad.t - pad.b;
		return {
			w: w, h: h, pad: pad, iw: iw, ih: ih,
			x: function (i, n) { return pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); },
			barX: function (i, n) { return pad.l + ((i + 0.5) / n) * iw; },
			y: function (v, lo, hi) { return pad.t + ih - ((v - lo) / (hi - lo)) * ih; }
		};
	}

	function yAxis(f, lo, hi, ticks, unit, step) {
		let s = "";
		for (let i = 0; i <= ticks; i++) {
			const v = lo + ((hi - lo) * i) / ticks;
			const y = f.y(v, lo, hi);
			s += '<line x1="' + f.pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (f.w - f.pad.r) + '" y2="' + y.toFixed(1) +
				'" stroke="' + COL.grid + '" stroke-width="1"/>';
			s += txt(f.pad.l - 5, y + 3, unit === "%" ? Math.round(v) : Math.round(v), 8.5, "end", "rgba(16,27,15,0.65)");
		}
		return s;
	}

	function daySplits(times, tz, f, n) {
		let s = "";
		let prev = null;
		for (let i = 0; i < n; i++) {
			const k = U.dayKey(times[i] * 1000, tz);
			if (prev !== null && k !== prev) {
				const x = f.x(i, n);
				s += '<line x1="' + x.toFixed(1) + '" y1="' + f.pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (f.pad.t + f.ih) +
					'" stroke="rgba(16,27,15,0.35)" stroke-width="1.5" stroke-dasharray="4 4"/>';
			}
			prev = k;
		}
		return s;
	}

	function hourTicks(times, tz, f, n, count) {
		const every = Math.max(1, Math.round(n / (count || 6)));
		let s = "";
		for (let i = 0; i < n; i += every) {
			const x = f.x(i, n);
			s += txt(x, f.h - 8, U.fmtHM(times[i] * 1000, tz), 8.5, "middle", "rgba(16,27,15,0.6)");
		}
		return s;
	}

	function sliceWindow(hours, fromMs, toMs) {
		const out = [];
		for (let i = 0; i < hours.length; i++) {
			const t = hours[i].t * 1000;
			if (t >= fromMs && t <= toMs) out.push(hours[i]);
		}
		return out;
	}

	/* ══ WIND SPEED + GUSTS (72 h) ══ */
	function windSpeed(hours, tz) {
		const now = Date.now();
		const h = sliceWindow(hours, now - 24 * 3600000, now + 48 * 3600000);
		if (!h.length) return '<div class="chart-empty">NO WIND DATA</div>';
		const times = h.map((d) => d.t);
		const speed = h.map((d) => d.wind_speed_10m);
		const gust = h.map((d) => d.wind_gusts_10m);
		const hi = niceMax(extent([speed, gust], 0, 30)[1], 10);
		const f = frame(760, 250, { l: 40, r: 12, t: 14, b: 26 });
		const fy = (v) => f.y(v, 0, hi);
		let s = open(760, 250, "wind speed and gusts");
		s += yAxis(f, 0, hi, 4, "km/h");
		s += daySplits(times, tz, f, h.length);
		s += '<path d="' + areaPath(gust, (i) => f.x(i, h.length), fy, f.pad.t + f.ih) + '" fill="' + COL.pink + '" opacity="0.16"/>';
		s += '<path d="' + linePath(gust, (i) => f.x(i, h.length), fy) + '" fill="none" stroke="' + COL.pink + '" stroke-width="2" stroke-dasharray="5 3"/>';
		s += '<path d="' + linePath(speed, (i) => f.x(i, h.length), fy) + '" fill="none" stroke="' + INK + '" stroke-width="2.6"/>';
		// gust markers at local noon for readability
		s += hourTicks(times, tz, f, h.length, 7);
		s += txt(f.pad.l, 10, "MAX " + Math.round(extent([gust], 0, 0)[1]) + " KM/H", 9, "start", INK, "700");
		s += "</svg>";
		return s;
	}

	/* ══ WIND ROSE (full 14-day window) ══ */
	function windRose(hours) {
		const counts = [];
		for (let i = 0; i < 16; i++) counts.push([0, 0, 0, 0, 0]);
		let total = 0;
		hours.forEach((d) => {
			const sp = d.wind_speed_10m;
			const dir = d.wind_direction_10m;
			if (sp == null || dir == null || !isFinite(sp) || !isFinite(dir)) return;
			const b = sp < 5 ? 0 : sp < 15 ? 1 : sp < 25 ? 2 : sp < 40 ? 3 : 4;
			const idx = Math.round((((dir % 360) + 360) % 360) / 22.5) % 16;
			counts[idx][b]++;
			total++;
		});
		if (!total) return '<div class="chart-empty">NO WIND DATA</div>';

		const W = 340, H = 340, cx = 170, cy = 168, rMax = 108;
		let maxFreq = 0;
		counts.forEach((c) => { maxFreq = Math.max(maxFreq, c.reduce((a, b) => a + b, 0)); });
		maxFreq = maxFreq || 1;

		const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
		const petal = (r0, r1, a0, a1) => {
			const q0 = p(r0, a0), q1 = p(r1, a0), q2 = p(r1, a1), q3 = p(r0, a1);
			return "M" + q0[0].toFixed(1) + "," + q0[1].toFixed(1) +
				" L" + q1[0].toFixed(1) + "," + q1[1].toFixed(1) +
				" A" + r1.toFixed(1) + "," + r1.toFixed(1) + " 0 0 1 " + q2[0].toFixed(1) + "," + q2[1].toFixed(1) +
				" L" + q3[0].toFixed(1) + "," + q3[1].toFixed(1) +
				" A" + r0.toFixed(1) + "," + r0.toFixed(1) + " 0 0 0 " + q0[0].toFixed(1) + "," + q0[1].toFixed(1) + " Z";
		};

		let s = open(W, H, "wind rose");
		[0.25, 0.5, 0.75, 1].forEach((k) => {
			s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (rMax * k).toFixed(1) + '" fill="none" stroke="' + COL.grid + '" stroke-width="1"/>';
		});
		for (let d = 0; d < 16; d++) {
			const a0 = ((d * 22.5 - 11.25) * Math.PI) / 180;
			const a1 = ((d * 22.5 + 11.25) * Math.PI) / 180;
			let r0 = 0;
			counts[d].forEach((c, b) => {
				if (!c) return;
				const r1 = r0 + (c / maxFreq) * rMax;
				s += '<path d="' + petal(r0, r1, a0, a1) + '" fill="' + ROSE_BINS[b].color + '" stroke="' + INK + '" stroke-width="1.1">' +
					'<title>' + U.compass(d * 22.5) + " · " + c + " h · " + ROSE_BINS[b].label + " km/h</title></path>";
				r0 = r1;
			});
		}
		["N", "E", "S", "W"].forEach((lbl, i) => {
			const a = (i * 90 * Math.PI) / 180;
			const q = p(rMax + 14, a);
			s += txt(q[0], q[1] + 4, lbl, 11, "middle", INK, "700");
		});
		s += txt(cx, cy + 4, String(total), 13, "middle", INK, "700");
		s += txt(cx, cy + 16, "HRS", 8, "middle", "rgba(16,27,15,0.6)");
		s += txt(cx, H - 6, "PETAL = DIRECTION WIND COMES FROM", 7.5, "middle", "rgba(16,27,15,0.55)");
		s += "</svg>";
		return s;
	}

	/* ══ PRECIPITATION (72 h) ══ */
	function precip(hours, tz) {
		const now = Date.now();
		const h = sliceWindow(hours, now - 24 * 3600000, now + 48 * 3600000);
		if (!h.length) return '<div class="chart-empty">NO PRECIP DATA</div>';
		const times = h.map((d) => d.t);
		const vals = h.map((d) => (isFinite(d.precipitation) ? d.precipitation : 0));
		const prob = h.map((d) => d.precipitation_probability);
		const hi = niceMax(extent([vals], 0, 4)[1], 2);
		const f = frame(760, 250, { l: 40, r: 34, t: 14, b: 26 });
		const n = h.length;
		const bw = Math.max(1.5, (f.iw / n) * 0.66);
		let s = open(760, 250, "precipitation and probability");
		s += yAxis(f, 0, hi, 4, "mm");
		s += daySplits(times, tz, f, n);
		for (let i = 0; i < n; i++) {
			if (!vals[i]) continue;
			const x = f.barX(i, n) - bw / 2;
			const y = f.y(vals[i], 0, hi);
			s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' +
				(f.pad.t + f.ih - y).toFixed(1) + '" fill="' + COL.violet + '" stroke="' + INK + '" stroke-width="0.8"/>';
		}
		const fy2 = (v) => f.y(v, 0, 100);
		s += '<path d="' + linePath(prob, (i) => f.barX(i, n), fy2) + '" fill="none" stroke="' + COL.pink + '" stroke-width="2"/>';
		for (let i = 0; i <= 4; i++) {
			const v = i * 25;
			s += txt(f.w - f.pad.r + 5, f.y(v, 0, 100) + 3, v + "%", 8, "start", "rgba(16,27,15,0.55)");
		}
		s += hourTicks(times, tz, f, n, 7);
		s += txt(f.pad.l, 10, "TOTAL " + vals.reduce((a, b) => a + b, 0).toFixed(1) + " MM / 72 H", 9, "start", INK, "700");
		s += "</svg>";
		return s;
	}

	/* ══ TEMPERATURE / DEW POINT / HUMIDITY (72 h) ══ */
	function tempHum(hours, tz) {
		const now = Date.now();
		const h = sliceWindow(hours, now - 24 * 3600000, now + 48 * 3600000);
		if (!h.length) return '<div class="chart-empty">NO TEMPERATURE DATA</div>';
		const times = h.map((d) => d.t);
		const temp = h.map((d) => d.temperature_2m);
		const dew = h.map((d) => d.dew_point_2m);
		const rh = h.map((d) => d.relative_humidity_2m);
		const ex = extent([temp, dew], 0, 30);
		const lo = Math.floor(ex[0] - 2);
		const hi = Math.ceil(ex[1] + 2);
		const f = frame(760, 250, { l: 40, r: 34, t: 14, b: 26 });
		let s = open(760, 250, "temperature humidity and dew point");
		s += yAxis(f, lo, hi, 4, "°C");
		s += daySplits(times, tz, f, h.length);
		const fy = (v) => f.y(v, lo, hi);
		s += '<path d="' + areaPath(temp, (i) => f.x(i, h.length), fy, f.y(lo, lo, hi)) + '" fill="' + COL.lime + '" opacity="0.35"/>';
		s += '<path d="' + linePath(temp, (i) => f.x(i, h.length), fy) + '" fill="none" stroke="' + INK + '" stroke-width="2.6"/>';
		s += '<path d="' + linePath(dew, (i) => f.x(i, h.length), fy) + '" fill="none" stroke="' + COL.violet + '" stroke-width="2" stroke-dasharray="4 3"/>';
		const fyRh = (v) => f.y(v, 0, 100);
		s += '<path d="' + linePath(rh, (i) => f.x(i, h.length), fyRh) + '" fill="none" stroke="' + COL.teal + '" stroke-width="1.8" opacity="0.85"/>';
		for (let i = 0; i <= 4; i += 2) {
			s += txt(f.w - f.pad.r + 5, f.y(i * 25, 0, 100) + 3, i * 25 + "%", 8, "start", "rgba(16,27,15,0.55)");
		}
		s += hourTicks(times, tz, f, h.length, 7);
		s += "</svg>";
		return s;
	}

	/* ══ CLOUD COVER (72 h) ══ */
	function clouds(hours, tz) {
		const now = Date.now();
		const h = sliceWindow(hours, now - 24 * 3600000, now + 48 * 3600000);
		if (!h.length) return '<div class="chart-empty">NO CLOUD DATA</div>';
		const times = h.map((d) => d.t);
		const total = h.map((d) => d.cloud_cover);
		const low = h.map((d) => d.cloud_cover_low || 0);
		const mid = h.map((d) => d.cloud_cover_mid || 0);
		const high = h.map((d) => d.cloud_cover_high || 0);
		const f = frame(760, 220, { l: 40, r: 12, t: 12, b: 26 });
		const base = f.pad.t + f.ih;
		let s = open(760, 220, "cloud cover layers");
		s += yAxis(f, 0, 100, 4, "%");
		s += daySplits(times, tz, f, h.length);
		const fx = (i) => f.x(i, h.length);
		const fy = (v) => f.y(v, 0, 100);
		s += '<path d="' + areaPath(low, fx, fy, base) + '" fill="' + COL.teal + '" opacity="0.55"/>';
		s += '<path d="' + areaPath(mid, fx, fy, base) + '" fill="' + COL.yellow + '" opacity="0.55"/>';
		s += '<path d="' + areaPath(high, fx, fy, base) + '" fill="' + COL.violet + '" opacity="0.45"/>';
		s += '<path d="' + linePath(total, fx, fy) + '" fill="none" stroke="' + INK + '" stroke-width="2"/>';
		s += hourTicks(times, tz, f, h.length, 7);
		s += "</svg>";
		return s;
	}

	/* ══ SOLAR RADIATION (72 h) ══ */
	function solar(hours, tz) {
		const now = Date.now();
		const h = sliceWindow(hours, now - 24 * 3600000, now + 48 * 3600000);
		if (!h.length) return '<div class="chart-empty">NO RADIATION DATA</div>';
		const times = h.map((d) => d.t);
		const sw = h.map((d) => d.shortwave_radiation);
		const dir = h.map((d) => d.direct_radiation);
		const dif = h.map((d) => d.diffuse_radiation);
		const hi = niceMax(extent([sw], 0, 800)[1], 200);
		const f = frame(760, 220, { l: 40, r: 12, t: 12, b: 26 });
		let s = open(760, 220, "solar radiation");
		s += yAxis(f, 0, hi, 4, "W/m²");
		s += daySplits(times, tz, f, h.length);
		const fx = (i) => f.x(i, h.length);
		const fy = (v) => f.y(v, 0, hi);
		s += '<path d="' + areaPath(sw, fx, fy, f.pad.t + f.ih) + '" fill="' + COL.yellow + '" opacity="0.5"/>';
		s += '<path d="' + linePath(sw, fx, fy) + '" fill="none" stroke="' + INK + '" stroke-width="2.2"/>';
		s += '<path d="' + linePath(dir, fx, fy) + '" fill="none" stroke="' + COL.orange + '" stroke-width="1.7"/>';
		s += '<path d="' + linePath(dif, fx, fy) + '" fill="none" stroke="' + COL.violet + '" stroke-width="1.7" stroke-dasharray="4 3"/>';
		s += hourTicks(times, tz, f, h.length, 7);
		s += "</svg>";
		return s;
	}

	/* ══ VERTICAL WIND PROFILE (current hour) ══ */
	function profile(levels, whenLabel) {
		if (!levels || !levels.length) return '<div class="chart-empty">NO PRESSURE-LEVEL DATA</div>';
		const W = 340, H = 300, pad = { l: 54, r: 52, t: 26, b: 30 };
		const iw = W - pad.l - pad.r;
		const ih = H - pad.t - pad.b;
		const maxSpeed = niceMax(Math.max.apply(null, levels.map((l) => (isFinite(l.speed) ? l.speed : 0))), 20);
		const denom = Math.max(1, levels.length - 1);
		let s = open(W, H, "vertical wind profile");
		s += txt(pad.l, 14, "WIND / TEMP BY PRESSURE LEVEL", 8, "start", "rgba(16,27,15,0.65)");
		levels.forEach((lv, i) => {
			const y = pad.t + (i / denom) * (ih - 14) + 10;
			const w = isFinite(lv.speed) ? (lv.speed / maxSpeed) * iw : 0;
			s += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (pad.l + iw) + '" y2="' + y.toFixed(1) + '" stroke="' + COL.grid + '"/>';
			s += '<rect x="' + pad.l + '" y="' + (y - 6).toFixed(1) + '" width="' + Math.max(1, w).toFixed(1) + '" height="12" fill="' +
				(lv.hPa >= 700 ? COL.teal : lv.hPa >= 500 ? COL.yellow : COL.violet) + '" stroke="' + INK + '" stroke-width="1"/>';
			s += txt(pad.l - 6, y + 3, lv.hPa + "hPa", 8, "end", "rgba(16,27,15,0.7)");
			s += txt(pad.l + iw + 6, y + 3, Math.round(lv.speed) + " km/h", 8, "start", INK);
			s += txt(pad.l + iw + 40, y + 3, (isFinite(lv.tempC) ? lv.tempC.toFixed(0) : "–") + "°C", 8, "end", "rgba(16,27,15,0.6)");
			if (isFinite(lv.dir)) {
				const ax = pad.l + iw - 12;
				s += '<g transform="translate(' + ax + "," + (y - 7).toFixed(1) + ') rotate(' + lv.dir + ')">' +
					'<path d="M0 -6 L4 5 L0 2 L-4 5 Z" fill="' + INK + '"/></g>';
			}
		});
		s += txt(W - pad.r, H - 8, whenLabel || "", 8, "end", "rgba(16,27,15,0.6)");
		s += "</svg>";
		return s;
	}

	/* ══ 36-DAY HISTORY ══ */
	function history(days, tz) {
		if (!days || !days.length) return '<div class="chart-empty">NO HISTORY DATA</div>';
		const times = days.map((d) => d.t);
		const maxT = days.map((d) => d.tmax);
		const minT = days.map((d) => d.tmin);
		const rain = days.map((d) => d.precip);
		const ex = extent([maxT, minT], 0, 30);
		const lo = Math.floor(ex[0] - 2), hi = Math.ceil(ex[1] + 2);
		const rainHi = niceMax(extent([rain], 0, 5)[1], 5);
		const f = frame(760, 230, { l: 40, r: 34, t: 14, b: 28 });
		const n = days.length;
		const bw = Math.max(1.5, (f.iw / n) * 0.6);
		let s = open(760, 230, "36 day history");
		s += yAxis(f, lo, hi, 4, "°C");
		const base = f.y(lo, lo, hi);
		for (let i = 0; i < n; i++) {
			if (!rain[i]) continue;
			const hgt = (rain[i] / rainHi) * (f.ih * 0.45);
			s += '<rect x="' + (f.barX(i, n) - bw / 2).toFixed(1) + '" y="' + (base - hgt).toFixed(1) + '" width="' + bw.toFixed(1) +
				'" height="' + hgt.toFixed(1) + '" fill="' + COL.violet + '" opacity="0.55"/>';
		}
		const fx = (i) => f.barX(i, n);
		s += '<path d="' + linePath(maxT, fx, (v) => f.y(v, lo, hi)) + '" fill="none" stroke="' + COL.pink + '" stroke-width="2"/>';
		s += '<path d="' + linePath(minT, fx, (v) => f.y(v, lo, hi)) + '" fill="none" stroke="' + COL.teal + '" stroke-width="2"/>';
		for (let i = 0; i < n; i += 7) {
			s += txt(fx(i), f.h - 8, U.fmtDay(times[i] * 1000, tz), 8, "middle", "rgba(16,27,15,0.6)");
		}
		for (let i = 0; i <= 2; i++) {
			s += txt(f.w - f.pad.r + 5, f.y(rainHi * (i / 2), 0, rainHi) + 3, Math.round(rainHi * (i / 2)) + "mm", 7.5, "start", "rgba(16,27,15,0.5)");
		}
		s += "</svg>";
		return s;
	}

	return {
		windSpeed: windSpeed,
		windRose: windRose,
		precip: precip,
		tempHum: tempHum,
		clouds: clouds,
		solar: solar,
		profile: profile,
		history: history,
		ROSE_BINS: ROSE_BINS,
		COL: COL
	};
})();
