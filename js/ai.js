/* ════════════════════════════════════════
   FIELD//WATCH — AI agronomist
   OpenAI-compatible chat endpoint, key held in localStorage.
   Falls back to a deterministic local rule engine.
═══════════════════════════════════════ */
window.AI = (function () {
	"use strict";

	const CFG_KEY = "fw.ai.v1";
	const PRESETS = {
		zai: { baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4-flash" },
		openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
		custom: { baseUrl: "", model: "" }
	};

	function getConfig() {
		const saved = U.store.get(CFG_KEY, null) || {};
		const provider = saved.provider || "zai";
		const preset = PRESETS[provider] || PRESETS.zai;
		return {
			provider: provider,
			baseUrl: saved.baseUrl || preset.baseUrl,
			model: saved.model || preset.model,
			key: saved.key || ""
		};
	}

	function saveConfig(cfg) {
		U.store.set(CFG_KEY, cfg);
	}

	function hasKey() {
		return !!getConfig().key;
	}

	/* ══════════════════════════════════════
	   LOCAL RULE ENGINE
	══════════════════════════════════════ */
	function localInsights(d) {
		const out = [];
		const a = d.agronomy || {};
		const add = (severity, title, detail, action) => out.push({ severity: severity, title: title, detail: detail, action: action });

		if (a.waterBalanceMm != null && a.waterBalanceMm <= -25) {
			add("critical", "Irrigation deficit is building",
				"Seven-day ET₀ of " + a.et0_7d + " mm against " + a.precip_7d + " mm of rain leaves a " + Math.abs(a.waterBalanceMm) + " mm shortfall.",
				"Irrigate the highest-value block before the next dry window and re-check moisture at 9 cm depth.");
		} else if (a.waterBalanceMm != null && a.waterBalanceMm >= 45) {
			add("warning", "Water surplus, drainage pressure",
				"Rain exceeds crop water use by " + a.waterBalanceMm + " mm over 7 days — root-zone saturation and nutrient leaching are likely.",
				"Open drainage lines, delay nitrogen top-dressing, and keep livestock off saturated paddocks.");
		}

		if (a.frostMinC != null && a.frostMinC <= 2) {
			add("critical", "Frost risk in the forecast",
				"The coldest forecast night drops to " + a.frostMinC + " °C with a dew point of " + a.dewMinC + " °C.",
				"Protect seedlings and flowering crops: covers, overhead irrigation at dusk, or shift harvest earlier.");
		}
		if (a.heatMaxC != null && a.heatMaxC >= 35) {
			add("warning", "Heat stress window",
				"Peak forecast temperature reaches " + a.heatMaxC + " °C (apparent " + a.apparentMaxC + " °C).",
				"Irrigate pre-dawn rather than midday, apply shade cloth on sensitive beds, and avoid spraying above 30 °C.");
		}
		if (a.diseaseHours != null && a.diseaseHours >= 8) {
			add("warning", "Leaf-wetness disease pressure",
				a.diseaseHours + " hours in the last 48 h sat above 90% humidity at 15–28 °C — a classic blight / mildew incubation window.",
				"Scout lower leaves today and consider a protectant spray if the canopy is still wet at dawn.");
		}
		if (a.vpdMaxKpa != null && a.vpdMaxKpa >= 3) {
			add("warning", "High vapour-pressure deficit",
				"VPD peaks at " + a.vpdMaxKpa + " kPa, which drives stomatal closure and transpiration stress even when soil moisture looks fine.",
				"Shift irrigation to early morning and reduce mid-afternoon cultivation to limit evaporative loss.");
		}
		if (a.sprayWindows != null && a.sprayWindows.length) {
			const w = a.sprayWindows[0];
			const when = w.when || w.label;
			const wind = w.windKph != null ? w.windKph : w.speed;
			const rain = w.rainPct != null ? w.rainPct : w.rain;
			add("good", "Spray window available",
				"Best low-drift window in the next 48 h: " + when + " with " + wind + " km/h wind from " + w.dir + " and a " + rain + "% rain chance.",
				"Book spraying for that slot; keep a 3–15 km/h wind band and avoid inversions near sunset.");
		} else if (a.sprayWindows != null) {
			add("info", "No clean spray window in 48 h",
				"Wind, rain probability or temperature stay outside the safe spraying band for the whole window.",
				"Postpone pesticide applications and prioritise mechanical or biological control for now.");
		}
		if (a.soilMoisture != null && a.soilMoisture < 0.15) {
			add("warning", "Topsoil is drying out",
				"0–9 cm volumetric soil moisture sits at " + a.soilMoisture + " m³/m³.",
				"Plan a moderate irrigation cycle; avoid deep tillage that breaks capillary flow to the surface.");
		}
		if (a.capeMax != null && a.capeMax >= 1200) {
			add("warning", "Convective storm energy",
				"CAPE reaches " + a.capeMax + " J/kg — thunderstorms, hail and gust fronts are plausible.",
				"Secure covers and irrigation booms, delay harvest of ripe blocks until the front passes.");
		}
		if (a.gustMax != null && a.gustMax >= 45) {
			add("warning", "Gust damage risk",
				"Peak gusts hit " + a.gustMax + " km/h.",
				"Stake tall crops, check trellis and netting anchors, and skip any spray operation.");
		}
		if (a.imageryClouds != null && a.imageryClouds >= 60) {
			add("info", "Optical imagery is cloud-limited",
				"The freshest optical scene is " + a.imageryClouds + "% cloud, so field change detection is unreliable.",
				"Use the weather and soil signals this week; queue the next clear pass instead of reading pixels.");
		}
		if (a.pm25 != null && a.pm25 >= 35) {
			add("info", "Particulate load is elevated",
				"PM2.5 is " + a.pm25 + " µg/m³, which can reduce photosynthesis and stress livestock.",
				"Avoid dusty field operations and keep irrigation going on sensitive blocks.");
		}
		if (a.gdd7 != null) {
			add("info", "Thermal time is accumulating",
				"Cumulative growing-degree-days (base 10 °C) over the last 7 days reached " + a.gdd7 + ".",
				"Compare against your crop stage model to time the next fertiliser or scouting pass.");
		}

		const rank = { critical: 0, warning: 1, good: 2, info: 3 };
		out.sort((x, y) => rank[x.severity] - rank[y.severity]);
		const picked = out.slice(0, 6);

		if (!picked.length) {
			picked.push({
				severity: "good",
				title: "Conditions are inside the normal band",
				detail: "No threshold in the local rule set was crossed for wind, rain, heat, frost, humidity or soil moisture.",
				action: "Keep the current irrigation schedule and use the pass table to plan the next imagery check."
			});
		}

		let summary = d.place ? d.place + ": " : "";
		if (d.weather && d.weather.current) {
			const c = d.weather.current;
			const rain = c.rain24hMm != null ? c.rain24hMm : (c.rain24 != null ? c.rain24 : 0);
			summary += c.tempC + " °C, " + c.windKph + " km/h wind, " + rain + " mm rain in 24 h. ";
		}
		summary += a.waterBalanceMm != null
			? "Seven-day water balance is " + (a.waterBalanceMm >= 0 ? "+" : "") + a.waterBalanceMm + " mm against " + a.et0_7d + " mm of crop water use."
			: "Weather and orbit context are loaded; add an AI key for model-written agronomy.";

		return {
			model: "LOCAL RULE ENGINE",
			summary: summary,
			insights: picked,
			local: true
		};
	}

	/* ══════════════════════════════════════
	   LLM CALL
	══════════════════════════════════════ */
	function systemPrompt() {
		return [
			"You are a field agronomist writing a short operational brief for a grower.",
			"You receive JSON with observations: current weather, yesterday, 7-day aggregates, a 7-day forecast, soil, air quality, satellite pass history and recent optical imagery metadata.",
			"Use only the supplied numbers. Do not invent data, crop types, locations or sensors.",
			"Write in plain, concrete language. Prefer actions over theory. Metric units.",
			"Return STRICT JSON only, no markdown, in this shape:",
			'{"summary":"2-3 sentence field brief","insights":[{"title":"short imperative or statement","severity":"critical|warning|good|info","detail":"1-2 sentences grounded in the numbers","action":"one concrete field action"}]}',
			"Give 5 to 7 insights. Put the most time-critical first. If imagery is cloudy, say so rather than pretending to see the crop."
		].join(" ");
	}

	function parseContent(text) {
		const raw = String(text || "").trim();
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		let obj = null;
		if (start !== -1 && end > start) {
			try { obj = JSON.parse(raw.slice(start, end + 1)); } catch (e) { obj = null; }
		}
		if (!obj) {
			try { obj = JSON.parse(raw); } catch (e) { obj = null; }
		}
		if (!obj || typeof obj !== "object") {
			return { summary: raw || "Model returned an empty response.", insights: [] };
		}
		const allowed = { critical: 1, warning: 1, good: 1, info: 1 };
		const insights = (Array.isArray(obj.insights) ? obj.insights : []).map((it) => ({
			title: String(it.title || "Field note").slice(0, 140),
			severity: allowed[String(it.severity || "").toLowerCase()] ? String(it.severity).toLowerCase() : "info",
			detail: String(it.detail || "").slice(0, 700),
			action: String(it.action || "").slice(0, 400)
		})).filter((it) => it.detail || it.action);
		return { summary: String(obj.summary || "").slice(0, 900), insights: insights };
	}

	async function run(digest, cfg) {
		const c = cfg || getConfig();
		if (!c.key) throw new Error("NO_KEY");
		if (!c.baseUrl) throw new Error("NO_ENDPOINT");
		const url = c.baseUrl.replace(/\/+$/, "") + "/chat/completions";

		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + c.key
			},
			body: JSON.stringify({
				model: c.model,
				temperature: 0.3,
				messages: [
					{ role: "system", content: systemPrompt() },
					{ role: "user", content: "Field observations JSON:\n" + JSON.stringify(digest) }
				]
			})
		});

		if (!res.ok) {
			let detail = "";
			try { detail = (await res.text()).slice(0, 220); } catch (e) { detail = ""; }
			const err = new Error("AI endpoint " + res.status + (detail ? " — " + detail : ""));
			err.status = res.status;
			throw err;
		}

		const data = await res.json();
		const content = data && data.choices && data.choices[0] && data.choices[0].message
			? data.choices[0].message.content
			: "";
		const parsed = parseContent(content);
		if (!parsed.insights.length && !parsed.summary) throw new Error("AI returned no usable content");
		return {
			model: (c.model || "model") + " · " + (data && data.model ? data.model : "remote"),
			summary: parsed.summary,
			insights: parsed.insights,
			local: false,
			raw: content
		};
	}

	return {
		getConfig: getConfig,
		saveConfig: saveConfig,
		hasKey: hasKey,
		localInsights: localInsights,
		run: run,
		PRESETS: PRESETS
	};
})();
