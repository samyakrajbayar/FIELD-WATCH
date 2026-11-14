/* ════════════════════════════════════════
   FIELD//WATCH — 3D field engine
   Real elevation (Open-Meteo) + Sentinel-2 skin + live weather layers
═══════════════════════════════════════ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const BOX = 0.03;
const GRID = 12;
const SPAN = 12;
const UP = new THREE.Vector3(0, 1, 0);

const settings = {
	exag: 1,
	skin: true,
	wind: true,
	density: 900,
	windSpeed: 1,
	arrows: true,
	clouds: true,
	cloudCover: 45,
	hour: 12,
	rays: true,
	fog: true,
	rain: true,
	snow: true,
	rotate: false
};
const auto = { cloudCover: true, hour: true };

const state = {
	place: null,
	wx: null,
	elev: null,
	synthetic: false,
	skin: null,
	skinInfo: null,
	min: 0,
	max: 0,
	widthKm: 6.6,
	heightKm: 6.6,
	spanX: SPAN,
	spanZ: SPAN,
	baseVScale: 0,
	metersPerUnit: 550,
	maxY: 1.5,
	ready: false
};

let renderer, scene, camera, controls, clock;
let world, terrain, terrainMat, sky, skyUniforms, sunLight, hemi, ambient;
let windPoints = null, windGeo = null;
let arrowMesh = null, arrowTimer = 0;
let cloudDeck = null, cloudMat = null, highDeck = null, highMat = null;
let rain = null, rainPos = null, snow = null, snowPos = null;
let sunSprite = null, raysGroup = null;
let searchCtl = null;
let toastTimer = null;
const sunDir = new THREE.Vector3(0, 1, 0);
const ctlEls = {};

/* preallocated colours (no per-frame allocation) */
const C_NIGHT_TOP = new THREE.Color(0x070d18);
const C_DAY_TOP = new THREE.Color(0x5d9dd9);
const C_NIGHT_BOT = new THREE.Color(0x243350);
const C_DAY_BOT = new THREE.Color(0xd9eaf3);
const C_DUSK = new THREE.Color(0xffab6d);
const COL_SUN_LOW = new THREE.Color(0xffb877);
const COL_SUN_HIGH = new THREE.Color(0xfff6df);
const tmpColor = new THREE.Color();
const PALETTE = [
	{ t: 0.0, c: new THREE.Color(0x39612f) },
	{ t: 0.3, c: new THREE.Color(0x64863c) },
	{ t: 0.55, c: new THREE.Color(0x999550) },
	{ t: 0.75, c: new THREE.Color(0x9f8a6a) },
	{ t: 0.9, c: new THREE.Color(0xb7b0a2) },
	{ t: 1.0, c: new THREE.Color(0xefeee8) }
];

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function toast(msg, isError) {
	const el = $("toast");
	if (!el) return;
	$("toast-text").textContent = msg;
	el.classList.toggle("error", !!isError);
	el.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3400);
}

function hhmm(v) {
	const h = Math.floor(((v % 24) + 24) % 24);
	const m = Math.round((v - Math.floor(v)) * 60);
	return String(h).padStart(2, "0") + ":" + String(Math.min(59, m)).padStart(2, "0");
}

function sampleGrid(grid, u, v) {
	const n = grid.length;
	const fx = clamp(u, 0, 1) * (n - 1);
	const fz = clamp(v, 0, 1) * (n - 1);
	const x0 = Math.floor(fx);
	const z0 = Math.floor(fz);
	const x1 = Math.min(n - 1, x0 + 1);
	const z1 = Math.min(n - 1, z0 + 1);
	const tx = fx - x0;
	const tz = fz - z0;
	const a = grid[z0][x0];
	const b = grid[z0][x1];
	const c = grid[z1][x0];
	const d = grid[z1][x1];
	return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

function terrainColor(target, dMeters, relief) {
	const t = clamp(dMeters / Math.max(relief, 120), 0, 1);
	target.copy(PALETTE[0].c);
	for (let i = 1; i < PALETTE.length; i++) {
		if (t <= PALETTE[i].t) {
			const f = (t - PALETTE[i - 1].t) / (PALETTE[i].t - PALETTE[i - 1].t);
			target.copy(PALETTE[i - 1].c).lerp(PALETTE[i].c, clamp(f, 0, 1));
			return target;
		}
		target.copy(PALETTE[i].c);
	}
	return target;
}

function heightAt(x, z) {
	if (!state.elev) return 0;
	const u = x / state.spanX + 0.5;
	const v = z / state.spanZ + 0.5;
	const h = sampleGrid(state.elev.grid, u, v);
	return (h - state.min) * state.baseVScale * settings.exag;
}

function radialTexture(inner, outer, size) {
	const s = size || 128;
	const c = document.createElement("canvas");
	c.width = c.height = s;
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	grad.addColorStop(0, inner);
	grad.addColorStop(0.45, inner);
	grad.addColorStop(1, outer);
	g.fillStyle = grad;
	g.fillRect(0, 0, s, s);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function cloudTexture() {
	const s = 256;
	const c = document.createElement("canvas");
	c.width = c.height = s;
	const g = c.getContext("2d");
	for (let i = 0; i < 26; i++) {
		const x = s / 2 + (Math.random() - 0.5) * s * 0.55;
		const y = s / 2 + (Math.random() - 0.5) * s * 0.4;
		const r = s * (0.1 + Math.random() * 0.2);
		const grad = g.createRadialGradient(x, y, 0, x, y, r);
		grad.addColorStop(0, "rgba(255,255,255,0.5)");
		grad.addColorStop(0.55, "rgba(255,255,255,0.2)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.arc(x, y, r, 0, Math.PI * 2);
		g.fill();
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function dotTexture() {
	return radialTexture("rgba(255,255,255,0.95)", "rgba(255,255,255,0)");
}

function windFlow() {
	const w = state.wx;
	const speed = w && w.now.windKph != null ? w.now.windKph : 12;
	const dir = w && w.now.windDir != null ? w.now.windDir : 0;
	const th = dir * RAD;
	const mag = Math.max(0.16, speed * 0.024) * settings.windSpeed;
	return { x: -Math.sin(th), z: Math.cos(th), mag: mag, speed: speed, dir: dir };
}

function solar(lat, lon, hour) {
	const now = new Date();
	const start = Date.UTC(now.getUTCFullYear(), 0, 0);
	const doy = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
	const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * RAD;
	const H = (hour - 12) * 15 * RAD;
	const phi = lat * RAD;
	const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
	const el = Math.asin(clamp(sinEl, -1, 1));
	const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
	const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
	return { el: el, az: az, dir: dir };
}

/* ══════════════════════════════════════
   BASE SCENE
══════════════════════════════════════ */
function initScene() {
	const canvas = $("scene-canvas");
	renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.setClearColor(0x0b1219, 1);

	scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0xcfe0ec, 0.008);

	camera = new THREE.PerspectiveCamera(46, 1, 0.1, 320);
	camera.position.set(10, 8.5, 14);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.075;
	controls.minDistance = 4;
	controls.maxDistance = 44;
	controls.maxPolarAngle = Math.PI * 0.495;
	controls.autoRotateSpeed = 0.7;
	controls.target.set(0, 0.9, 0);

	clock = new THREE.Clock();

	hemi = new THREE.HemisphereLight(0xdcefff, 0x38472d, 0.7);
	scene.add(hemi);

	sunLight = new THREE.DirectionalLight(0xfff2cf, 1.3);
	sunLight.position.set(18, 30, 10);
	scene.add(sunLight);

	ambient = new THREE.AmbientLight(0xffffff, 0.22);
	scene.add(ambient);

	world = new THREE.Group();
	scene.add(world);

	skyUniforms = {
		topColor: { value: new THREE.Color(0x5d9dd9) },
		bottomColor: { value: new THREE.Color(0xd9eaf3) },
		sunColor: { value: new THREE.Color(0xfff1c4) },
		sunDir: { value: sunDir }
	};
	const skyMat = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		uniforms: skyUniforms,
		vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
		fragmentShader: [
			"uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunColor; uniform vec3 sunDir;",
			"varying vec3 vDir;",
			"void main(){",
			"  vec3 d = normalize(vDir);",
			"  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);",
			"  vec3 col = mix(bottomColor, topColor, pow(h, 0.85));",
			"  float s = max(dot(d, normalize(sunDir)), 0.0);",
			"  col += sunColor * (pow(s, 260.0) * 1.35 + pow(s, 12.0) * 0.16);",
			"  gl_FragColor = vec4(col, 1.0);",
			"}"
		].join("\n")
	});
	sky = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 16), skyMat);
	scene.add(sky);

	sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
		map: radialTexture("rgba(255,244,205,1)", "rgba(255,214,130,0)"),
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		depthTest: true
	}));
	sunSprite.scale.set(9, 9, 1);
	scene.add(sunSprite);

	raysGroup = new THREE.Group();
	const verts = [];
	for (let i = 0; i < 26; i++) {
		const a = Math.random() * Math.PI * 2;
		const r = Math.random() * SPAN * 0.42;
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		verts.push(x, 0.05, z);
		verts.push(x + (Math.random() - 0.5) * 2.4, 32, z + (Math.random() - 0.5) * 2.4);
	}
	const rayGeo = new THREE.BufferGeometry();
	rayGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
	const rayMat = new THREE.LineBasicMaterial({
		color: 0xffe9a8,
		transparent: true,
		opacity: 0.14,
		blending: THREE.AdditiveBlending,
		depthWrite: false
	});
	raysGroup.add(new THREE.LineSegments(rayGeo, rayMat));
	scene.add(raysGroup);

	buildWind();
	buildClouds();
	buildRain();
	buildSnow();

	new ResizeObserver(resize).observe($("stage"));
	resize();
	updateSun();
}

function resize() {
	const stage = $("stage");
	if (!stage || !renderer) return;
	const w = stage.clientWidth;
	const h = stage.clientHeight;
	if (!w || !h) return;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

/* ══════════════════════════════════════
   TERRAIN
══════════════════════════════════════ */
async function fetchElevation(place) {
	const N = GRID;
	const north = place.lat + BOX;
	const south = place.lat - BOX;
	const west = place.lon - BOX;
	const east = place.lon + BOX;
	const lats = [];
	const lons = [];
	for (let r = 0; r < N; r++) {
		const la = north - (north - south) * (r / (N - 1));
		for (let c = 0; c < N; c++) {
			const lo = west + (east - west) * (c / (N - 1));
			lats.push(la.toFixed(5));
			lons.push(lo.toFixed(5));
		}
	}
	const values = [];
	for (let i = 0; i < lats.length; i += 100) {
		const u = new URL("https://api.open-meteo.com/v1/elevation");
		u.searchParams.set("latitude", lats.slice(i, i + 100).join(","));
		u.searchParams.set("longitude", lons.slice(i, i + 100).join(","));
		const res = await fetch(u.toString());
		if (!res.ok) throw new Error("Elevation HTTP " + res.status);
		const d = await res.json();
		if (!d || !Array.isArray(d.elevation)) throw new Error("Elevation response malformed");
		d.elevation.forEach(function (v) {
			values.push(v == null || !isFinite(v) ? 0 : Number(v));
		});
	}
	if (values.length !== N * N) throw new Error("Elevation grid incomplete");

	const grid = [];
	let min = Infinity;
	let max = -Infinity;
	for (let r = 0; r < N; r++) {
		const row = [];
		for (let c = 0; c < N; c++) {
			const v = values[r * N + c];
			row.push(v);
			if (v < min) min = v;
			if (v > max) max = v;
		}
		grid.push(row);
	}
	const widthKm = (east - west) * 111.32 * Math.cos(place.lat * RAD);
	const heightKm = (north - south) * 110.57;
	return {
		grid: grid,
		min: min,
		max: max,
		widthKm: widthKm,
		heightKm: heightKm,
		west: west,
		east: east,
		south: south,
		north: north,
		n: N
	};
}

function syntheticTerrain() {
	const grid = [];
	for (let r = 0; r < GRID; r++) {
		const row = [];
		for (let c = 0; c < GRID; c++) {
			row.push(120 + Math.sin(r * 0.85) * 14 + Math.cos(c * 0.7) * 10 + Math.sin((r + c) * 0.5) * 6);
		}
		grid.push(row);
	}
	state.synthetic = true;
	return { grid: grid, min: 88, max: 152, widthKm: 6.6, heightKm: 6.6, n: GRID };
}

function buildTerrain(data) {
	state.elev = data;
	state.min = data.min;
	state.max = data.max;
	state.widthKm = data.widthKm;
	state.heightKm = data.heightKm;

	state.spanX = SPAN;
	state.spanZ = SPAN * (data.heightKm / data.widthKm);
	state.baseVScale = 1.5 / Math.max(1, data.max - data.min);
	state.metersPerUnit = (data.widthKm * 1000) / SPAN;
	state.maxY = (data.max - data.min) * state.baseVScale * settings.exag;

	if (terrain) {
		world.remove(terrain);
		terrain.geometry.dispose();
		terrain.material.dispose();
		terrain = null;
	}

	const geo = new THREE.PlaneGeometry(SPAN, state.spanZ, 96, 96);
	geo.rotateX(-Math.PI / 2);
	const pos = geo.attributes.position;
	const baseY = new Float32Array(pos.count);
	const colors = new Float32Array(pos.count * 3);
	const col = new THREE.Color();
	const relief = Math.max(1, data.max - data.min);

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const u = x / SPAN + 0.5;
		const v = z / state.spanZ + 0.5;
		const h = sampleGrid(data.grid, u, v);
		const dMeters = h - data.min;
		pos.setY(i, dMeters * state.baseVScale * settings.exag);
		baseY[i] = dMeters * state.baseVScale;
		terrainColor(col, dMeters, relief);
		colors[i * 3] = col.r;
		colors[i * 3 + 1] = col.g;
		colors[i * 3 + 2] = col.b;
	}
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geo.computeVertexNormals();

	terrainMat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.95,
		metalness: 0.0
	});
	terrain = new THREE.Mesh(geo, terrainMat);
	terrain.userData.baseY = baseY;
	world.add(terrain);

	world.updateMatrixWorld(true);
	buildWind();
	buildArrows();
	applySettings();
	positionWeatherLayers();
	resetView();
	updateHUD();
	renderStats();
}

function rescaleTerrain() {
	if (!terrain) return;
	const pos = terrain.geometry.attributes.position;
	const base = terrain.userData.baseY;
	for (let i = 0; i < pos.count; i++) pos.setY(i, base[i] * settings.exag);
	pos.needsUpdate = true;
	terrain.geometry.computeVertexNormals();
	terrain.geometry.computeBoundingSphere();
	state.maxY = (state.max - state.min) * state.baseVScale * settings.exag;
	positionWeatherLayers();
	updateArrows();
	renderStats();
}

function positionWeatherLayers() {
	const top = Math.max(1.2, state.maxY + 0.8);
	if (cloudDeck) cloudDeck.position.y = top;
	if (highDeck) highDeck.position.y = top + 1.6;
	if (raysGroup) raysGroup.position.y = 0;
}

/* ══════════════════════════════════════
   WIND
══════════════════════════════════════ */
function buildWind() {
	if (windPoints) {
		world.remove(windPoints);
		windPoints.geometry.dispose();
		windPoints.material.dispose();
		windPoints = null;
	}
	const n = Math.max(100, Math.round(settings.density));
	const posAttr = new Float32Array(n * 3);
	const colAttr = new Float32Array(n * 3);
	const c = new THREE.Color();
	const topY = Math.max(2.4, state.maxY + 1.6);
	for (let i = 0; i < n; i++) {
		posAttr[i * 3] = (Math.random() - 0.5) * state.spanX * 1.1;
		posAttr[i * 3 + 1] = 0.12 + Math.random() * topY;
		posAttr[i * 3 + 2] = (Math.random() - 0.5) * state.spanZ * 1.1;
		c.set(0xc6f24e).lerp(new THREE.Color(0x14d6c4), Math.random());
		colAttr[i * 3] = c.r;
		colAttr[i * 3 + 1] = c.g;
		colAttr[i * 3 + 2] = c.b;
	}
	windGeo = new THREE.BufferGeometry();
	windGeo.setAttribute("position", new THREE.BufferAttribute(posAttr, 3));
	windGeo.setAttribute("color", new THREE.BufferAttribute(colAttr, 3));
	const mat = new THREE.PointsMaterial({
		size: 0.08,
		map: dotTexture(),
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		vertexColors: true,
		opacity: 0.9,
		sizeAttenuation: true
	});
	windPoints = new THREE.Points(windGeo, mat);
	windPoints.visible = settings.wind;
	world.add(windPoints);
}

function updateWind(dt) {
	if (!windPoints || !settings.wind) return;
	const flow = windFlow();
	const arr = windGeo.attributes.position.array;
	const n = arr.length / 3;
	const hx = state.spanX * 0.55;
	const hz = state.spanZ * 0.55;
	const t = performance.now() * 0.001;
	for (let i = 0; i < n; i++) {
		arr[i * 3] += flow.x * flow.mag * dt;
		arr[i * 3 + 2] += flow.z * flow.mag * dt;
		arr[i * 3 + 1] += Math.sin(t * 1.3 + i) * 0.0015;
		if (arr[i * 3] > hx) arr[i * 3] = -hx;
		else if (arr[i * 3] < -hx) arr[i * 3] = hx;
		if (arr[i * 3 + 2] > hz) arr[i * 3 + 2] = -hz;
		else if (arr[i * 3 + 2] < -hz) arr[i * 3 + 2] = hz;
	}
	windGeo.attributes.position.needsUpdate = true;
}

function buildArrows() {
	if (arrowMesh) {
		world.remove(arrowMesh);
		arrowMesh.geometry.dispose();
		arrowMesh.material.dispose();
		arrowMesh = null;
	}
	const geo = new THREE.ConeGeometry(0.055, 0.26, 5);
	geo.translate(0, 0.13, 0);
	const mat = new THREE.MeshStandardMaterial({
		color: 0x0c1a13,
		emissive: 0x14d6c4,
		emissiveIntensity: 0.55,
		roughness: 0.7
	});
	arrowMesh = new THREE.InstancedMesh(geo, mat, 49);
	arrowMesh.visible = settings.arrows;
	world.add(arrowMesh);
	updateArrows();
}

function updateArrows() {
	if (!arrowMesh) return;
	const flow = windFlow();
	const dir = new THREE.Vector3(flow.x, 0, flow.z);
	if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
	dir.normalize();
	const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
	const m = new THREE.Matrix4();
	const pos = new THREE.Vector3();
	const scaleV = new THREE.Vector3();
	const scale = 0.7 + Math.min(2.0, flow.speed / 22);
	let i = 0;
	for (let r = 0; r < 7; r++) {
		for (let c = 0; c < 7; c++) {
			const x = (c / 6 - 0.5) * state.spanX * 0.84;
			const z = (r / 6 - 0.5) * state.spanZ * 0.84;
			pos.set(x, heightAt(x, z) + 0.04, z);
			scaleV.set(scale, scale, scale);
			m.compose(pos, q, scaleV);
			arrowMesh.setMatrixAt(i++, m);
		}
	}
	arrowMesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════
   CLOUDS
══════════════════════════════════════ */
function buildClouds() {
	if (cloudDeck) {
		world.remove(cloudDeck);
		cloudMat.dispose();
		cloudDeck = null;
	}
	if (highDeck) {
		world.remove(highDeck);
		highMat.dispose();
		highDeck = null;
	}

	cloudMat = new THREE.SpriteMaterial({
		map: cloudTexture(),
		transparent: true,
		opacity: 0.4,
		depthWrite: false,
		color: 0xffffff
	});
	cloudDeck = new THREE.Group();
	for (let i = 0; i < 46; i++) {
		const sprite = new THREE.Sprite(cloudMat);
		const s = 2.4 + Math.random() * 4.0;
		sprite.scale.set(s, s * 0.6, 1);
		sprite.position.set(
			(Math.random() - 0.5) * state.spanX * 1.7,
			Math.random() * 0.9,
			(Math.random() - 0.5) * state.spanZ * 1.7
		);
		cloudDeck.add(sprite);
	}
	world.add(cloudDeck);

	highMat = new THREE.SpriteMaterial({
		map: cloudTexture(),
		transparent: true,
		opacity: 0.12,
		depthWrite: false,
		color: 0xffffff
	});
	highDeck = new THREE.Group();
	for (let i = 0; i < 14; i++) {
		const sprite = new THREE.Sprite(highMat);
		const s = 7 + Math.random() * 6;
		sprite.scale.set(s, s * 0.28, 1);
		sprite.position.set(
			(Math.random() - 0.5) * state.spanX * 2.1,
			Math.random() * 0.5,
			(Math.random() - 0.5) * state.spanZ * 2.1
		);
		highDeck.add(sprite);
	}
	world.add(highDeck);
	positionWeatherLayers();
}

function updateClouds(dt) {
	if (!cloudDeck && !highDeck) return;
	const flow = windFlow();
	const move = flow.mag * dt * 2.6;
	const wrap = function (group, hx, hz) {
		if (!group) return;
		group.children.forEach(function (s) {
			s.position.x += flow.x * move;
			s.position.z += flow.z * move;
			if (s.position.x > hx) s.position.x = -hx;
			else if (s.position.x < -hx) s.position.x = hx;
			if (s.position.z > hz) s.position.z = -hz;
			else if (s.position.z < -hz) s.position.z = hz;
		});
	};
	wrap(cloudDeck, state.spanX * 0.85, state.spanZ * 0.85);
	wrap(highDeck, state.spanX * 1.05, state.spanZ * 1.05);
}

/* ══════════════════════════════════════
   PRECIPITATION
══════════════════════════════════════ */
function buildRain() {
	rainPos = new Float32Array(700 * 6);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
	rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
		color: 0xa8d8ff,
		transparent: true,
		opacity: 0.45,
		depthWrite: false
	}));
	rain.visible = false;
	world.add(rain);
	seedRain();
}

function seedRain() {
	if (!rainPos) return;
	const top = Math.max(1.4, state.maxY + 0.9);
	for (let i = 0; i < rainPos.length / 6; i++) {
		const x = (Math.random() - 0.5) * state.spanX;
		const z = (Math.random() - 0.5) * state.spanZ;
		const y = top + Math.random() * 3;
		const len = 0.16 + Math.random() * 0.22;
		rainPos[i * 6] = x;
		rainPos[i * 6 + 1] = y;
		rainPos[i * 6 + 2] = z;
		rainPos[i * 6 + 3] = x + 0.05;
		rainPos[i * 6 + 4] = y - len;
		rainPos[i * 6 + 5] = z;
	}
	rain.geometry.attributes.position.needsUpdate = true;
}

function updateRain(dt) {
	if (!rain || !rain.visible) return;
	const arr = rainPos;
	const fall = 7.5 * dt;
	for (let i = 0; i < arr.length / 6; i++) {
		arr[i * 6 + 1] -= fall;
		arr[i * 6 + 4] -= fall;
		if (arr[i * 6 + 4] < 0) {
			const top = Math.max(1.4, state.maxY + 2);
			const len = arr[i * 6 + 1] - arr[i * 6 + 4];
			arr[i * 6 + 1] = top + Math.random() * 2;
			arr[i * 6 + 4] = arr[i * 6 + 1] - len;
			const x = (Math.random() - 0.5) * state.spanX;
			const z = (Math.random() - 0.5) * state.spanZ;
			arr[i * 6] = x;
			arr[i * 6 + 2] = z;
			arr[i * 6 + 3] = x + 0.05;
			arr[i * 6 + 5] = z;
		}
	}
	rain.geometry.attributes.position.needsUpdate = true;
}

function buildSnow() {
	snowPos = new Float32Array(600 * 3);
	for (let i = 0; i < snowPos.length / 3; i++) {
		snowPos[i * 3] = (Math.random() - 0.5) * state.spanX;
		snowPos[i * 3 + 1] = Math.random() * 4;
		snowPos[i * 3 + 2] = (Math.random() - 0.5) * state.spanZ;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
	snow = new THREE.Points(geo, new THREE.PointsMaterial({
		size: 0.075,
		map: dotTexture(),
		color: 0xffffff,
		transparent: true,
		opacity: 0.85,
		depthWrite: false,
		sizeAttenuation: true
	}));
	snow.visible = false;
	world.add(snow);
}

function updateSnow(dt) {
	if (!snow || !snow.visible) return;
	const arr = snowPos;
	const top = Math.max(1.6, state.maxY + 2.4);
	for (let i = 0; i < arr.length / 3; i++) {
		arr[i * 3 + 1] -= 0.55 * dt;
		arr[i * 3] += Math.sin(performance.now() * 0.001 + i) * 0.002;
		if (arr[i * 3 + 1] < 0) {
			arr[i * 3 + 1] = top + Math.random();
			arr[i * 3] = (Math.random() - 0.5) * state.spanX;
			arr[i * 3 + 2] = (Math.random() - 0.5) * state.spanZ;
		}
	}
	snow.geometry.attributes.position.needsUpdate = true;
}

/* ══════════════════════════════════════
   SUN + SKY
══════════════════════════════════════ */
function updateSun() {
	if (!skyUniforms) return;
	const lat = state.place ? state.place.lat : 0;
	const lon = state.place ? state.place.lon : 0;
	const sol = solar(lat, lon, settings.hour);
	sunDir.copy(sol.dir).normalize();
	skyUniforms.sunDir.value.copy(sunDir);

	const k = clamp((sol.el + 0.12) / 0.42, 0, 1);
	const top = skyUniforms.topColor.value;
	const bottom = skyUniforms.bottomColor.value;
	top.copy(C_NIGHT_TOP).lerp(C_DAY_TOP, k);
	bottom.copy(C_NIGHT_BOT).lerp(C_DAY_BOT, k);

	if (sol.el < 0.18) {
		const dusk = clamp(1 - Math.abs(sol.el) / 0.22, 0, 1);
		bottom.lerp(C_DUSK, dusk * 0.75);
		top.lerp(C_DUSK, dusk * 0.18);
	}

	sunLight.position.copy(sunDir).multiplyScalar(32);
	sunLight.intensity = 0.12 + 1.25 * Math.max(0, Math.sin(sol.el));
	sunLight.color.copy(COL_SUN_LOW).lerp(COL_SUN_HIGH, clamp(Math.sin(sol.el) * 2.2, 0, 1));
	hemi.intensity = 0.3 + 0.5 * k;
	ambient.intensity = 0.12 + 0.28 * k;

	if (sunSprite) {
		sunSprite.position.copy(sunDir).multiplyScalar(48);
		sunSprite.material.opacity = sol.el > -0.03 ? 0.95 : 0;
		sunSprite.visible = sunSprite.material.opacity > 0;
	}

	if (raysGroup) {
		raysGroup.quaternion.setFromUnitVectors(UP, sunDir);
		raysGroup.visible = settings.rays && sol.el > 0.04;
	}

	if (settings.fog && scene) {
		const visKm = state.wx && state.wx.now.visibilityM != null ? state.wx.now.visibilityM / 1000 : 14;
		const density = clamp(0.0025 + (1 - clamp(visKm / 28, 0, 1)) * 0.018, 0.0025, 0.024);
		if (scene.fog) {
			scene.fog.density = density;
			scene.fog.color.copy(bottom);
		}
	}
}

/* ══════════════════════════════════════
   MATERIALS / APPLY
══════════════════════════════════════ */
function applySkinToMaterial() {
	if (!terrainMat) return;
	if (settings.skin && state.skin) {
		terrainMat.map = state.skin;
		terrainMat.vertexColors = false;
		terrainMat.color.set(0xffffff);
	} else {
		terrainMat.map = null;
		terrainMat.vertexColors = true;
		terrainMat.color.set(0xffffff);
	}
	terrainMat.needsUpdate = true;
}

function applySettings() {
	applySkinToMaterial();

	if (windPoints) windPoints.visible = settings.wind;
	if (arrowMesh) arrowMesh.visible = settings.arrows;

	const cover = clamp(settings.cloudCover / 100, 0, 1);
	if (cloudDeck && cloudMat) {
		cloudDeck.visible = settings.clouds && cover > 0.02;
		cloudMat.opacity = 0.1 + 0.32 * cover;
	}
	if (highDeck && highMat) {
		highDeck.visible = settings.clouds && cover > 0.05;
		highMat.opacity = 0.03 + 0.1 * cover;
	}

	const w = state.wx;
	const precip = w && w.now.precip != null ? w.now.precip : 0;
	const tempC = w && w.now.tempC != null ? w.now.tempC : 20;
	const snowfall = w && w.now.snow != null ? w.now.snow : 0;

	if (rain) {
		rain.visible = settings.rain && precip > 0.05 && tempC > 1;
		rain.material.opacity = clamp(0.2 + precip / 12, 0.2, 0.65);
	}
	if (snow) {
		snow.visible = settings.snow && (snowfall > 0 || (tempC <= 1 && precip > 0.05));
	}

	scene.fog = settings.fog ? new THREE.FogExp2(0xdfeaf2, 0.008) : null;

	controls.autoRotate = settings.rotate;
	updateSun();
	updateHUD();
	renderStats();
}

/* ══════════════════════════════════════
   WEATHER / SKIN
══════════════════════════════════════ */
async function loadWeather(place) {
	try {
		const w = await WX.loadScene({ lat: place.lat, lon: place.lon });
		if (state.place !== place) return;
		state.wx = w;
		if (auto.cloudCover) settings.cloudCover = w.now.cloud != null ? w.now.cloud : 45;
		if (auto.hour) settings.hour = w.localHour;
		syncControls();
		applySettings();
	} catch (e) {
		toast("WEATHER: " + e.message, true);
	}
}

function loadTexture(url) {
	return new Promise(function (resolve, reject) {
		const loader = new THREE.TextureLoader();
		loader.setCrossOrigin("anonymous");
		loader.load(url, function (tex) {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
			resolve(tex);
		}, undefined, function () {
			reject(new Error("Texture failed"));
		});
	});
}

async function loadSkin(place) {
	try {
		const res = await IMAGERY.search({ lat: place.lat, lon: place.lon, days: 7 });
		if (state.place !== place) return;
		const scenes = res.scenes.slice().sort(function (a, b) {
			return (a.cloud == null ? 999 : a.cloud) - (b.cloud == null ? 999 : b.cloud);
		});
		if (!scenes.length) return;
		const scene = scenes[0];
		const tex = await loadTexture(scene.preview);
		if (state.place !== place) {
			tex.dispose();
			return;
		}
		if (state.skin) state.skin.dispose();
		state.skin = tex;
		state.skinInfo = { satellite: scene.satellite, cloud: scene.cloud, time: scene.time };
		applySettings();
	} catch (e) {
		/* procedural terrain fallback */
	}
}

/* ══════════════════════════════════════
   LOAD PLACE
══════════════════════════════════════ */
function showLoading(title, sub) {
	const el = $("stage-loading");
	el.classList.remove("hidden");
	el.innerHTML = '<div><div class="stage-loading-title">' + title + "</div><p>" + sub + "</p></div>";
}

function hideLoading() {
	$("stage-loading").classList.add("hidden");
}

function updateURL(place) {
	try {
		const url = "./scene.html?lat=" + place.lat.toFixed(5) + "&lon=" + place.lon.toFixed(5) +
			"&name=" + encodeURIComponent(place.short || place.label);
		history.replaceState(null, "", url);
	} catch (e) { /* file:// */ }
}

async function loadPlace(place) {
	if (!place) return;
	state.place = place;
	state.synthetic = false;
	if (searchCtl) searchCtl.setPlace(place);
	updateURL(place);
	updateHUD();
	showLoading("BUILDING 3D FIELD…", "Fetching real elevation for " + U.esc(place.short) + " and live weather.");

	let elev = null;
	try {
		elev = await fetchElevation(place);
	} catch (e) {
		elev = syntheticTerrain();
		toast("ELEVATION UNAVAILABLE — USING SYNTHETIC RELIEF", true);
	}

	buildTerrain(elev);
	hideLoading();
	state.ready = true;
	loadWeather(place);
	loadSkin(place);
	renderStats();
}

/* ══════════════════════════════════════
   CAMERA
══════════════════════════════════════ */
function resetView() {
	if (!state.elev) return;
	camera.position.set(state.spanX * 0.85, Math.max(7, state.maxY + 6.5), state.spanZ * 1.05);
	controls.target.set(0, Math.max(0.5, state.maxY * 0.5), 0);
	controls.update();
}

/* ══════════════════════════════════════
   HUD + STATS
══════════════════════════════════════ */
function updateHUD() {
	const p = state.place;
	const w = state.wx;
	const hud = $("stage-hud");
	const right = $("stage-hud-right");

	if (!p) {
		hud.innerHTML = "";
		right.innerHTML = "";
		$("scene-live").textContent = "LIVE WEATHER · —";
		return;
	}

	hud.innerHTML =
		'<span class="hud-chip hud-primary">' + U.esc(p.short) + "</span>" +
		'<span class="hud-chip">' + p.lat.toFixed(4) + " / " + p.lon.toFixed(4) + "</span>";

	const chips = [];
	if (w) {
		chips.push('<span class="hud-chip">' + U.num(w.now.tempC, 1) + "°C · " + U.esc((w.now.label || "").toUpperCase()) + "</span>");
		chips.push('<span class="hud-chip">WIND ' + U.num(w.now.windKph, 0) + " KM/H " + U.compass(w.now.windDir) + "</span>");
		chips.push('<span class="hud-chip">CLOUD ' + U.num(w.now.cloud, 0) + "%</span>");
		if (w.now.precip > 0.05) chips.push('<span class="hud-chip">RAIN ' + U.num(w.now.precip, 1) + " MM/H</span>");
		chips.push('<span class="hud-chip hud-live">● LIVE ' + U.fmtHM(Date.now(), w.timezone) + "</span>");
	} else {
		chips.push('<span class="hud-chip hud-live">● LOADING WEATHER…</span>');
	}
	right.innerHTML = chips.join("");

	$("scene-live").textContent = w
		? "LIVE WEATHER · " + w.timezone.replace(/_/g, " ") + " · UPDATED " + U.fmtHM(Date.now(), w.timezone)
		: "LIVE WEATHER · LOADING";
}

function statCard(k, v, sub) {
	return '<div class="stat-card"><span class="sc-k">' + k + "</span><span class=\"sc-v\">" + v + "</span><span class=\"sc-s\">" + sub + "</span></div>";
}

function renderStats() {
	const el = $("scene-stats");
	if (!el) return;
	const p = state.place;
	const w = state.wx;
	const e = state.elev;

	if (!p) {
		el.innerHTML = statCard("TERRAIN", "—", "search a place") +
			statCard("WIND", "—", "live model") +
			statCard("CLOUD", "—", "live model") +
			statCard("SUN", "—", "live model");
		return;
	}

	const relief = e ? Math.round(e.max - e.min) : 0;
	const exagTrue = state.metersPerUnit ? state.baseVScale * state.metersPerUnit * settings.exag : 0;
	const cell = e ? Math.round((e.widthKm * 1000) / (GRID - 1)) : 0;
	const sol = solar(p.lat, p.lon, settings.hour);

	const cards = [
		statCard("TERRAIN",
			"<span>" + U.num(e ? e.min : null, 0) + "–" + U.num(e ? e.max : null, 0) + " m</span>",
			(state.synthetic ? "SYNTHETIC · " : "REAL ELEVATION · ") + "GRID " + GRID + "×" + GRID + " · ~" + cell + " M"),
		statCard("VERTICAL EXAGGERATION",
			"×" + U.num(exagTrue, 1),
			"REL " + relief + " M · SCALED FOR READING"),
		statCard("WIND 10 / 120 M",
			(w ? U.num(w.now.windKph, 0) + " / " + U.num(w.wind120.speed, 0) : "—") + " <span style=\"font-size:11px\">KM/H</span>",
			w ? U.compass(w.now.windDir) + " · GUSTS " + U.num(w.now.gustKph, 0) + " KM/H" : "LOADING"),
		statCard("CLOUD / BOUNDARY LAYER",
			(w ? U.num(w.now.cloud, 0) + "%" : "—"),
			(w ? "BL " + U.num(w.now.blM, 0) + " M · LOW " + U.num(w.now.cloudLow, 0) + "%" : "LOADING")),
		statCard("SUN",
			"EL " + U.num(sol.el / RAD, 0) + "° · AZ " + U.num(sol.az / RAD, 0) + "°",
			w && w.sunrise != null ? "RISE " + U.fmtHM(w.sunrise, w.timezone) + " · SET " + U.fmtHM(w.sunset, w.timezone) : "SOLAR POSITION"),
		statCard("SKIN",
			state.skinInfo ? "SENTINEL-2" : "PROCEDURAL",
			state.skinInfo
				? U.esc(state.skinInfo.satellite) + " · " + U.num(state.skinInfo.cloud, 0) + "% CLOUD · " + U.fmtDay(state.skinInfo.time, w ? w.timezone : undefined)
				: "NO OPTICAL SCENE LOADED")
	];
	el.innerHTML = cards.join("");
}

/* ══════════════════════════════════════
   CONTROLS
══════════════════════════════════════ */
const SPEC = [
	{
		group: "TERRAIN",
		rows: [
			{ type: "range", key: "exag", label: "VERTICAL SCALE", min: 0.4, max: 3, step: 0.1, fmt: function (v) { return v.toFixed(1) + "×"; }, onChange: rescaleTerrain },
			{ type: "toggle", key: "skin", label: "SATELLITE SKIN" }
		]
	},
	{
		group: "WIND",
		rows: [
			{ type: "toggle", key: "wind", label: "WIND PARTICLES" },
			{ type: "range", key: "density", label: "PARTICLE DENSITY", min: 200, max: 2000, step: 100, fmt: function (v) { return String(Math.round(v)); }, onChange: buildWind },
			{ type: "range", key: "windSpeed", label: "FLOW SPEED", min: 0.2, max: 3, step: 0.1, fmt: function (v) { return v.toFixed(1) + "×"; }, onChange: updateArrows },
			{ type: "toggle", key: "arrows", label: "DIRECTION ARROWS" }
		]
	},
	{
		group: "SKY",
		rows: [
			{ type: "toggle", key: "clouds", label: "CLOUD DECK" },
			{ type: "range", key: "cloudCover", label: "CLOUD COVER", min: 0, max: 100, step: 1, fmt: function (v) { return Math.round(v) + "%"; }, autoKey: "cloudCover" },
			{ type: "range", key: "hour", label: "TIME OF DAY", min: 0, max: 24, step: 0.25, fmt: hhmm, autoKey: "hour" },
			{ type: "toggle", key: "rays", label: "SUN RAYS" },
			{ type: "toggle", key: "fog", label: "HAZE / FOG" }
		]
	},
	{
		group: "PRECIPITATION",
		rows: [
			{ type: "toggle", key: "rain", label: "RAIN" },
			{ type: "toggle", key: "snow", label: "SNOW" }
		]
	},
	{
		group: "VIEW",
		rows: [
			{ type: "toggle", key: "rotate", label: "AUTO-ROTATE" },
			{ type: "button", label: "RESET CAMERA", action: resetView }
		]
	}
];

function buildControls() {
	const host = $("controls-body");

	SPEC.forEach(function (group) {
		const block = document.createElement("div");
		block.className = "ctl-group";
		const title = document.createElement("h4");
		title.textContent = group.group;
		block.appendChild(title);

		group.rows.forEach(function (row) {
			const el = document.createElement("div");
			el.className = "ctl" + (row.type === "toggle" ? " ctl-toggle" : "");

			if (row.type === "range") {
				el.innerHTML = '<div class="ctl-top"><span class="ctl-label">' + row.label + '</span><span class="ctl-val"></span>' +
					(row.autoKey ? '<button type="button" class="ctl-auto"></button>' : "") + "</div>" +
					'<input type="range" min="' + row.min + '" max="' + row.max + '" step="' + row.step + '">';
				const input = el.querySelector("input");
				const val = el.querySelector(".ctl-val");
				const autoBtn = el.querySelector(".ctl-auto");
				input.value = settings[row.key];
				input.addEventListener("input", function () {
					settings[row.key] = Number(input.value);
					if (row.autoKey) auto[row.autoKey] = false;
					if (val) val.textContent = row.fmt(settings[row.key]);
					syncAuto();
					applySettings();
					if (row.onChange) row.onChange();
				});
				if (autoBtn) {
					autoBtn.addEventListener("click", function () {
						auto[row.autoKey] = true;
						if (row.autoKey === "cloudCover" && state.wx) settings.cloudCover = state.wx.now.cloud != null ? state.wx.now.cloud : 45;
						if (row.autoKey === "hour" && state.wx) settings.hour = state.wx.localHour;
						syncControls();
						applySettings();
					});
				}
				ctlEls[row.key] = { row: row, input: input, val: val, autoBtn: autoBtn };
			} else if (row.type === "toggle") {
				el.innerHTML = '<span class="ctl-label">' + row.label + '</span><button type="button" class="switch" role="switch" aria-checked="false"></button>';
				const sw = el.querySelector(".switch");
				sw.addEventListener("click", function () {
					settings[row.key] = !settings[row.key];
					sw.classList.toggle("on", settings[row.key]);
					sw.setAttribute("aria-checked", settings[row.key] ? "true" : "false");
					applySettings();
					if (row.onChange) row.onChange();
				});
				ctlEls[row.key] = { row: row, sw: sw };
			} else {
				el.innerHTML = '<button type="button" class="ctl-btn">' + row.label + "</button>";
				el.querySelector(".ctl-btn").addEventListener("click", row.action);
			}

			block.appendChild(el);
		});

		host.appendChild(block);
	});

	const note = document.createElement("div");
	note.className = "ctl-note";
	note.textContent = "Cloud cover and time of day start in LIVE mode, following the weather at the place. Move a slider to take manual control, or press LIVE to reconnect.";
	host.appendChild(note);

	syncControls();
}

function syncAuto() {
	Object.keys(ctlEls).forEach(function (k) {
		const e = ctlEls[k];
		if (!e || !e.autoBtn) return;
		const live = !!auto[e.row.autoKey];
		e.autoBtn.textContent = live ? "LIVE" : "MANUAL";
		e.autoBtn.classList.toggle("live", live);
	});
}

function syncControls() {
	Object.keys(ctlEls).forEach(function (k) {
		const e = ctlEls[k];
		if (!e) return;
		if (e.row.type === "range") {
			if (document.activeElement !== e.input) e.input.value = settings[k];
			if (e.val) e.val.textContent = e.row.fmt(settings[k]);
		} else if (e.sw) {
			e.sw.classList.toggle("on", !!settings[k]);
			e.sw.setAttribute("aria-checked", settings[k] ? "true" : "false");
		}
	});
	syncAuto();
}

/* ══════════════════════════════════════
   LOOP
══════════════════════════════════════ */
function animate() {
	requestAnimationFrame(animate);
	if (!renderer) return;
	const dt = Math.min(clock.getDelta(), 0.05);
	controls.update();
	updateWind(dt);
	updateClouds(dt);
	updateRain(dt);
	updateSnow(dt);
	updateSun();
	arrowTimer += dt;
	if (arrowTimer > 0.5) {
		arrowTimer = 0;
		if (arrowMesh && settings.arrows) updateArrows();
	}
	renderer.render(scene, camera);
}

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
function readInitialPlace() {
	const params = new URLSearchParams(window.location.search);
	const lat = Number(params.get("lat"));
	const lon = Number(params.get("lon"));
	if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
		params.get("lat") !== null && params.get("lon") !== null) {
		const p = SEARCH.coordPlace(lat, lon);
		const name = params.get("name");
		if (name) {
			p.short = name;
			p.label = name;
		}
		return p;
	}
	const saved = U.store.get("fw.last.v1", null);
	return saved && isFinite(saved.lat) && isFinite(saved.lon) ? saved : null;
}

function boot() {
	initScene();
	buildControls();

	searchCtl = SEARCH.attach({
		form: "search-form",
		input: "place-input",
		suggestions: "suggestions",
		coordToggle: "coord-toggle",
		coordForm: "coord-form",
		coordLat: "coord-lat",
		coordLon: "coord-lon",
		onPlace: loadPlace,
		onError: function (err) { toast(err && err.message ? err.message : String(err), true); }
	});

	$("reset-view").addEventListener("click", resetView);

	const initial = readInitialPlace();
	if (initial) {
		searchCtl.setPlace(initial);
		loadPlace(initial);
	} else {
		renderStats();
		showLoading("NO PLACE LOADED", "Search a place above or enter exact coordinates to build the 3D field.");
	}

	setInterval(function () {
		if (!state.place) return;
		loadWeather(state.place);
	}, 10 * 60 * 1000);

	setInterval(function () {
		if (auto.hour && state.wx) {
			settings.hour = ((Math.floor(Date.now() / 1000) + state.wx.offset) % 86400) / 3600;
			syncControls();
			updateSun();
		}
	}, 60000);

	animate();
}

boot();
