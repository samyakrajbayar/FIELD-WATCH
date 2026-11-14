/* ════════════════════════════════════════
   FIELD//WATCH — Open-Meteo weather stack
   forecast (7 past + 7 forecast) · pressure levels · air quality · marine · archive
═══════════════════════════════════════ */
window.WX = (function () {
	"use strict";

	const API = "https://api.open-meteo.com/v1/forecast";
	const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";
	const MARINE = "https://marine-api.open-meteo.com/v1/marine";
	const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

	const HOURLY = [
		"temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m",
		"precipitation", "precipitation_probability", "rain", "showers", "snowfall",
		"weather_code", "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
		"pressure_msl", "surface_pressure",
		"wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
		"wind_speed_80m", "wind_direction_80m", "wind_speed_120m", "wind_direction_120m",
		"uv_index", "shortwave_radiation", "direct_radiation", "diffuse_radiation", "direct_normal_irradiance",
		"cape", "freezing_level_height", "boundary_layer_height", "visibility",
		"vapour_pressure_deficit", "et0_fao_evapotranspiration",
		"soil_temperature_0cm", "soil_temperature_6cm", "soil_moisture_0_to_1cm", "soil_moisture_3_to_9cm"
	];

	const DAILY = [
		"temperature_2m_max", "temperature_2m_min", "apparent_temperature_max", "apparent_temperature_min",
		"precipitation_sum", "rain_sum", "showers_sum", "snowfall_sum", "precipitation_hours",
		"precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
		"shortwave_radiation_sum", "uv_index_max", "et0_fao_evapotranspiration",
		"sunrise", "sunset", "daylight_duration", "sunshine_duration"
	];

	const CURRENT = [
		"temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day", "precipitation",
		"weather_code", "cloud_cover", "pressure_msl", "surface_pressure", "wind_speed_10m",
		"wind_direction_10m", "wind_gusts_10m"
	];

	const PL_LEVELS = [1000, 925, 850, 700, 600, 500, 300];
	const PL_VARS = [];
	PL_LEVELS.forEach((l) => {
		PL_VARS.push("temperature_" + l + "hPa", "wind_speed_" + l + "hPa", "wind_direction_" + l + "hPa");
	});

	function buildUrl(base, params) {
		const u = new URL(base);
		Object.keys(params).forEach((k) => {
			if (params[k] != null) u.searchParams.set(k, params[k]);
		});
		return u.toString();
	}

	async function getJSON(u, signal) {
		const res = await fetch(u, { signal: signal });
		let data = null;
		try { data = await res.json(); } catch (e) { data = null; }
		if (!res.ok || (data && data.error)) {
			const reason = data && (data.reason || data.error) ? (data.reason || data.error) : "HTTP " + res.status;
			throw new Error(String(reason).slice(0, 160));
		}
		if (!data) throw new Error("Empty response");
		return data;
	}

	function rowsOf(block) {
		if (!block || !Array.isArray(block.time)) return [];
		const out = new Array(block.time.length);
		for (let i = 0; i < block.time.length; i++) {
			const o = { t: block.time[i] };
			Object.keys(block).forEach((k) => {
				if (k !== "time") o[k] = block[k] ? block[k][i] : null;
			});
			out[i] = o;
		}
		return out;
	}

	function toMs(v) {
		if (v == null) return null;
		if (typeof v === "number") return v > 1e12 ? v : v * 1000;
		const n = Date.parse(v);
		return isFinite(n) ? n : null;
	}

	function nearestIndex(times, tsSec) {
		let best = 0, bd = Infinity;
		for (let i = 0; i < times.length; i++) {
			const d = Math.abs(times[i] - tsSec);
			if (d < bd) { bd = d; best = i; }
		}
		return best;
	}

	function rowAt(rows, tsSec) {
		if (!rows.length) return {};
		return rows[nearestIndex(rows.map((r) => r.t), tsSec)] || {};
	}

	function vals(rows, key) {
		return rows.map((r) => (r[key] == null || r[key] === "" ? null : Number(r[key])));
	}
	function finite(arr) {
		return arr.filter((v) => v != null && isFinite(v));
	}
	function mean(arr) {
		const v = finite(arr);
		return v.length ? U.sum(v) / v.length : null;
	}
	function maxOf(arr) {
		const v = finite(arr);
		return v.length ? Math.max.apply(null, v) : null;
	}
	function minOf(arr) {
		const v = finite(arr);
		return v.length ? Math.min.apply(null, v) : null;
	}
	function sumOf(arr) {
		const v = finite(arr);
		return v.length ? U.sum(v) : null;
	}

	function circularMean(degs) {
		let x = 0, y = 0;
		degs.forEach((d) => {
			if (d == null || !isFinite(d)) return;
			x += Math.cos((d * Math.PI) / 180);
			y += Math.sin((d * Math.PI) / 180);
		});
		if (!x && !y) return null;
		let a = (Math.atan2(y, x) * 180) / Math.PI;
		if (a < 0) a += 360;
		return a;
	}

	/* ── spray windows from hourly forecast ── */
	function sprayWindows(rows, tz) {
		const ok = rows.map((r) => (
			r.wind_speed_10m != null && r.wind_speed_10m >= 3 && r.wind_speed_10m <= 15 &&
			(r.precipitation_probability == null || r.precipitation_probability <= 30) &&
			(r.precipitation == null || r.precipitation <= 0.2) &&
			r.temperature_2m != null && r.temperature_2m >= 10 && r.temperature_2m <= 30
		));
		const out = [];
		let start = -1;
		for (let i = 0; i <= rows.length; i++) {
			if (i < rows.length && ok[i]) {
				if (start === -1) start = i;
			} else if (start !== -1) {
				const end = i - 1;
				if (end - start + 1 >= 2) {
					const seg = rows.slice(start, end + 1);
					const startMs = seg[0].t * 1000;
					const endMs = seg[seg.length - 1].t * 1000 + 3600000;
					const endLabel = (U.dayKey(startMs, tz) === U.dayKey(endMs, tz) ? "" : U.fmtDay(endMs, tz) + " ") + U.fmtHM(endMs, tz);
					out.push({
						startSec: seg[0].t,
						endSec: seg[seg.length - 1].t,
						label: U.fmtDay(startMs, tz) + " " + U.fmtHM(startMs, tz) + "–" + endLabel,
						speed: Math.round(mean(vals(seg, "wind_speed_10m")) || 0),
						dir: U.compass(circularMean(vals(seg, "wind_direction_10m"))),
						rain: Math.round(mean(vals(seg, "precipitation_probability")) || 0),
						hours: seg.length
					});
				}
				start = -1;
			}
		}
		return out.slice(0, 3);
	}

	/* ── weather code dictionary ── */
	function codeInfo(code) {
		const c = Number(code);
		if (c === 0) return { icon: "☀️", label: "Clear sky" };
		if (c === 1) return { icon: "🌤️", label: "Mainly clear" };
		if (c === 2) return { icon: "⛅", label: "Partly cloudy" };
		if (c === 3) return { icon: "☁️", label: "Overcast" };
		if (c === 45 || c === 48) return { icon: "🌫️", label: "Fog" };
		if (c >= 51 && c <= 57) return { icon: "🌦️", label: "Drizzle" };
		if (c >= 61 && c <= 65) return { icon: "🌧️", label: "Rain" };
		if (c === 66 || c === 67) return { icon: "🌨️", label: "Freezing rain" };
		if (c >= 71 && c <= 77) return { icon: "❄️", label: "Snow" };
		if (c >= 80 && c <= 82) return { icon: "🌧️", label: "Rain showers" };
		if (c === 85 || c === 86) return { icon: "🌨️", label: "Snow showers" };
		if (c >= 95) return { icon: "⛈️", label: "Thunderstorm" };
		return { icon: "🌡️", label: "—" };
	}

	/* ══════════════════════════════════════
	   LOAD
	══════════════════════════════════════ */
	async function load(opts) {
		const lat = opts.lat;
		const lon = opts.lon;
		const signal = opts.signal;
		const onStep = opts.onStep || function () {};

		onStep("WEATHER CORE");
		const core = await getJSON(buildUrl(API, {
			latitude: lat,
			longitude: lon,
			timezone: "auto",
			timeformat: "unixtime",
			wind_speed_unit: "kmh",
			past_days: 7,
			forecast_days: 7,
			hourly: HOURLY.join(","),
			daily: DAILY.join(","),
			current: CURRENT.join(",")
		}), signal);

		const tz = core.timezone || "UTC";
		const nowSec = Math.floor(Date.now() / 1000);
		const hours = rowsOf(core.hourly);
		const days = rowsOf(core.daily);
		const daily = days.map((d) => {
			const info = codeInfo(d.weather_code);
			return {
				t: d.t,
				tmax: d.temperature_2m_max,
				tmin: d.temperature_2m_min,
				appMax: d.apparent_temperature_max,
				rain: d.precipitation_sum,
				prob: d.precipitation_probability_max,
				gust: d.wind_gusts_10m_max,
				windDir: d.wind_direction_10m_dominant,
				code: d.weather_code,
				icon: info.icon,
				label: info.label,
				uv: d.uv_index_max,
				sunrise: toMs(d.sunrise),
				sunset: toMs(d.sunset),
				daylight: d.daylight_duration,
				et0: d.et0_fao_evapotranspiration,
				radiation: d.shortwave_radiation_sum,
				dateLabel: U.fmtDay(d.t * 1000, tz)
			};
		});

		onStep("PRESSURE LEVELS");
		let pl = null;
		try {
			pl = await getJSON(buildUrl(API, {
				latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime",
				wind_speed_unit: "kmh", forecast_days: 2, models: "ecmwf_ifs025",
				hourly: PL_VARS.join(",")
			}), signal);
		} catch (e) {
			try {
				pl = await getJSON(buildUrl(API, {
					latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime",
					wind_speed_unit: "kmh", forecast_days: 2,
					hourly: PL_VARS.join(",")
				}), signal);
			} catch (e2) {
				pl = null;
			}
		}

		onStep("AIR QUALITY");
		let air = null;
		try {
			const aq = await getJSON(buildUrl(AIR, {
				latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime",
				past_days: 2, forecast_days: 5,
				hourly: "pm2_5,pm10,ozone,nitrogen_dioxide,dust,european_aqi,us_aqi"
			}), signal);
			const aqRows = rowsOf(aq.hourly);
			const an = rowAt(aqRows, nowSec);
			air = {
				rows: aqRows,
				now: {
					pm25: an.pm2_5, pm10: an.pm10, ozone: an.ozone, no2: an.nitrogen_dioxide,
					dust: an.dust, eaqi: an.european_aqi, usaqi: an.us_aqi
				}
			};
		} catch (e) { air = null; }

		onStep("MARINE");
		let marine = null;
		try {
			const m = await getJSON(buildUrl(MARINE, {
				latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime",
				past_days: 1, forecast_days: 5,
				hourly: "wave_height,wave_direction,wave_period"
			}), signal);
			const mr = rowsOf(m.hourly);
			if (mr.length && finite(vals(mr, "wave_height")).length) {
				const mn = rowAt(mr, nowSec);
				marine = {
					rows: mr,
					now: { height: mn.wave_height, dir: mn.wave_direction, period: mn.wave_period }
				};
			}
		} catch (e) { marine = null; }

		onStep("HISTORY");
		let history = [];
		try {
			const end = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
			const start = new Date(Date.now() - 37 * 86400000).toISOString().slice(0, 10);
			const ar = await getJSON(buildUrl(ARCHIVE, {
				latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime",
				start_date: start, end_date: end,
				daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,wind_gusts_10m_max"
			}), signal);
			history = rowsOf(ar.daily).map((d) => ({
				t: d.t, tmax: d.temperature_2m_max, tmin: d.temperature_2m_min,
				precip: d.precipitation_sum, et0: d.et0_fao_evapotranspiration, gust: d.wind_gusts_10m_max
			}));
		} catch (e) { history = []; }

		/* ── current conditions ── */
		const cur = core.current || {};
		const nr = rowAt(hours, nowSec);
		const now = {
			t: toMs(cur.time) || Date.now(),
			tempC: cur.temperature_2m != null ? cur.temperature_2m : nr.temperature_2m,
			feelsC: cur.apparent_temperature != null ? cur.apparent_temperature : nr.apparent_temperature,
			rh: cur.relative_humidity_2m != null ? cur.relative_humidity_2m : nr.relative_humidity_2m,
			dewC: nr.dew_point_2m,
			windKph: cur.wind_speed_10m != null ? cur.wind_speed_10m : nr.wind_speed_10m,
			windDir: cur.wind_direction_10m != null ? cur.wind_direction_10m : nr.wind_direction_10m,
			gustKph: cur.wind_gusts_10m != null ? cur.wind_gusts_10m : nr.wind_gusts_10m,
			rainMm: cur.precipitation != null ? cur.precipitation : nr.precipitation,
			cloud: cur.cloud_cover != null ? cur.cloud_cover : nr.cloud_cover,
			pressure: cur.pressure_msl != null ? cur.pressure_msl : nr.pressure_msl,
			surfacePressure: cur.surface_pressure != null ? cur.surface_pressure : nr.surface_pressure,
			dni: nr.direct_normal_irradiance,
			code: cur.weather_code != null ? cur.weather_code : nr.weather_code,
			isDay: cur.is_day,
			uv: nr.uv_index,
			visM: nr.visibility,
			cape: nr.cape,
			freezingM: nr.freezing_level_height,
			blM: nr.boundary_layer_height,
			vpd: nr.vapour_pressure_deficit,
			soilT0: nr.soil_temperature_0cm,
			soilT6: nr.soil_temperature_6cm,
			soilM01: nr.soil_moisture_0_to_1cm,
			soilM39: nr.soil_moisture_3_to_9cm,
			wind80: nr.wind_speed_80m,
			dir80: nr.wind_direction_80m,
			wind120: nr.wind_speed_120m,
			dir120: nr.wind_direction_120m,
			et0: nr.et0_fao_evapotranspiration,
			rad: nr.shortwave_radiation,
			cloudLow: nr.cloud_cover_low,
			cloudMid: nr.cloud_cover_mid,
			cloudHigh: nr.cloud_cover_high
		};

		/* ── aggregates ── */
		const last24 = hours.filter((r) => r.t >= nowSec - 86400 && r.t <= nowSec);
		const last48 = hours.filter((r) => r.t >= nowSec - 2 * 86400 && r.t <= nowSec);
		const last7d = hours.filter((r) => r.t >= nowSec - 7 * 86400 && r.t <= nowSec);
		const next24 = hours.filter((r) => r.t > nowSec && r.t <= nowSec + 86400);
		const next48 = hours.filter((r) => r.t > nowSec && r.t <= nowSec + 2 * 86400);
		const next72 = hours.filter((r) => r.t > nowSec && r.t <= nowSec + 3 * 86400);

		const todayKey = U.dayKey(nowSec * 1000, tz);
		const yKey = U.dayKey((nowSec - 86400) * 1000, tz);
		const todayHours = hours.filter((r) => U.dayKey(r.t * 1000, tz) === todayKey && r.t <= nowSec);
		const yHours = hours.filter((r) => U.dayKey(r.t * 1000, tz) === yKey);

		const et0_7d = sumOf(vals(last7d, "et0_fao_evapotranspiration")) || 0;
		const precip_7d = sumOf(vals(last7d, "precipitation")) || 0;

		const gddList = daily.filter((d) => d.t * 1000 <= nowSec * 1000).slice(-7);
		const gdd7 = gddList.reduce((acc, d) => {
			const tmax = d.tmax, tmin = d.tmin;
			if (tmax == null || tmin == null) return acc;
			return acc + Math.max(0, (tmax + tmin) / 2 - 10);
		}, 0);

		const forecastDays = daily.filter((d) => d.t * 1000 >= Date.now() - 12 * 3600000).slice(0, 7);
		const next4 = forecastDays.slice(0, 4);

		const agg = {
			rain24: sumOf(vals(last24, "precipitation")) || 0,
			rain48: sumOf(vals(last48, "precipitation")) || 0,
			rain7d: precip_7d,
			et0_7d: et0_7d,
			waterBalanceMm: precip_7d - et0_7d,
			gdd7: gdd7,
			yRain: sumOf(vals(yHours, "precipitation")) || 0,
			yEt0: sumOf(vals(yHours, "et0_fao_evapotranspiration")) || 0,
			yTmax: maxOf(vals(yHours, "temperature_2m")),
			yTmin: minOf(vals(yHours, "temperature_2m")),
			yWindMax: maxOf(vals(yHours, "wind_speed_10m")),
			todayTmax: maxOf(vals(todayHours, "temperature_2m")),
			todayTmin: minOf(vals(todayHours, "temperature_2m")),
			todayRain: sumOf(vals(todayHours, "precipitation")) || 0,
			next24Rain: sumOf(vals(next24, "precipitation")) || 0,
			next24Prob: maxOf(vals(next24, "precipitation_probability")) || 0,
			next3Rain: sumOf(vals(next72, "precipitation")) || 0,
			frostMinC: minOf(next4.map((d) => d.tmin)),
			heatMaxC: maxOf(next4.map((d) => d.tmax)),
			apparentMaxC: maxOf(next4.map((d) => d.appMax)),
			dewMinC: minOf(vals(next72, "dew_point_2m")),
			diseaseHours: last48.filter((r) => r.relative_humidity_2m >= 90 && r.temperature_2m >= 15 && r.temperature_2m <= 28).length,
			vpdMaxKpa: maxOf(vals(next48, "vapour_pressure_deficit")),
			capeMax: maxOf(vals(next48, "cape")),
			gustMax: maxOf(vals(next72, "wind_gusts_10m")),
			uvMax: maxOf(next24.map((d) => d.uv_index)) || maxOf(forecastDays.slice(0, 2).map((d) => d.uv)),
			soilMoisture: now.soilM39 != null ? now.soilM39 : now.soilM01,
			soilTemp: now.soilT6,
			pm25: air ? air.now.pm25 : null,
			sprayWindows: sprayWindows(next48, tz)
		};

		/* ── vertical profile ── */
		let profile = [];
		if (pl && pl.hourly) {
			const idx = nearestIndex(pl.hourly.time, nowSec);
			profile = PL_LEVELS.map((hpa) => ({
				hPa: hpa,
				speed: pl.hourly["wind_speed_" + hpa + "hPa"] ? pl.hourly["wind_speed_" + hpa + "hPa"][idx] : null,
				dir: pl.hourly["wind_direction_" + hpa + "hPa"] ? pl.hourly["wind_direction_" + hpa + "hPa"][idx] : null,
				tempC: pl.hourly["temperature_" + hpa + "hPa"] ? pl.hourly["temperature_" + hpa + "hPa"][idx] : null
			})).filter((l) => l.speed != null || l.tempC != null).reverse();
		}

		return {
			latitude: core.latitude,
			longitude: core.longitude,
			elevation: core.elevation,
			timezone: tz,
			utcOffset: core.utc_offset_seconds,
			hours: hours,
			days: days,
			daily: forecastDays,
			now: now,
			agg: agg,
			profile: profile,
			air: air,
			marine: marine,
			history: history
		};
	}

	/* ══════════════════════════════════════
	   AI DIGEST
	══════════════════════════════════════ */
	function digest(w) {
		if (!w) return null;
		const n = w.now, a = w.agg;
		const r1 = (v) => U.round(v, 1);
		const r2 = (v) => U.round(v, 2);
		return {
			timezone: w.timezone,
			elevationM: U.round(w.elevation, 0),
			localTime: U.fmtTime(Date.now(), w.timezone),
			weather: {
				current: {
					tempC: r1(n.tempC), feelsC: r1(n.feelsC), rhPct: U.round(n.rh, 0), dewC: r1(n.dewC),
					windKph: r1(n.windKph), windDir: U.compass(n.windDir), gustKph: r1(n.gustKph),
					rain24hMm: r1(a.rain24), cloudPct: U.round(n.cloud, 0), pressureHpa: U.round(n.pressure, 0),
					uv: r1(n.uv), visKm: n.visM != null ? r1(n.visM / 1000) : null
				},
				yesterday: {
					tmaxC: r1(a.yTmax), tminC: r1(a.yTmin), rainMm: r1(a.yRain),
					et0Mm: r1(a.yEt0), windMaxKph: r1(a.yWindMax)
				},
				last7: {
					rainMm: r1(a.rain7d), et0Mm: r1(a.et0_7d), waterBalanceMm: r1(a.waterBalanceMm),
					gddBase10: r1(a.gdd7), soilMoisture: r2(a.soilMoisture), soilTempC: r1(a.soilTemp)
				},
				forecast: w.daily.slice(0, 4).map((d) => ({
					date: d.dateLabel, tmaxC: r1(d.tmax), tminC: r1(d.tmin),
					rainMm: r1(d.rain), rainPct: U.round(d.prob, 0), gustKph: r1(d.gust), uvMax: r1(d.uv)
				}))
			},
			agronomy: {
				waterBalanceMm: r1(a.waterBalanceMm),
				et0_7d: r1(a.et0_7d),
				precip_7d: r1(a.rain7d),
				frostMinC: r1(a.frostMinC),
				dewMinC: r1(a.dewMinC),
				heatMaxC: r1(a.heatMaxC),
				apparentMaxC: r1(a.apparentMaxC),
				diseaseHours: a.diseaseHours,
				vpdMaxKpa: r1(a.vpdMaxKpa),
				capeMax: U.round(a.capeMax, 0),
				gustMax: r1(a.gustMax),
				gdd7: r1(a.gdd7),
				pm25: r1(a.pm25),
				sprayWindows: a.sprayWindows.map((x) => ({ when: x.label, windKph: x.speed, dir: x.dir, rainPct: x.rain })),
				imageryClouds: null
			}
		};
	}

	/* ══════════════════════════════════════
	   LIGHTWEIGHT SCENE LOAD (3D page)
	══════════════════════════════════════ */
	async function loadScene(opts) {
		const data = await getJSON(buildUrl(API, {
			latitude: opts.lat,
			longitude: opts.lon,
			timezone: "auto",
			timeformat: "unixtime",
			wind_speed_unit: "kmh",
			forecast_days: 2,
			current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cape,boundary_layer_height,shortwave_radiation",
			hourly: "wind_speed_120m,wind_direction_120m,visibility,cloud_cover,precipitation",
			daily: "sunrise,sunset,daylight_duration"
		}), opts.signal);

		const cur = data.current || {};
		const hours = data.hourly || {};
		const days = data.daily || {};
		const nowSec = Math.floor(Date.now() / 1000);
		const idx = hours.time && hours.time.length ? nearestIndex(hours.time, nowSec) : -1;
		const at = (k) => (idx >= 0 && hours[k] ? hours[k][idx] : null);
		const offset = data.utc_offset_seconds || 0;
		const info = codeInfo(cur.weather_code);

		return {
			timezone: data.timezone || "UTC",
			offset: offset,
			localHour: ((nowSec + offset) % 86400) / 3600,
			sunrise: days.sunrise && days.sunrise.length ? toMs(days.sunrise[0]) : null,
			sunset: days.sunset && days.sunset.length ? toMs(days.sunset[0]) : null,
			wind120: { speed: at("wind_speed_120m"), dir: at("wind_direction_120m") },
			now: {
				tempC: cur.temperature_2m,
				feelsC: cur.apparent_temperature,
				rh: cur.relative_humidity_2m,
				precip: cur.precipitation,
				rain: cur.rain,
				snow: cur.snowfall,
				code: cur.weather_code,
				icon: info.icon,
				label: info.label,
				cloud: cur.cloud_cover,
				cloudLow: cur.cloud_cover_low,
				cloudMid: cur.cloud_cover_mid,
				cloudHigh: cur.cloud_cover_high,
				pressure: cur.pressure_msl,
				windKph: cur.wind_speed_10m,
				windDir: cur.wind_direction_10m,
				gustKph: cur.wind_gusts_10m,
				visibilityM: cur.visibility != null ? cur.visibility : at("visibility"),
				cape: cur.cape,
				blM: cur.boundary_layer_height,
				radiation: cur.shortwave_radiation,
				isDay: cur.is_day === 1
			}
		};
	}

	return { load: load, loadScene: loadScene, digest: digest, codeInfo: codeInfo };
})();
