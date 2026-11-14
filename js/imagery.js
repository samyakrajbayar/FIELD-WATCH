/* ════════════════════════════════════════
   FIELD//WATCH — Planetary Computer STAC imagery
   POST https://planetarycomputer.microsoft.com/api/stac/v1/search
   collections=sentinel-2-l2a,landsat-c2-l2 · bbox=±0.03° · last 7 days
   preview: assets.rendered_preview.href, /item/preview.png? → /item/bbox/W,S,E,N.png?
═══════════════════════════════════════ */
window.IMAGERY = (function () {
	"use strict";

	const SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
	const BOX = 0.03;

	function bboxOf(lat, lon) {
		return [
			+(lon - BOX).toFixed(5),
			+(lat - BOX).toFixed(5),
			+(lon + BOX).toFixed(5),
			+(lat + BOX).toFixed(5)
		];
	}

	function satName(platform, id, collection) {
		let p = String(platform || "").trim().toUpperCase();
		p = p.replace(/^LANDSAT[ _-]?(\d)/, "LANDSAT $1");
		if (p) return p;
		const i = String(id || "").toUpperCase();
		if (i.indexOf("LC08") === 0) return "LANDSAT 8";
		if (i.indexOf("LC09") === 0) return "LANDSAT 9";
		if (i.indexOf("S2A") === 0) return "SENTINEL-2A";
		if (i.indexOf("S2B") === 0) return "SENTINEL-2B";
		if (i.indexOf("S2C") === 0) return "SENTINEL-2C";
		return collection === "landsat-c2-l2" ? "LANDSAT" : "SENTINEL-2";
	}

	function groupOf(name) {
		const rule = SAT.classify(name);
		return rule.group;
	}

	function normalize(feature, bbox) {
		const props = feature.properties || {};
		const name = satName(props.platform, feature.id, feature.collection);
		const previewAsset = feature.assets && feature.assets.rendered_preview;
		if (!previewAsset || !previewAsset.href) return null;

		const bboxStr = bbox.join(",");
		const preview = previewAsset.href.replace("/item/preview.png?", "/item/bbox/" + bboxStr + ".png?");

		return {
			id: feature.id,
			collection: feature.collection,
			satellite: name,
			group: groupOf(name),
			datetime: props.datetime,
			time: Date.parse(props.datetime),
			cloud: props["eo:cloud_cover"] == null ? null : Number(props["eo:cloud_cover"]),
			preview: preview,
			itemUrl: "https://planetarycomputer.microsoft.com/api/stac/v1/collections/" +
				encodeURIComponent(feature.collection) + "/items/" + encodeURIComponent(feature.id),
			bbox: bbox,
			pass: null
		};
	}

	async function search(opts) {
		const bbox = bboxOf(opts.lat, opts.lon);
		const days = opts.days || 7;
		const end = Date.now();
		const start = end - days * 86400000;

		const body = {
			collections: ["sentinel-2-l2a", "landsat-c2-l2"],
			bbox: bbox,
			datetime: new Date(start).toISOString() + "/" + new Date(end).toISOString(),
			limit: 60,
			sortby: [{ field: "datetime", direction: "desc" }]
		};

		const res = await fetch(SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: opts.signal
		});
		if (!res.ok) throw new Error("STAC HTTP " + res.status);

		const data = await res.json();
		const scenes = (data.features || [])
			.map((f) => normalize(f, bbox))
			.filter(Boolean);

		return { scenes: scenes, bbox: bbox, matched: 0, total: (data.features || []).length };
	}

	/* Match a photo to a pass of the same satellite between 10 min before
	   and 60 min after the photo time. Falls back to the constellation. */
	function matchPasses(scenes, passes) {
		const BEFORE = 10 * 60000;
		const AFTER = 60 * 60000;
		let matched = 0;

		scenes.forEach((scene) => {
			const t = scene.time;
			if (!isFinite(t) || !passes || !passes.length) {
				scene.pass = null;
				return;
			}
			const inWindow = (p) => p.closestT >= t - BEFORE && p.closestT <= t + AFTER;

			let pool = passes.filter((p) => p.name === scene.satellite && inWindow(p));
			let sameSatellite = true;
			if (!pool.length) {
				pool = passes.filter((p) => p.group === scene.group && inWindow(p));
				sameSatellite = false;
			}
			if (!pool.length) {
				scene.pass = null;
				return;
			}
			pool.sort((a, b) => Math.abs(a.closestT - t) - Math.abs(b.closestT - t));
			const best = pool[0];
			scene.pass = {
				name: best.name,
				closestT: best.closestT,
				deltaMin: (best.closestT - t) / 60000,
				minDistKm: best.minDistKm,
				maxElDeg: best.maxElDeg,
				sameSatellite: sameSatellite
			};
			matched++;
		});

		return matched;
	}

	return { search: search, matchPasses: matchPasses, bboxOf: bboxOf, SEARCH_URL: SEARCH_URL, BOX: BOX };
})();
