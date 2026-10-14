import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { loadScene, loadImage } from "./data.js";
import { UpliftModel, formatYear, T_NOW, T_END } from "./model.js";
import { LakeScene } from "./scene.js";
import { Profile } from "./profile.js";
import { Isochrones } from "./isochrones.js";
import { STRINGS, applyI18n } from "./i18n.js";
import { aboutHtml } from "./about.js";
import { initExportUI } from "./exportui.js";
import { Heritage, KM_CATS, KM_POLY_DIST } from "./heritage.js";
import { LakePicker } from "./picker.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?lake=<folder in web/data/> selects the scene (default: Altevatnet)
const LAKE = (params.get("lake") || "altevatn").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "altevatn";
const DATA = `data/${LAKE}`;

const state = {
  t: T_NOW, exag: 3, frame: 0, overlay: 0, iso: true, labels: true, regulated: false, recon: true, border: true,
  km: false, kmCats: [true, true, true, true, false],
  lang: (() => { const q = params.get("lang"); if (q === "no" || q === "en") return q; try { return localStorage.getItem("altevatn.lang") === "no" ? "no" : "en"; } catch { return "en"; } })(),
  basemap: "relief", playing: false, speed: 500,
};
const S = () => STRINGS[state.lang];

// ---------------------------------------------------------------- lake picker (works before the scene has loaded)
const picker = new LakePicker({ current: LAKE, getLang: () => state.lang, strings: () => STRINGS[state.lang] });
applyI18n(state.lang);
$("btn-lakes").addEventListener("click", () => picker.open());

// ---------------------------------------------------------------- loading
const ldFill = $("ld-fill"), ldMsg = $("ld-msg");
let data;
try {
  data = await loadScene(DATA, (p, msg) => { ldFill.style.width = `${Math.round(p * 100)}%`; ldMsg.textContent = `${msg}…`; },
    (m) => { const t = document.querySelector(".ld-title"); if (t) t.textContent = m.name; });
} catch (e) {
  ldMsg.textContent = `Could not load data for "${LAKE}" (${e.message}). Start the site with start.bat (or "python tools/serve.py") and open http://localhost:8765/.`;
  $("loading").remove();
  picker.open(STRINGS[state.lang].lk_missing(LAKE));   // an unknown ?lake= (or missing data): let the user choose another
  throw e;
}
const meta = data.meta;
// scene-specific texts (titles, outlets, events, profile labels) override the Altevatnet defaults
for (const [lang, strs] of Object.entries(meta.strings || {})) {
  const S_ = Object.assign(STRINGS[lang] ?? (STRINGS[lang] = {}), strs);
  // templates in JSON: "rate_text" with {mm} and {perkm}
  if (typeof strs.rate_text === "string") { const tpl = strs.rate_text; S_.rate_text = (mm, perkm) => tpl.replace("{mm}", mm).replace("{perkm}", perkm); }
}
const legacyScene = meta.outlets.some((o) => o.id === "leina");   // Altevatnet-only features (events, notes, tour)
const model = new UpliftModel(meta);
model.deglac = meta.deglaciation?.best ?? 10300;
model.defaults.deglac = model.deglac;

// ---------------------------------------------------------------- renderer
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
const maxTex = renderer.capabilities.maxTextureSize;
const scene3 = new THREE.Scene();
const perspCam = new THREE.PerspectiveCamera(36, 1, 60, 500000);
let camera = perspCam;      // switches to an orthographic camera in map view
perspCam.up.set(0, 0, 1);

const lowEnd = params.get("q") === "low" || (params.get("q") !== "high" && (/Mobi|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 2));
// 20 m scenes are drawn every other vertex (40 m) unless ?q=high
const baseStride = params.get("q") === "high" || meta.grid.cell >= 40 ? 1 : 2;
const lake = new LakeScene(data, model, lowEnd ? baseStride * 2 : baseStride);
scene3.add(lake.group);

const labelRenderer = new CSS2DRenderer({ element: $("labels") });

function makeControls(cam, map) {
  const c = new OrbitControls(cam, renderer.domElement);
  c.enableDamping = true;
  c.dampingFactor = 0.08;
  c.zoomToCursor = true;
  c.maxTargetRadius = 0.6 * Math.max(meta.grid.nx, meta.grid.ny) * meta.grid.cell; // keep the target on the tile (origin = tile centre)
  if (map) {
    c.enableRotate = false;
    c.screenSpacePanning = true;
    // zoom is relative to the frustum the map view was opened with: allow down to ~120 m view height
    c.minZoom = 0.05; c.maxZoom = Math.max(40, (cam.top - cam.bottom) / 120);
  } else {
    c.screenSpacePanning = false;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minDistance = 300;   // close enough to see heritage-site outlines
    c.maxDistance = 160000;
  }
  return c;
}
let controls = makeControls(perspCam, false);

// ---------------------------------------------------------------- map view (orthographic, north up)
let orthoCam = null;
const isMapView = () => camera === orthoCam;
/** Distance used for label visibility; for the map view, the equivalent perspective distance. */
function viewDist() {
  if (!isMapView()) return camera.position.distanceTo(controls.target);
  const visH = (orthoCam.top - orthoCam.bottom) / orthoCam.zoom;
  return visH / (2 * Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2)));
}
function setCamMode(mode) {
  if ((mode === "map") === isMapView()) return;
  const target = controls.target.clone();
  const aspect = window.innerWidth / window.innerHeight;
  controls.dispose();
  if (mode === "map") {
    const dist = perspCam.position.distanceTo(target);
    const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2));
    orthoCam = new THREE.OrthographicCamera(-visH * aspect / 2, visH * aspect / 2, visH / 2, -visH / 2, 10, 800000);
    orthoCam.up.set(0, 1, 0);                       // north up (UTM grid north)
    orthoCam.position.set(target.x, target.y, 300000);
    orthoCam.lookAt(target.x, target.y, 0);
    camera = orthoCam;
    controls = makeControls(orthoCam, true);
    controls.target.set(target.x, target.y, 0);
  } else {
    const visH = (orthoCam.top - orthoCam.bottom) / orthoCam.zoom;
    const dist = Math.min(150000, visH / (2 * Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2))));
    const dir = perspCam.position.clone().sub(perspCam.userData.lastTarget ?? new THREE.Vector3()).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.4, -0.75, 0.55).normalize();
    perspCam.position.copy(new THREE.Vector3(target.x, target.y, 0).addScaledVector(dir, dist));
    camera = perspCam;
    controls = makeControls(perspCam, false);
    controls.target.set(target.x, target.y, 0);
  }
  controls.update();
  dirty = true;
}

function setView(v, ms = 0) {
  setCamMode("persp");
  const [tx, ty] = lake.toLocal(v.target[0], v.target[1]);
  const target = new THREE.Vector3(tx, ty, v.target[2] ?? 0);
  const az = THREE.MathUtils.degToRad(v.az), el = THREE.MathUtils.degToRad(v.el);
  const pos = new THREE.Vector3(
    target.x + v.dist * Math.cos(el) * Math.sin(az),
    target.y + v.dist * Math.cos(el) * Math.cos(az),
    target.z + v.dist * Math.sin(el));
  if (!ms) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  flight = { t0: performance.now(), ms, p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: target };
}
let flight = null;
const VIEWS = {
  overview: { target: [679000, 7611000, 0], az: 205, el: 33, dist: 62000 },
  nw: { target: [663500, 7620300, 0], az: 112, el: 38, dist: 16000 },
  se: { target: [694000, 7603500, 0], az: 260, el: 40, dist: 26000 },
  seLow: { target: [693000, 7603000, 0], az: 260, el: 40, dist: 30000 },
  side: { target: [681000, 7608000, 0], az: 200, el: 14, dist: 52000 },
  tilt: { target: [682000, 7610000, 0], az: 208, el: 50, dist: 64000 },
};
if (meta.views) { for (const k of Object.keys(VIEWS)) delete VIEWS[k]; Object.assign(VIEWS, meta.views); }
// the guided tour is written for Altevatnet; other scenes opt in with "tour": true
const hasTour = meta.tour ?? legacyScene;
if (!hasTour) $("btn-tour").classList.add("hidden");
// scenes without their own views: look at the whole render window from the SSW
if (!meta.views && !legacyScene) {
  const g = meta.grid, w = g.nx * g.cell, h = g.ny * g.cell;
  const cx = g.x0 + w / 2, cy = g.y1 - h / 2, d = 1.05 * Math.max(w, h);
  for (const k of Object.keys(VIEWS)) delete VIEWS[k];
  Object.assign(VIEWS, { overview: { target: [cx, cy, 0], az: 200, el: 35, dist: d } });
}
setView(VIEWS.overview);

// ---------------------------------------------------------------- textures
function makeTexture(img) {
  let src = img;
  if (Math.max(img.width, img.height) > maxTex) {
    const k = maxTex / Math.max(img.width, img.height);
    const cv = document.createElement("canvas");
    cv.width = Math.floor(img.width * k); cv.height = Math.floor(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    src = cv;
  }
  const tex = new THREE.Texture(src);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
const baseTex = { relief: makeTexture(data.basemaps.relief) };
const maskTex = new THREE.Texture(data.maskImg);
maskTex.colorSpace = THREE.NoColorSpace;
maskTex.premultiplyAlpha = false;
maskTex.minFilter = THREE.LinearFilter; maskTex.generateMipmaps = false;
maskTex.needsUpdate = true;
lake.setTexture("uMask", maskTex);
lake.setTexture("uBase", baseTex.relief);

async function setBasemap(id) {
  state.basemap = id;
  const u = lake.terrainMat.uniforms;
  if (!baseTex[id]) {
    const bm = meta.basemaps.find((b) => b.id === id);
    try {
      if (id === "ortho") { toast(S().ortho_loading); baseTex[id] = makeTexture(await loadOrtho()); }
      else baseTex[id] = makeTexture(await loadImage(`${DATA}/${bm.file}`));
    } catch (e) {
      toast(S().ortho_fail); $("s-base").value = "relief"; return setBasemap("relief");
    }
  }
  const prev = u.uBase.value;
  u.uBase.value = baseTex[id];
  for (const [k, tx] of Object.entries(baseTex)) if (k !== "relief" && k !== id && tx === prev) { tx.dispose(); delete baseTex[k]; }
  dirty = true;
  u.uBaseIsMap.value = id === "relief" ? 0 : id === "ortho" ? 2 : 1;
  u.uLightK.value = id === "relief" ? 0.45 : id === "ortho" ? 0.35 : 0.85;
  updateAttribution();
}

async function loadOrtho() {
  // Norge i bilder WMS (online viewing only, not baked into the project)
  const g = meta.grid, x0 = g.x0, y1 = g.y1, w = g.nx * g.cell, h = g.ny * g.cell;
  const W = Math.min(4096, maxTex), H = Math.round(W * h / w);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(data.basemaps.relief, 0, 0, W, H);   // shows where Norge i bilder has no coverage (Sweden)
  const nxT = 2, nyT = 2;
  const jobs = [];
  for (let j = 0; j < nyT; j++) for (let i = 0; i < nxT; i++) {
    const bx0 = x0 + (w * i) / nxT, bx1 = x0 + (w * (i + 1)) / nxT, by1 = y1 - (h * j) / nyT, by0 = y1 - (h * (j + 1)) / nyT;
    const pw = Math.round(W / nxT), ph = Math.round(H / nyT);
    const url = `https://wms.geonorge.no/skwms1/wms.nib?service=WMS&version=1.3.0&request=GetMap&layers=ortofoto&styles=&crs=EPSG:25833&bbox=${bx0},${by0},${bx1},${by1}&width=${pw}&height=${ph}&format=image/png&transparent=true`;
    jobs.push(loadImage(url).then((img) => ctx.drawImage(img, i * pw, j * ph, pw, ph)));
  }
  await Promise.all(jobs);
  return cv;
}

// ---------------------------------------------------------------- draped lines (border, profile track)
const borderLines = new Isochrones(lake, model, renderer, { color: "#ffd1e8", alpha: 0.7, halfWidth: 0.9, renderOrder: 3, polylineOnly: true });
borderLines.buildFromPolylines((meta.outlines.border || []).flat(), 40);
scene3.add(borderLines.mesh);
const prof = meta.profile;
const profileTrack = new Isochrones(lake, model, renderer, { color: "#f2b25c", alpha: 0.85, halfWidth: 1.0, renderOrder: 3, polylineOnly: true });
profileTrack.buildFromPolylines([prof.x.map((x, i) => [x, prof.y[i]])], 40);
scene3.add(profileTrack.mesh);
// hover pin
const pin = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 1, 12), new THREE.MeshBasicMaterial({ color: 0xf2b25c }));
pin.rotation.x = Math.PI / 2; pin.visible = false; scene3.add(pin);

// ---------------------------------------------------------------- cultural heritage sites
let heritage = null;
fetch(`${DATA}/kulturminner.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
  if (!d?.sites?.length) return;
  heritage = new Heritage(lake, model, d);
  heritage.setCategories(state.kmCats);
  heritage.setSize(10 * renderer.getPixelRatio());
  scene3.add(heritage.points, heritage.polygons);
  heritage.setViewport(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  KM_CATS.forEach((c, i) => { const el = document.querySelector(`[data-kmcount="${i}"]`); if (el) el.textContent = `(${d.counts[c] ?? 0})`; });
  $("km-toggle").classList.remove("hidden");
  dirty = true;
}).catch(() => {});
$("c-km").addEventListener("change", (e) => { state.km = e.target.checked; $("km-cats").classList.toggle("hidden", !state.km); updateAttribution(); dirty = true; });
for (const cb of document.querySelectorAll("[data-kmcat]")) cb.addEventListener("change", (e) => {
  state.kmCats[Number(e.target.dataset.kmcat)] = e.target.checked; heritage?.setCategories(state.kmCats); dirty = true;
});
// hover: ID, name and dating; click: a popup with the details and a link to Kulturminnesøk,
// which stays until it is closed, the map is clicked or Escape is pressed
const kmTip = $("km-tip"), kmPop = $("km-pop");
let kmHover = null, kmOpen = null, downXY = null;
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kmTitle = (s) => esc(s.name || s.art || S()[`km_${s.cat}`] || s.cat);
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!heritage || !state.km || exporting) { if (kmHover) { kmHover = null; kmTip.classList.add("hidden"); } return; }
  const hit = heritage.pick(e.offsetX, e.offsetY, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight, state);
  kmHover = hit?.site ?? null;
  renderer.domElement.style.cursor = kmHover ? "pointer" : "";
  if (!kmHover || kmHover === kmOpen || e.buttons) { kmTip.classList.add("hidden"); return; }
  const s = kmHover;
  kmTip.innerHTML = `<h4><i class="sym s${s.c}"></i>${kmTitle(s)}</h4><p class="id">ID ${esc(s.id)}</p>`
    + (s.dating.length ? `<p>${esc(s.dating.join(", "))}</p>` : "");
  kmTip.classList.remove("hidden");
  const tw = kmTip.offsetWidth, th = kmTip.offsetHeight;
  kmTip.style.left = `${Math.min(window.innerWidth - tw - 8, e.clientX + 14)}px`;
  kmTip.style.top = `${Math.min(window.innerHeight - th - 8, e.clientY + 14)}px`;
});
renderer.domElement.addEventListener("pointerleave", () => { kmTip.classList.add("hidden"); });
renderer.domElement.addEventListener("pointerdown", (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) >= 4) return;   // a drag, not a click
  // pick at the click position (touch has no hover)
  const hit = heritage && state.km && !exporting
    ? heritage.pick(e.offsetX, e.offsetY, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight, state, e.pointerType === "touch" ? 18 : 10)
    : null;
  if (hit) openKmPopup(hit.site); else closeKmPopup();
});
function kmPopupHtml(s) {
  const L = S();
  const mons = s.monuments.map(([a, n]) => (n > 1 ? `${esc(a)} ×${n}` : esc(a))).join(", ");
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "");
  return `<button class="close" type="button" aria-label="${L.close}">×</button>`
    + `<h4><i class="sym s${s.c}"></i>${kmTitle(s)}</h4><div class="body">`
    + `<table>${row("ID", esc(s.id))}${row(L.km_category, esc(L[`km_${s.cat}`] ?? s.cat))}${row(L.km_type, esc(s.art))}`
    + `${row(L.km_dating, esc(s.dating.join(", ")))}${row(L.km_monuments, mons)}${row(L.km_protection, esc(s.vern))}`
    + `${row(L.km_area, s.area_m2 ? `${Math.round(s.area_m2).toLocaleString(state.lang === "no" ? "nb-NO" : "en-GB")} m²` : "")}</table>`
    + (s.info ? `<p class="info">${esc(s.info)}</p>` : "")
    + (s.link ? `<a class="km-link" href="${esc(s.link)}" target="_blank" rel="noopener">${L.km_open} ↗</a>` : "") + "</div>";
}
function openKmPopup(s) {
  kmOpen = s;
  kmPop.innerHTML = kmPopupHtml(s);
  kmPop.querySelector(".close").addEventListener("click", closeKmPopup);
  kmPop.classList.remove("hidden");
  kmTip.classList.add("hidden");
  placeKmPopup();
}
function closeKmPopup() { kmOpen = null; kmPop.classList.add("hidden"); }
/** Keep the popup anchored above its site (called every drawn frame). */
const kmV = new THREE.Vector3();
function placeKmPopup() {
  if (!kmOpen) return;
  if (!state.km || !heritage?.on[kmOpen.c]) { closeKmPopup(); return; }
  const s = kmOpen, F = model.F(state.t);
  kmV.set(s.X, s.Y, (s.h - lake.zBase - state.frame * s.dr * F / 1000) * state.exag).project(camera);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const off = kmV.z > 1 || Math.abs(kmV.x) > 1.05 || Math.abs(kmV.y) > 1.05;
  const x = (kmV.x + 1) / 2 * w, y = (1 - kmV.y) / 2 * h, pw = kmPop.offsetWidth;
  kmPop.style.visibility = off ? "hidden" : "";
  // above the site unless it fits better below; the body scrolls when neither side has room
  const body = kmPop.querySelector(".body"), chrome = kmPop.offsetHeight - body.clientHeight;
  const need = body.scrollHeight + chrome, above = y - 22, below = h - y - 22;
  const flip = need > above && below > above;
  kmPop.classList.toggle("below", flip);
  body.style.maxHeight = `${Math.max(90, (flip ? below : above) - chrome)}px`;
  const left = Math.max(pw / 2 + 6, Math.min(w - pw / 2 - 6, x));
  kmPop.style.left = `${left}px`;
  kmPop.style.top = `${y}px`;
  kmPop.style.setProperty("--arrow", `${x - left + pw / 2}px`);
}

// ---------------------------------------------------------------- labels
function labelHtml(p) {
  const no = state.lang === "no";
  const name = (no && p.name_no) || p.name;
  const note = (no && p.note_no) || p.note;
  return `${name}${p.sami ? ` <small>${p.sami}</small>` : ""}${note && p.rank <= 2 ? `<small>${note}</small>` : ""}`;
}
const labels = meta.places.map((p) => {
  const el = document.createElement("div");
  el.className = `lbl ${p.kind} r${p.rank}`;
  el.innerHTML = labelHtml(p);
  const obj = new CSS2DObject(el);
  if (p.kind !== "lake" && p.kind !== "country") obj.center.set(0.5, 0); // the dot (top of the label) marks the place
  obj.userData = { p, h: lake.heightAtUtm(p.x, p.y), dr: model.dr(p.x, p.y) };
  const [X, Y] = lake.toLocal(p.x, p.y);
  obj.position.set(X, Y, 0);
  scene3.add(obj);
  return obj;
});
function updateLabels(F) {
  const dist = viewDist();
  for (const o of isoLabels) {
    const { h, dr } = o.userData;
    o.position.z = (h - lake.zBase - state.frame * dr * F / 1000) * state.exag + 30;
    o.visible = state.iso && !state.regulated && state.labels && dist < 60000;
  }
  for (const o of labels) {
    const { p, h, dr } = o.userData;
    const z = (p.kind === "lake" || p.kind === "country") ? Math.max(h, meta.natural_level_m) : h;
    o.position.z = (z - lake.zBase - state.frame * dr * F / 1000) * state.exag + 40;
    const lim = p.rank === 1 ? Infinity : p.rank === 2 ? 90000 : 38000;
    o.visible = state.labels && dist < lim;
  }
}

// ---------------------------------------------------------------- UI wiring
const timeRange = () => ({ t0: model.deglac, t1: T_END });
// The slider is stretched (power 0.6) so the eventful early Holocene gets more room.
const AXIS_POW = 0.6;
const tToPos = (t) => { const { t0, t1 } = timeRange(); return Math.pow(Math.min(1, Math.max(0, (t0 - t) / (t0 - t1))), AXIS_POW); };
const posToT = (p) => { const { t0, t1 } = timeRange(); return t0 - Math.pow(p, 1 / AXIS_POW) * (t0 - t1); };
const rTime = $("r-time");

function setTime(t, fromSlider = false) {
  const { t0, t1 } = timeRange();
  state.t = Math.min(t0, Math.max(t1, t));
  if (!fromSlider) rTime.value = String(tToPos(state.t));
  dirty = true;
}
rTime.addEventListener("input", () => { stopPlay(); leaveRegulated(); setTime(posToT(Number(rTime.value)), true); });
// the reservoir only exists today: any user-driven time change returns to the natural lake
function leaveRegulated() { if (state.regulated) setRegulated(false); }

const btnPlay = $("btn-play");
function stopPlay() { state.playing = false; btnPlay.firstElementChild.textContent = "▶"; btnPlay.setAttribute("aria-label", "Play"); }
function startPlay() {
  leaveRegulated();
  if (state.t <= T_END + 1) setTime(model.deglac);
  state.playing = true; btnPlay.firstElementChild.textContent = "❚❚"; btnPlay.setAttribute("aria-label", "Pause");
  playStopAt = state.t > T_NOW + 1 ? T_NOW : T_END;
}
let playStopAt = T_NOW;
btnPlay.addEventListener("click", () => (state.playing ? stopPlay() : startPlay()));
$("s-speed").addEventListener("change", (e) => (state.speed = Number(e.target.value)));

$("r-exag").addEventListener("input", (e) => { state.exag = Number(e.target.value); $("o-exag").textContent = `${state.exag}×`; dirty = true; });
$("seg-frame").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  setFrame(Number(b.dataset.frame));
});
function setFrame(f) {
  if (f === 1) leaveRegulated();
  state.frame = f;
  for (const b of $("seg-frame").children) b.classList.toggle("on", Number(b.dataset.frame) === f);
  dirty = true;
}
$("s-base").addEventListener("change", (e) => setBasemap(e.target.value));
$("s-overlay").addEventListener("change", (e) => { state.overlay = Number(e.target.value); dirty = true; });
const bindCheck = (id, key) => $(id).addEventListener("change", (e) => { state[key] = e.target.checked; dirty = true; });
bindCheck("c-iso", "iso"); bindCheck("c-labels", "labels"); bindCheck("c-recon", "recon"); bindCheck("c-border", "border");
$("c-reservoir").addEventListener("change", (e) => setRegulated(e.target.checked));
function setRegulated(on) {
  state.regulated = on; $("c-reservoir").checked = on;
  if (on) { stopPlay(); timeAnim = null; setTime(T_NOW); setFrame(0); }
  dirty = true;
}

// model parameters
function syncModelUi() {
  $("r-tau").value = model.tau; $("o-tau").textContent = `${model.tau} ${state.lang === "no" ? "år" : "yr"}`;
  $("r-scale").value = model.k; $("o-scale").textContent = `${model.k.toFixed(2)}×`;
  $("r-deglac").value = model.deglac; $("o-deglac").textContent = `${model.deglac.toLocaleString("en-GB").replace(",", " ")} BP`;
}
$("r-tau").addEventListener("input", (e) => { model.tau = Number(e.target.value); modelChanged(); });
$("r-scale").addEventListener("input", (e) => { model.k = Number(e.target.value); modelChanged(); });
$("r-deglac").addEventListener("input", (e) => { model.deglac = Number(e.target.value); modelChanged(); });
$("btn-reset").addEventListener("click", () => { model.reset(); modelChanged(); });
let isoTimer;
function modelChanged() { syncModelUi(); buildTimeline(); setTime(state.t); dirty = true; clearTimeout(isoTimer); isoTimer = setTimeout(updateIso, 150); }

// language
function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem("altevatn.lang", lang); } catch { /* private mode */ }
  for (const x of document.querySelectorAll(".lang button")) x.classList.toggle("on", x.dataset.lang === lang);
  applyI18n(lang); syncModelUi(); buildTimeline(); updateAttribution(); updateIso(); picker.relabel();
  for (const o of labels) o.element.innerHTML = labelHtml(o.userData.p);
  if (tour.active) showStep(tour.i, false);
  exportUI?.rerender();
  if (kmOpen) openKmPopup(kmOpen);
  if (!$("about").classList.contains("hidden")) $("about-content").innerHTML = aboutHtml(state.lang, meta, model);
  dirty = true;
}
for (const box of document.querySelectorAll(".lang")) box.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (b) setLang(b.dataset.lang);
});

// about
$("btn-about").addEventListener("click", () => { $("about-content").innerHTML = aboutHtml(state.lang, meta, model); $("about").classList.remove("hidden"); });
$("about-close").addEventListener("click", () => $("about").classList.add("hidden"));
$("about").addEventListener("click", (e) => { if (e.target.id === "about") $("about").classList.add("hidden"); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("about").classList.contains("hidden")) { $("about").classList.add("hidden"); return; }
    if (picker.isOpen()) { picker.close(); return; }
    if (kmOpen) { closeKmPopup(); return; }
    if (exportUI?.isOpen()) { exportUI.close(); return; }
    if (tour.active) endTour();
    return;
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || picker.isOpen()) return;
  if (tour.active && ["PageDown", "ArrowRight", "Enter"].includes(e.key)) { e.preventDefault(); $("cap-next").click(); return; }
  if (tour.active && ["PageUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); $("cap-prev").click(); return; }
  if (e.key === " ") { e.preventDefault(); state.playing ? stopPlay() : startPlay(); }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault(); stopPlay(); leaveRegulated();
    const step = (e.shiftKey ? 1000 : 100) * (e.key === "ArrowLeft" ? 1 : -1);
    setTime(state.t + step);
  }
  if (/^[1-8]$/.test(e.key) && hasTour) { if (!tour.active) startTour(); showStep(Number(e.key) - 1); }
  if (e.key === "f") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  if (e.key === "l") setLang(state.lang === "en" ? "no" : "en");
  if (e.key === "p") $("app").classList.toggle("present");
});

// save the current 3D view (terrain, water, lines) as PNG, with a small caption
$("btn-shot").addEventListener("click", () => {
  renderer.render(scene3, camera);
  const src = renderer.domElement;
  const cv = document.createElement("canvas"); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b1218"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(src, 0, 0);
  const k = cv.width / 1600;
  ctx.font = `600 ${Math.round(26 * k)}px Inter, Segoe UI, sans-serif`; ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 6 * k;
  const y = formatYear(state.t, state.lang);
  ctx.fillText(`${meta.name} — ${y.main}`, 24 * k, 44 * k);
  ctx.font = `${Math.round(15 * k)}px Inter, Segoe UI, sans-serif`;
  ctx.fillText(`${y.sub} · ${state.exag}× ${state.lang === "no" ? "vertikal overdrivelse" : "vertical exaggeration"}`, 24 * k, 70 * k);
  ctx.fillText($("attrib").textContent, 24 * k, cv.height - 18 * k);
  const a = document.createElement("a");
  a.download = `${LAKE}_${Math.round(state.t)}BP.png`;
  a.href = cv.toDataURL("image/png");
  a.click();
});

// poster export panel (created at the end, see initExportUI)
$("btn-export").addEventListener("click", () => exportUI?.open());

// side panel collapse
$("btn-side").addEventListener("click", () => {
  const sp = $("side"); sp.classList.toggle("collapsed");
  const c = sp.classList.contains("collapsed");
  $("btn-side").textContent = c ? "+" : "–"; $("btn-side").setAttribute("aria-expanded", String(!c));
});
if (window.innerWidth < 720) { $("side").classList.add("collapsed"); $("btn-side").textContent = "+"; }

// profile collapse
$("btn-profile").addEventListener("click", () => {
  const p = $("profile"); p.classList.toggle("collapsed");
  $("btn-profile").textContent = p.classList.contains("collapsed") ? "+" : "–";
});

function updateAttribution() {
  const no = state.lang === "no";
  const map = {
    relief: "",
    topo: no ? "Kart © Kartverket (CC BY 4.0). " : "Map © Kartverket (CC BY 4.0). ",
    grey: no ? "Kart © Kartverket (CC BY 4.0). " : "Map © Kartverket (CC BY 4.0). ",
    ortho: no ? "Flyfoto © Norge i bilder (Geovekst). " : "Aerial photos © Norge i bilder (Geovekst). ",
  }[state.basemap];
  $("attrib").textContent = map + (no
    ? "Terreng: Kartverket DTM (CC BY 4.0). Dybdekart og innsjøer: NVE. Landheving: NKG2016LU."
    : "Terrain: Kartverket DTM (CC BY 4.0). Bathymetry & lakes: NVE. Land uplift: NKG2016LU.")
    + (state.km ? (no ? " Kulturminner: Riksantikvaren." : " Heritage sites: Riksantikvaren.") : "");
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector(".tl-tip.toast");
  if (!el) { el = document.createElement("div"); el.className = "tl-tip toast"; el.style.left = "50%"; el.style.bottom = "120px"; document.getElementById("app").appendChild(el); }
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = "none"), 3500);
}

// ---------------------------------------------------------------- timeline
function buildTimeline() {
  const evBox = $("tl-events"), axis = $("tl-axis"), bands = $("tl-bands");
  evBox.innerHTML = ""; axis.innerHTML = ""; bands.innerHTML = "";
  const L = S(), no = state.lang === "no";
  const shortOf = (e) => ({ ev_to_atl: L.short_atl, ev_to_bal: L.short_bal, ev_merge: L.short_merge, ev_split: L.short_split })[e.key] ?? "";
  const evs = model.events().map((e) => ({ ...e, text: L[e.key], short: shortOf(e) }));
  evs.push({ t: model.deglac, type: "ice", text: L.ev_deglac, short: L.short_deglac });
  if (meta.events) {
    // scene-specific fixed events: { t (cal BP), type, key[, short] } with texts in meta.strings
    for (const e of meta.events) if (e.t < model.deglac) evs.push({ t: e.t, type: e.type, text: L[e.key] ?? e.key, short: e.short ? L[e.short] ?? "" : "" });
  } else {
    const tSE = meta.deglaciation?.se ?? 10200;
    if (tSE < model.deglac) evs.push({ t: tSE, type: "ice", text: L.ev_se_ice, short: "" });
    if (9900 < model.deglac) evs.push({ t: 9900, type: "ice", text: L.ev_torne, short: "" });
    evs.push({ t: 1950 - 1922, type: "hum", text: L.ev_1922, short: "" });
    evs.push({ t: 1950 - 1952, type: "hum", text: L.ev_1951, short: "" });
    evs.push({ t: 1950 - 1960, type: "hum", text: L.ev_1960, short: L.short_1960 });
  }
  for (const e of evs) {
    const d = document.createElement("div");
    d.className = `tl-ev ${e.type}`;
    d.style.left = `${tToPos(e.t) * 100}%`;
    d.dataset.short = e.short || "";
    d.title = `${formatYear(e.t, state.lang).main}: ${e.text}`;
    d.addEventListener("click", () => { stopPlay(); leaveRegulated(); setTime(e.t - 1); });
    evBox.appendChild(d);
  }
  // coloured bands: where the lake drains (model), and the reservoir era
  const g = model.Fgrid;
  let runStart = model.deglac, runKind = null;
  const kindAt = (t) => model.regimeAt(model.F(t)).final;
  const tRes = 1950 - (meta.dam?.year ?? 1960);
  for (let t = model.deglac; t >= T_END; t -= 10) {
    const k = t < tRes ? "res" : kindAt(t);
    if (k !== runKind) {
      if (runKind) addBand(runStart, t, runKind);
      runStart = t; runKind = k;
    }
  }
  addBand(runStart, T_END, runKind);
  function addBand(ta, tb, kind) {
    const b = document.createElement("div");
    const sea = model.seaOf(kind);
    b.className = `tl-band ${sea === "Baltic" ? "bal" : sea === "Atlantic" ? "atl" : kind === "res" ? "hum" : "oth"}`;
    b.style.left = `${tToPos(ta) * 100}%`; b.style.width = `${(tToPos(tb) - tToPos(ta)) * 100}%`;
    bands.appendChild(b);
  }
  void g;
  const nf = (v) => v.toLocaleString(no ? "nb-NO" : "en-GB");
  const ticks = [10000, 9000, 8000, 6000, 4000, 2000, 0, -1050].filter((t) => t <= model.deglac);
  for (const t of ticks) {
    const s = document.createElement("span");
    s.style.left = `${tToPos(t) * 100}%`;
    s.textContent = t === -1050 ? `3000 ${L.ce}` : t === 0 ? "1950" : `${nf(t / 1000)}k BP`;
    axis.appendChild(s);
  }
  const now = document.createElement("span");
  now.style.left = `${tToPos(T_NOW) * 100}%`; now.style.top = "-36px"; now.style.color = "#f2b25c"; now.textContent = "▾";
  axis.appendChild(now);
  for (const o of $("s-speed").options) o.textContent = `${o.value} ${L.yr_s}`;
  timelineEvents = evs;
}
let timelineEvents = [];

// ---------------------------------------------------------------- isochrones
const iso = new Isochrones(lake, model, renderer);
scene3.add(iso.mesh);
// today's natural shoreline, shown whenever another time is selected
const shoreNow = new Isochrones(lake, model, renderer, { color: "#ffffff", alpha: 0.85, halfWidth: 1.0, renderOrder: 5 });
shoreNow.build([T_NOW]);
scene3.add(shoreNow.mesh);
let isoLabels = [];
function updateIso() {
  const times = [];
  for (let t = 10000; t >= 1000; t -= 1000) if (t < model.deglac) times.push(t);
  const pts = iso.build(times);
  isoTimes = times;
  for (const o of isoLabels) scene3.remove(o);
  isoLabels = pts.map(({ p, t }) => {
    const el = document.createElement("div");
    el.className = "lbl iso";
    el.textContent = `${t / 1000}k`;
    const o = new CSS2DObject(el);
    const [x, y] = lake.toUtm(p[0], p[1]);
    o.userData = { p: { kind: "iso", rank: 2 }, h: p[2], dr: model.dr(x, y) };
    o.position.set(p[0], p[1], 0);
    scene3.add(o);
    return o;
  });
  dirty = true;
}
let isoTimes = [];

// ---------------------------------------------------------------- read-outs
const SE_REF = meta.se_ref ? [meta.se_ref.x, meta.se_ref.y] : [692140, 7607020];
const distSE = Math.hypot(SE_REF[0] - meta.outlet.x, SE_REF[1] - meta.outlet.y) / 1000;
const drSE = model.dr(...SE_REF);
const fmt = (v, d = 1) => (Math.abs(v) < 0.05 && d === 1 ? "0.0" : v.toFixed(d)).replace(".", state.lang === "no" ? "," : ".");

function updateReadouts(F) {
  const L = S();
  const tilt = drSE * F / 1000;
  $("k-tilt").textContent = `${fmt(tilt)} m`;
  $("k-tilt2").textContent = `${fmt(tilt / distSE, 3)} ${L.per_km} · ${fmt(distSE, 0)} km`;
  const lev = model.level(0, F) + drSE * F / 1000 - (model.level(0, 0));
  $("k-level").textContent = `${lev >= 0 ? "+" : "−"}${fmt(Math.abs(lev))} m`;
  const st = model.stats(0, F);
  $("k-area").textContent = `${fmt(st.area, 0)} ${L.km2}`;
  const notes = [];
  if (legacyScene && st.merged.includes(2)) notes.push(L.merged_with_leina);
  if (legacyScene && !st.merged.includes(1)) notes.push(L.west_separate);
  for (const n of meta.lake_notes ?? []) if (st.merged.includes(n.lake) === n.when_merged) notes.push(L[n.key] ?? "");
  $("k-area2").textContent = notes.join(" · ");
  const future = state.t < T_NOW;
  $("k-uplift").textContent = `${fmt(Math.abs(model.rRef * F / 1000))} m`;
  $("k-uplift-label").textContent = future ? L.k_uplift_future : L.k_uplift;
  const reg = model.regimeAt(F);
  const o = $("outlet");
  let text = reg.final === "secol" && state.t > 9900 && legacyScene ? L.outlet_secol_ice : L[`outlet_${reg.final}`] ?? L.outlet_other;
  if (state.t > (meta.deglaciation?.se ?? 10200)) text += ` ${L.se_ice_note}`;
  if (state.regulated) text = L.outlet_regulated;
  $("outlet-text").textContent = text;
  o.classList.toggle("baltic", !state.regulated && model.seaOf(reg.final) === "Baltic");
  const rf = model.rateFactor(state.t);
  $("k-rate").textContent = L.rate_text(fmt(drSE * rf, 2), fmt(drSE * rf / distSE, 4));
  const y = formatYear(state.t, state.lang);
  $("y-main").textContent = y.main;
  $("y-sub").textContent = y.sub;
}

// legend
const legend = document.createElement("div");
legend.className = "panel legend hidden";
document.getElementById("app").appendChild(legend);
function updateLegend(F) {
  const L = S();
  const u = lake.terrainMat.uniforms;
  if (state.overlay === 1) {
    const hi = u.uOvRange.value.y, lo = -u.uOvRange.value.x;
    const lab = state.t < T_NOW ? L.legend_uplift_future : L.legend_uplift;
    const pct = (100 * lo / (lo + hi)).toFixed(1);
    legend.innerHTML = `<div>${lab}</div><div class="bar" style="background:linear-gradient(90deg,#306bbf 0%,#f5f2eb ${pct}%,#cc4233 100%)"></div><div class="ticks"><span>−${fmt(lo, lo < 10 ? 1 : 0)}</span><span>0</span><span>+${fmt(hi, hi < 10 ? 1 : 0)}</span></div><div class="fine" style="margin:4px 0 0">${L.legend_contours}: ${fmt(u.uOvStep.value, u.uOvStep.value < 1 ? 1 : 0)} m</div>`;
    legend.classList.remove("hidden");
  } else if (state.overlay === 2) {
    const [r0, r1] = lake.rateRange;
    legend.innerHTML = `<div>${L.legend_rate}</div><div class="bar" style="background:linear-gradient(90deg,#30123b,#4686fb,#1be5b5,#a4fc3c,#fbb938,#e4460a,#7a0403)"></div><div class="ticks"><span>${fmt(r0)}</span><span>${fmt((r0 + r1) / 2)}</span><span>${fmt(r1)}</span></div>`;
    legend.classList.remove("hidden");
  } else if (state.iso && !state.regulated && isoTimes.length) {
    legend.innerHTML = `<div>${L.legend_iso}</div><div class="bar" style="background:linear-gradient(90deg,#cc73ff,#ffdb59)"></div><div class="ticks"><span>${isoTimes[0] / 1000}k BP</span><span>${isoTimes[isoTimes.length - 1] / 1000}k BP</span></div>`;
    legend.classList.remove("hidden");
  } else legend.classList.add("hidden");
}

// ---------------------------------------------------------------- tour
const tour = { active: false, i: 0 };
function eventTime(key, fallback) { return timelineEvents.find((e) => e.key === key)?.t ?? fallback; }
function tourContext() {
  const no = state.lang === "no";
  const n = (v, d = 0) => v.toLocaleString(no ? "nb-NO" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,(?=\d{3})/g, " ");
  const r10 = (t) => n(Math.round(t / 10) * 10);
  const tMerge = eventTime("ev_merge", NaN), tAtl = eventTime("ev_to_atl", NaN);
  const tMid = Number.isFinite(tMerge) && Number.isFinite(tAtl) ? (tMerge + tAtl) / 2 : 9400;
  return {
    rNW: n(model.rRef, 2), rSE: n(model.rRef + drSE, 2), drSE: n(drSE, 2),
    deglacBP: r10(model.deglac), tiltDeglac: n(drSE * model.F(model.deglac) / 1000),
    tMergeBP: Number.isFinite(tMerge) ? r10(tMerge) : "–", tAtlBP: Number.isFinite(tAtl) ? r10(tAtl) : "–", tMidBP: r10(tMid),
    mergeArea: n(Math.round(model.stats(0, model.F(tMid)).area / 5) * 5),
    perKyr: n(Math.abs(drSE * model.F(T_NOW - 1000)) / 1000, 1),
    future: n(Math.abs(drSE * model.F(T_END)) / 1000, 2),
    speedup: n(model.rateFactor(model.deglac) / model.rateFactor(T_NOW)),
    tSplitBP: Number.isFinite(eventTime("ev_split", NaN)) ? r10(eventTime("ev_split", NaN)) : "–",
  };
}
function tourSteps() {
  const tMerge = eventTime("ev_merge", 9350), tAtl = eventTime("ev_to_atl", 9250);
  return [
    { t: T_NOW, regulated: true, frame: 0, overlay: 0, iso: false, view: "overview", exag: 3 },
    { t: T_NOW, regulated: false, frame: 0, overlay: 0, iso: false, view: "nw", exag: 3 },
    { t: T_NOW, regulated: false, frame: 0, overlay: 2, iso: false, view: "overview", exag: 3 },
    { t: model.deglac, regulated: false, frame: 0, overlay: 1, iso: false, view: "se", exag: 3 },
    { t: Math.min(model.deglac, (tMerge + tAtl) / 2), regulated: false, frame: 0, overlay: 0, iso: false, view: "seLow", exag: 3 },
    { t: T_NOW, regulated: false, frame: 0, overlay: 0, iso: true, view: "se", exag: 3 },
    { t: model.deglac, regulated: false, frame: 1, overlay: 0, iso: false, view: "tilt", exag: 4, play: true },
    { t: T_END, regulated: false, frame: 0, overlay: 1, iso: true, view: "overview", exag: 3 },
  ];
}
function showStep(i, fly = true) {
  const steps = tourSteps();
  tour.i = Math.max(0, Math.min(steps.length - 1, i));
  const st = steps[tour.i];
  const [title, text] = S().tour_steps(tourContext())[tour.i];
  $("cap-step").textContent = `${tour.i + 1}/${steps.length}`;
  $("cap-title").textContent = title;
  $("cap-text").textContent = text;
  $("cap-prev").disabled = tour.i === 0;
  $("cap-next").textContent = tour.i === steps.length - 1 ? S().close : S().next;
  if (!fly) return;
  stopPlay();
  setRegulated(st.regulated);
  setFrame(st.frame);
  state.overlay = st.overlay; $("s-overlay").value = String(st.overlay);
  state.iso = st.iso; $("c-iso").checked = st.iso;
  state.recon = true; $("c-recon").checked = true; state.labels = true; $("c-labels").checked = true;
  state.exag = st.exag; $("r-exag").value = st.exag; $("o-exag").textContent = `${st.exag}×`;
  animateTime(st.t, 1800);
  setView(VIEWS[st.view], 2400);
  if (st.play) setTimeout(() => { if (tour.active && tour.i === i) { state.speed = 1000; $("s-speed").value = "1000"; startPlay(); } }, 2600);
  $("profile").classList.remove("collapsed"); $("btn-profile").textContent = "–";
}
let timeAnim = null;
function animateTime(t1, ms) { timeAnim = { t0: performance.now(), ms, a: state.t, b: t1 }; }
function startTour() {
  if (!tour.active) tour.saved = { frame: state.frame, exag: state.exag, overlay: state.overlay };
  tour.active = true; $("app").classList.add("touring"); $("caption").classList.remove("hidden"); showStep(0);
}
function endTour() {
  tour.active = false; $("app").classList.remove("touring"); $("caption").classList.add("hidden");
  stopPlay();
  const sv = tour.saved;
  if (sv) {
    setFrame(sv.frame);
    state.exag = sv.exag; $("r-exag").value = sv.exag; $("o-exag").textContent = `${sv.exag}×`;
    state.overlay = sv.overlay; $("s-overlay").value = String(sv.overlay);
    dirty = true;
  }
}
$("btn-tour").addEventListener("click", startTour);
$("cap-next").addEventListener("click", () => (tour.i >= tourSteps().length - 1 ? endTour() : showStep(tour.i + 1)));
$("cap-prev").addEventListener("click", () => showStep(tour.i - 1));
$("cap-close").addEventListener("click", endTour);

// ---------------------------------------------------------------- profile
const profile = new Profile($("profile-canvas"), lake, model);
profile.onHover = (h) => {
  if (!h) { pin.visible = false; labelsDirty = true; return; }
  const [X, Y] = lake.toLocal(h.x, h.y);
  const hz = lake.heightAtUtm(h.x, h.y);
  const z = (hz - lake.zBase - state.frame * model.dr(h.x, h.y) * model.F(state.t) / 1000) * state.exag;
  pin.position.set(X, Y, z + 500); pin.scale.set(1, 1000, 1); pin.visible = true;
  labelsDirty = true;
};

// ---------------------------------------------------------------- resize + loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  perspCam.aspect = w / h; perspCam.updateProjectionMatrix();
  if (orthoCam) {
    const visH = orthoCam.top - orthoCam.bottom;
    orthoCam.left = -visH * w / h / 2; orthoCam.right = visH * w / h / 2; orthoCam.updateProjectionMatrix();
  }
  exportUI?.layoutFrame();
  iso.setViewport(w, h);
  shoreNow.setViewport(w, h);
  borderLines.setViewport(w, h);
  profileTrack.setViewport(w, h);
  heritage?.setViewport(w, h);
  dirty = true;
}
window.addEventListener("resize", resize);

let dirty = true;
let last = performance.now(), lastDraw = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (exporting) return;   // the poster exporter drives the renderer
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.playing) {
    setTime(state.t - state.speed * dt);
    if (state.t <= playStopAt + 0.5) { setTime(playStopAt); stopPlay(); }
  }
  if (timeAnim) {
    const f = Math.min(1, (now - timeAnim.t0) / timeAnim.ms), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    setTime(timeAnim.a + (timeAnim.b - timeAnim.a) * e);
    if (f >= 1) timeAnim = null;
  }
  if (flight) {
    const f = Math.min(1, (now - flight.t0) / flight.ms), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.q0, flight.q1, e);
    if (f >= 1) flight = null;
  }
  const moved = controls.update();
  // Render on demand; when idle keep ~15 fps for the water ripples only.
  const busy = dirty || moved || flight || timeAnim || state.playing || labelsDirty;
  if (!busy && now - lastDraw < 66) return;
  lastDraw = now; labelsDirty = false;
  // keep the near plane proportional to the viewing distance
  if (!isMapView()) {
    const dist = camera.position.distanceTo(controls.target);
    camera.near = Math.max(20, dist / 400); camera.far = dist * 12 + 120000; camera.updateProjectionMatrix();
    perspCam.userData.lastTarget = controls.target.clone();
  }

  if (dirty) {
    const F = lake.update(state);
    borderLines.mesh.visible = state.border;
    iso.mesh.visible = state.iso && !state.regulated;
    shoreNow.mesh.visible = !state.regulated && Math.abs(state.t - T_NOW) > 30;
    updateReadouts(F);
    updateLegend(F);
    profile.draw(state);
    dirty = false;
  }
  const F = model.F(state.t);
  updateLabels(F);
  if (heritage) {
    // locality polygons and safety zones only when zoomed in
    const d = viewDist();
    heritage.setVisible(state.km, d < KM_POLY_DIST);
    heritage.setScale(2 * d * Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2)) / renderer.domElement.clientHeight);
    placeKmPopup();
  }
  lake.waterMat.uniforms.uCamPos.value.copy(camera.position);
  lake.waterMat.uniforms.uTime.value = now / 1000;
  renderer.render(scene3, camera);
  labelRenderer.render(scene3, camera);
}
let labelsDirty = true;
let exporting = false;
let exportUI = null;
renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); toast(state.lang === "no" ? "Grafikkontektsen gikk tapt – last siden på nytt." : "The graphics context was lost – please reload the page."); });

// ---------------------------------------------------------------- start
applyI18n(state.lang);
for (const x of document.querySelectorAll(".lang button")) x.classList.toggle("on", x.dataset.lang === state.lang);
syncModelUi();
buildTimeline();
updateIso();
updateAttribution();
setTime(T_NOW);
resize();
ldMsg.textContent = "3D…";
renderer.initTexture(baseTex.relief);
try { await renderer.compileAsync(scene3, camera); } catch { /* older drivers: compile on first frame */ }
requestAnimationFrame(frame);
$("loading").classList.add("done");
setTimeout(() => $("loading").remove(), 600);
exportUI = initExportUI({
  renderer, scene: scene3, lake, model, meta, state, S, $, toast,
  getCamera: () => camera, getControls: () => controls, setCamMode, isMapView,
  baseTex, makeTexture, loadOrtho, DATA,
  setExporting: (on) => { exporting = on; if (!on) { dirty = true; labelsDirty = true; } },
  hideExtras: (on) => {
    if (on) { closeKmPopup(); kmTip.classList.add("hidden"); }
    for (const m of [iso.mesh, shoreNow.mesh, borderLines.mesh, profileTrack.mesh, pin, heritage?.points, heritage?.polygons].filter(Boolean)) {
      if (on) { m.userData.wasVisible = m.visible; m.visible = false; } else if (m.userData.wasVisible !== undefined) m.visible = m.userData.wasVisible;
    }
  },
  markDirty: () => { dirty = true; },
  getHeritage: () => heritage,
  onOpen: () => { if (tour.active) endTour(); stopPlay(); leaveRegulated(); setFrame(0); },
});
window.__lake = { get heritage() { return heritage; }, state, model, lake, get camera() { return camera; }, get controls() { return controls; }, renderer, setTime, setView, VIEWS, setCamMode, exportUI };
