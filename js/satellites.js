/* ════════════════════════════════════════
   FIELD//WATCH — CelesTrak TLE cache + 7-day orbit replay
   TLE:   https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle
   Cache: localStorage, 2 hours
   Rules: Sentinel-2 <= 145 km | Landsat 8/9 <= 93 km | others elevation >= 10°
   Steps: 120 s while > 3500 km away, 10 s while closer
═══════════════════════════════════════ */
window.SAT = (function () {
	"use strict";

	const RAD = Math.PI / 180;
	const DEG = 180 / Math.PI;
	const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle";
	const CACHE_KEY = "fw.tle.v1";
	const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

	// Order matters: Sentinel-2 first, then Landsat.
	const RULES = [
		{ re: /SENTINEL-?2/i, group: "sentinel2", short: "S2", limitKm: 145 },
		{ re: /LANDSAT[\s_-]*8/i, group: "landsat8", short: "L8", limitKm: 93 },
		{ re: /LANDSAT[\s_-]*9/i, group: "landsat9", short: "L9", limitKm: 93 }
	];
	const OTHER = { group: "other", short: "OTH", limitKm: null };

	function classify(name) {
		for (let i = 0; i < RULES.length; i++) {
			if (RULES[i].re.test(name)) return RULES[i];
		}
		return OTHER;
	}

	function countTLE(text) {
		const m = String(text || "").match(/^1 /gm);
		return m ? m.length : 0;
	}

	/* ── TLE download / 2h cache ── */
	async function getTLE(force) {
		const cached = U.store.get(CACHE_KEY, null);
		if (!force && cached && cached.text && Date.now() - cached.at < CACHE_TTL) {
			return { text: cached.text, at: cached.at, cached: true, count: cached.count || countTLE(cached.text) };
		}
		const res = await fetch(TLE_URL, { cache: "no-store" });
		if (!res.ok) throw new Error("CelesTrak HTTP " + res.status);
		const text = await res.text();
		const count = countTLE(text);
		if (!count) throw new Error("CelesTrak returned an empty catalogue");
		const entry = { at: Date.now(), text: text, count: count };
		U.store.set(CACHE_KEY, entry);
		return { text: text, at: entry.at, cached: false, count: count };
	}

	function cacheInfo() {
		const cached = U.store.get(CACHE_KEY, null);
		if (!cached || !cached.text) return null;
		return { at: cached.at, count: cached.count || countTLE(cached.text), ageMs: Date.now() - cached.at };
	}

	/* ── TLE parse ── */
	function parseTLE(text) {
		const lines = String(text || "").split(/\r?\n/);
		const out = [];
		for (let i = 0; i < lines.length; i++) {
			const l1 = lines[i];
			if (!l1 || l1.charAt(0) !== "1" || l1.charAt(1) !== " ") continue;
			const l2 = lines[i + 1];
			if (!l2 || l2.charAt(0) !== "2" || l2.charAt(1) !== " ") continue;
			let name = (lines[i - 1] || "").trim();
			if (name.indexOf("0 ") === 0) name = name.slice(2).trim();
			out.push({
				name: name || "NORAD " + l1.substring(2, 7).trim(),
				line1: l1.trim(),
				line2: l2.trim()
			});
			i++;
		}
		return out;
	}

	/* ── replay ── */
	async function replay(opts) {
		const lat = opts.lat;
		const lon = opts.lon;
		const elevation = opts.elevation || 0;
		const days = opts.days || 7;
		const signal = opts.signal;
		const onProgress = opts.onProgress || function () {};

		if (typeof satellite === "undefined" || !satellite.twoline2satrec) {
			throw new Error("satellite.js failed to load");
		}

		const tle = await getTLE(opts.force);
		const parsed = parseTLE(tle.text);
		if (!parsed.length) throw new Error("No TLE records parsed");

		const end = Date.now();
		const start = end - days * 86400000;
		const obsGd = { longitude: lon * RAD, latitude: lat * RAD, height: elevation / 1000 };
		const obsLatRad = lat * RAD;
		const obsLonRad = lon * RAD;
		const EARTH_R = 6371;

		const passes = [];
		const bySat = new Map();
		const counts = { sentinel2: 0, landsat8: 0, landsat9: 0, other: 0, total: 0 };
		let tracked = 0;
		let skipped = 0;
		let steps = 0;
		let lastYield = performance.now();
		const total = parsed.length;

		function commit(p, revs) {
			p.durationMs = p.end - p.start;
			p.revsPerDay = revs;
			p.groupLabel = p.group === "sentinel2" ? "SENTINEL-2" : (p.group === "other" ? "OTHER" : "LANDSAT");
			passes.push(p);
			counts[p.group] = (counts[p.group] || 0) + 1;
			counts.total++;
			let rec = bySat.get(p.name);
			if (!rec) {
				rec = { name: p.name, group: p.group, short: p.short, revs: revs, passes: 0, bestEl: null, bestKm: null };
				bySat.set(p.name, rec);
			}
			rec.passes++;
			if (p.maxElDeg != null && (rec.bestEl == null || p.maxElDeg > rec.bestEl)) rec.bestEl = p.maxElDeg;
			if (rec.bestKm == null || p.minDistKm < rec.bestKm) rec.bestKm = p.minDistKm;
		}

		for (let i = 0; i < total; i++) {
			if (signal && signal.aborted) throw U.abortError();
			const item = parsed[i];
			const rule = classify(item.name);

			let rec = null;
			try {
				rec = satellite.twoline2satrec(item.line1, item.line2);
			} catch (e) {
				skipped++;
				continue;
			}
			if (!rec || !rec.no) {
				skipped++;
				continue;
			}

			const revs = (rec.no * 1440) / (2 * Math.PI);
			if (!(revs >= 11)) {
				// fewer than 11 orbits a day → skip
				skipped++;
				continue;
			}
			tracked++;

			const date = new Date(start);
			let cur = null;
			let satPasses = 0;
			let localSteps = 0;
			let nullRun = 0;

			for (let t = start; t <= end; ) {
				date.setTime(t);
				const pv = satellite.propagate(rec, date);
				steps++;
				localSteps++;
				let nextMs = 120000;

				if (pv && pv.position) {
					nullRun = 0;
					const gmst = satellite.gstime(date);
					const geo = satellite.eciToGeodetic(pv.position, gmst);
					const satLat = geo.latitude;
					const satLon = geo.longitude;

					/* great-circle distance from the place to the sub-satellite point */
					const dLat = satLat - obsLatRad;
					const dLon = satLon - obsLonRad;
					const hh = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
						Math.cos(obsLatRad) * Math.cos(satLat) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
					const dist = 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(hh)));

					let elev = null;
					if (rule.limitKm == null) {
						const ecf = satellite.eciToEcf(pv.position, gmst);
						const la = satellite.ecfToLookAngles(obsGd, ecf);
						elev = la.elevation * DEG;
					}

					const hit = rule.limitKm != null ? dist <= rule.limitKm : (elev != null && elev >= 10);

					if (hit) {
						if (!cur) {
							cur = {
								name: item.name,
								group: rule.group,
								short: rule.short,
								limitKm: rule.limitKm,
								start: t,
								end: t,
								minDistKm: dist,
								maxElDeg: elev,
								closestT: t,
								closestLat: satLat * DEG,
								closestLon: satLon * DEG
							};
						}
						if (dist < cur.minDistKm) {
							cur.minDistKm = dist;
							cur.closestT = t;
							cur.closestLat = satLat * DEG;
							cur.closestLon = satLon * DEG;
						}
						if (elev != null && (cur.maxElDeg == null || elev > cur.maxElDeg)) cur.maxElDeg = elev;
						cur.end = t;
					} else if (cur) {
						commit(cur, revs);
						satPasses++;
						cur = null;
					}

					nextMs = dist > 3500 ? 120000 : 10000;
				} else if (++nullRun > 4) {
					break;
				}

				t += nextMs;

				if ((localSteps & 255) === 0 && performance.now() - lastYield > 45) {
					onProgress({
						phase: "scan",
						satIndex: i + 1,
						total: total,
						satName: item.name,
						passes: counts.total,
						steps: steps,
						tracked: tracked,
						skipped: skipped
					});
					await U.tick();
					lastYield = performance.now();
					if (signal && signal.aborted) throw U.abortError();
				}
			}

			if (cur) {
				commit(cur, revs);
				satPasses++;
			}

			onProgress({
				phase: "scan",
				satIndex: i + 1,
				total: total,
				satName: item.name,
				passes: counts.total,
				steps: steps,
				tracked: tracked,
				skipped: skipped
			});

			if (performance.now() - lastYield > 45) {
				await U.tick();
				lastYield = performance.now();
				if (signal && signal.aborted) throw U.abortError();
			}
		}

		passes.sort((a, b) => a.start - b.start);

		const s2 = passes.filter((p) => p.group === "sentinel2");
		const landsat = passes.filter((p) => p.group === "landsat8" || p.group === "landsat9");
		const other = passes.filter((p) => p.group === "other");

		onProgress({
			phase: "done",
			satIndex: total,
			total: total,
			passes: counts.total,
			steps: steps,
			tracked: tracked,
			skipped: skipped
		});

		return {
			windowStart: start,
			windowEnd: end,
			days: days,
			tleAt: tle.at,
			tleCached: tle.cached,
			catalog: total,
			parsed: parsed.length,
			tracked: tracked,
			skipped: skipped,
			steps: steps,
			counts: counts,
			passes: passes,
			sentinel2: s2,
			landsat: landsat,
			other: other,
			bySat: Array.from(bySat.values()).sort((a, b) => b.passes - a.passes)
		};
	}

	return { replay: replay, getTLE: getTLE, cacheInfo: cacheInfo, parseTLE: parseTLE, classify: classify, TLE_URL: TLE_URL, CACHE_TTL: CACHE_TTL };
})();
