/* ════════════════════════════════════════
   FIELD//WATCH — shared helpers
═══════════════════════════════════════ */
window.U = (function () {
	"use strict";

	const RAD = Math.PI / 180;
	const DEG = 180 / Math.PI;

	/* ── localStorage wrapper ── */
	const store = {
		get(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				if (raw == null) return fallback;
				return JSON.parse(raw);
			} catch (e) {
				return fallback;
			}
		},
		set(key, val) {
			try {
				localStorage.setItem(key, JSON.stringify(val));
				return true;
			} catch (e) {
				return false;
			}
		},
		del(key) {
			try {
				localStorage.removeItem(key);
			} catch (e) { /* ignore */ }
		}
	};

	/* ── formatting ── */
	function esc(v) {
		return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
			"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
		}[c]));
	}

	function num(v, d, fallback) {
		if (v == null || !isFinite(v)) return fallback == null ? "—" : fallback;
		return Number(v).toFixed(d == null ? 0 : d);
	}

	const dtCache = new Map();
	function dtf(tz, opts) {
		const key = (tz || "local") + "|" + JSON.stringify(opts);
		if (dtCache.has(key)) return dtCache.get(key);
		let f;
		try {
			f = new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: tz || undefined }, opts));
		} catch (e) {
			f = new Intl.DateTimeFormat("en-GB", opts);
		}
		dtCache.set(key, f);
		return f;
	}

	function fmtTime(ts, tz) {
		if (ts == null || !isFinite(ts)) return "—";
		return dtf(tz, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)).replace(",", "");
	}
	function fmtDay(ts, tz) {
		if (ts == null || !isFinite(ts)) return "—";
		return dtf(tz, { weekday: "short", day: "2-digit", month: "short" }).format(new Date(ts));
	}
	function fmtHM(ts, tz) {
		if (ts == null || !isFinite(ts)) return "—";
		return dtf(tz, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
	}
	function fmtDMY(ts, tz) {
		if (ts == null || !isFinite(ts)) return "—";
		return dtf(tz, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(ts));
	}
	function dayKey(ts, tz) {
		// en-CA gives YYYY-MM-DD
		return dtf(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts)).split("/").reverse().join("-");
	}
	function hourLabel(ts, tz) {
		return dtf(tz, { hour: "2-digit", hour12: false }).format(new Date(ts)) + ":00";
	}

	const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
	function compass(deg) {
		if (deg == null || !isFinite(deg)) return "—";
		return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
	}

	function arrowSvg(deg, size) {
		const s = size || 18;
		const rot = isFinite(deg) ? deg : 0;
		return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + rot + 'deg)">' +
			'<path d="M12 2 19 21 12 16.5 5 21Z" fill="currentColor" stroke="#101b0f" stroke-width="1.6" stroke-linejoin="round"/></svg>';
	}

	function clamp(v, lo, hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	function round(v, d) {
		if (v == null || !isFinite(v)) return null;
		const m = Math.pow(10, d == null ? 0 : d);
		return Math.round(v * m) / m;
	}

	function sum(arr) {
		return arr.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
	}

	function sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}

	/* Yields to the UI without the background-tab timer clamp that makes
	   setTimeout(0) take a full second. Used by the orbit replay. */
	const tickPort = (typeof MessageChannel !== "undefined") ? new MessageChannel() : null;
	const tickQueue = [];
	if (tickPort) {
		tickPort.port1.onmessage = function () {
			const resolve = tickQueue.shift();
			if (resolve) resolve();
		};
	}
	function tick() {
		if (!tickPort) return sleep(0);
		return new Promise(function (resolve) {
			tickQueue.push(resolve);
			tickPort.port2.postMessage(0);
		});
	}

	function abortError() {
		try {
			return new DOMException("Aborted", "AbortError");
		} catch (e) {
			const err = new Error("Aborted");
			err.name = "AbortError";
			return err;
		}
	}

	return {
		RAD, DEG, store, esc, num, fmtTime, fmtDay, fmtHM, fmtDMY, dayKey, hourLabel,
		compass, arrowSvg, clamp, round, sum, sleep, tick, abortError
	};
})();
