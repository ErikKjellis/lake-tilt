// Poster export panel: frames the view, lists the water-level layers and runs the exporter.
import * as THREE from "three";
import { PosterExporter } from "./exporter.js";
import { formatYear, T_NOW } from "./model.js";
import { loadImage } from "./data.js";
import { KM_CATS, KM_COLOURS } from "./heritage.js";

const PAST_COLOURS = ["#6a1b9a", "#283593", "#00838f", "#2e7d32", "#9e9d24", "#ef6c00", "#c62828", "#6d4c41", "#ad1457", "#455a64"];
const TODAY_COLOURS = { natural: "#37474f", lrv: "#4fc3f7", hrv: "#0d47a1" };
const ASPECTS = { screen: null, aland: Math.SQRT2, aport: 1 / Math.SQRT2, square: 1, wide: 16 / 9 };

export function initExportUI(app) {
  const { $, S, lake, model, meta } = app;
  const exporter = new PosterExporter({ renderer: app.renderer, scene: app.scene, lake, model, meta, hideExtras: app.hideExtras });
  const ui = {
    open: false, mode: "persp", aspect: "aland", long: 6000, background: "ortho",
    times: "10000, 8000, 6000, 4000, 2000", natural: false, lrv: true, hrv: true, useLake2: true,
    fill: 0.85, outline: 3, colours: {},
    km: false, kmCats: [true, true, true, true, false], kmPolys: true, kmSize: 26, kmIds: false,
  };

  // ------------------------------------------------------------------ DOM
  const panel = document.createElement("section");
  panel.id = "export"; panel.className = "panel hidden";
  panel.setAttribute("aria-label", "Poster export");
  const frame = document.createElement("div");
  frame.id = "export-frame"; frame.className = "hidden";
  document.getElementById("app").append(frame, panel);

  let busy = false;   // an export is running: no second run, and the panel stays open
  function render() {
    const L = S();
    panel.innerHTML = `
      <div class="ex-head"><h2>${L.ex_title}</h2><button class="icon" id="ex-close" aria-label="${L.close}">×</button></div>
      <p class="fine">${L.ex_intro}</p>
      <div class="seg" id="ex-mode">
        <button data-mode="persp" class="${ui.mode === "persp" ? "on" : ""}">${L.ex_view_3d}</button>
        <button data-mode="map" class="${ui.mode === "map" ? "on" : ""}">${L.ex_view_map}</button>
      </div>
      <p class="fine">${ui.mode === "map" ? L.ex_map_hint : L.ex_3d_hint}</p>
      <div class="ex-grid">
        <label>${L.ex_aspect}<select id="ex-aspect">
          ${[["aland", L.ex_a_land], ["aport", L.ex_a_port], ["square", L.ex_a_square], ["wide", "16:9"], ["screen", L.ex_a_screen]].map(([v, t]) => `<option value="${v}" ${ui.aspect === v ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
        <label>${L.ex_size}<select id="ex-long">
          ${[3000, 4500, 6000, 8000, 10000].map((v) => `<option value="${v}" ${ui.long === v ? "selected" : ""}>${v} px</option>`).join("")}
        </select></label>
      </div>
      <p class="fine" id="ex-print"></p>
      <label class="ex-row">${L.ex_background}<select id="ex-bg">
        ${[["ortho", L.ex_bg_ortho], ["relief", L.bm_relief], ["topo", L.bm_topo], ["none", L.ex_bg_none]].map(([v, t]) => `<option value="${v}" ${ui.background === v ? "selected" : ""}>${t}</option>`).join("")}
      </select></label>
      <label class="ex-row">${L.ex_past}<input id="ex-times" type="text" value="${ui.times}" spellcheck="false"></label>
      <p class="fine">${L.ex_past_hint}</p>
      <div class="checks">
        <label><input type="checkbox" id="ex-natural" ${ui.natural ? "checked" : ""}> ${L.ex_natural}</label>
        <label><input type="checkbox" id="ex-lrv" ${ui.lrv ? "checked" : ""}> ${L.ex_lrv}</label>
        <label><input type="checkbox" id="ex-hrv" ${ui.hrv ? "checked" : ""}> ${L.ex_hrv}</label>
        <label><input type="checkbox" id="ex-lake2" ${ui.useLake2 ? "checked" : ""}> ${L.ex_lake2}</label>
      </div>
      ${app.getHeritage() ? `<h2 class="ex-sub">${L.ex_km}</h2>
      <div class="checks">
        <label><input type="checkbox" id="ex-km" ${ui.km ? "checked" : ""}> ${L.ex_km}</label>
        <div class="km-cats ${ui.km ? "" : "hidden"}" id="ex-km-cats">
          ${KM_CATS.map((c, i) => `<label><input type="checkbox" data-exkm="${i}" ${ui.kmCats[i] ? "checked" : ""}> <i class="sym s${i}"></i>${L[`km_${c}`]}</label>`).join("")}
          <label><input type="checkbox" id="ex-kmpolys" ${ui.kmPolys ? "checked" : ""}> ${L.ex_km_polys}</label>
          <label><input type="checkbox" id="ex-kmids" ${ui.kmIds ? "checked" : ""}> ${L.ex_km_idlabels}</label>
        </div>
      </div>
      ${app.getHeritage()?.filter ? `<p class="fine">${selectedSites() ? L.ex_km_ids_note(selectedSites()) : L.km_ids_none}</p>` : ""}
      <label class="row"><span>${L.ex_km_size}</span><output id="ex-kmsize-o">${ui.kmSize} px</output></label>
      <input type="range" id="ex-kmsize" min="8" max="96" step="2" value="${ui.kmSize}">
      <p class="fine">${L.ex_km_hint}</p>` : ""}
      <h2 class="ex-sub">${L.ex_layers}</h2>
      <ol class="ex-layers" id="ex-layers"></ol>
      <label class="row"><span>${L.ex_fill}</span><output id="ex-fill-o">${Math.round(ui.fill * 100)} %</output></label>
      <input type="range" id="ex-fill" min="0" max="1" step="0.05" value="${ui.fill}">
      <label class="row"><span>${L.ex_outline}</span><output id="ex-outline-o">${ui.outline} px</output></label>
      <input type="range" id="ex-outline" min="0" max="12" step="1" value="${ui.outline}">
      <details class="ex-code"><summary>${L.ex_viewcode}</summary>
        <textarea id="ex-code" rows="3" spellcheck="false"></textarea>
        <div class="ex-btns"><button id="ex-copy">${L.ex_copy}</button><button id="ex-apply">${L.ex_apply}</button></div>
      </details>
      <div class="ex-btns"><button class="primary" id="ex-run" ${busy ? "disabled" : ""}>${L.ex_export}</button></div>
      <p class="fine" id="ex-progress" role="status" aria-live="polite"></p>`;
    bind();
    renderLayers();
    updatePrint();
    $("ex-code").value = viewCode();
  }

  function parseTimes() {
    return [...new Set(ui.times.split(/[^0-9.]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0))]
      .filter((t) => t <= model.deglac).sort((a, b) => b - a);
  }

  function layers() {
    const L = S(), no = state().lang === "no";
    const nb = (v, d = 0) => v.toLocaleString(no ? "nb-NO" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    const out = [];
    parseTimes().forEach((t, i) => {
      const key = `past:${t}`;
      const ago = formatYear(t, state().lang).main;
      out.push({ key, kind: "past", t, colour: ui.colours[key] ?? PAST_COLOURS[i % PAST_COLOURS.length],
        label: L.ex_lab_past(nb(t), ago), fileStem: `water_${Math.round(t)}calBP` });
    });
    const reg = meta.regulated;
    if (ui.natural) out.push({ key: "natural", kind: "natural", colour: ui.colours.natural ?? TODAY_COLOURS.natural, label: L.ex_lab_natural, fileStem: `today_natural_${meta.strings ? meta.natural_level_m : "475.8"}m` });   // Altevatnet: local-datum level
    if (ui.lrv) out.push({ key: "lrv", kind: "lrv", level: reg.lrv_m, colour: ui.colours.lrv ?? TODAY_COLOURS.lrv, label: L.ex_lab_lrv, fileStem: "today_reservoir_LRV_472.8m" });
    if (ui.hrv) out.push({ key: "hrv", kind: "hrv", level: reg.hrv_m, colour: ui.colours.hrv ?? TODAY_COLOURS.hrv, label: L.ex_lab_hrv, fileStem: "today_reservoir_HRV_489.0m" });
    out.forEach((Ly, i) => { Ly.file = `${String(i + 1).padStart(2, "0")}_${Ly.fileStem}.png`; });
    return out;
  }

  function kmFiles(offset) {
    if (!ui.km || !app.getHeritage()) return [];
    const L = S(), stems = ["samiske", "steinalder_tidlig_metalltid", "jernalder_middelalder", "nyere_tid", "annet_udatert"];
    const withSites = app.getHeritage().selectedCategories();      // an ID selection leaves out the categories without a selected site
    const files = KM_CATS.map((_, c) => c).filter((c) => ui.kmCats[c] && (!withSites || withSites.has(c))).map((c, j) => ({
      cat: c, colour: KM_COLOURS[c], label: L.ex_lab_km(L[`km_${KM_CATS[c]}`]),
      file: `${String(offset + j + 1).padStart(2, "0")}_kulturminner_${stems[c]}.png`,
    }));
    if (ui.kmIds && files.length) files.push({ kind: "ids", cat: -1, colour: "#ffffff", label: L.ex_lab_km_ids, file: `${String(offset + files.length + 1).padStart(2, "0")}_kulturminner_askeladden_id.png` });
    return files;
  }

  /** Number of sites an Askeladden ID selection leaves, or 0 without a selection. */
  function selectedSites() {
    const hg = app.getHeritage();
    return hg?.filter ? hg.selected.reduce((n, v) => n + v, 0) : 0;
  }

  function renderLayers() {
    const box = $("ex-layers");
    box.innerHTML = layers().map((Ly) => `<li><input type="color" value="${Ly.colour}" data-key="${Ly.key}" aria-label="colour"><span>${Ly.label}</span></li>`).join("")
      + kmFiles(layers().length).map((f) => `<li>${f.kind === "ids" ? `<span class="ex-idpill">ID</span>` : `<i class="sym s${f.cat}" style="margin:0 9px 0 9px"></i>`}<span>${f.label}</span></li>`).join("");
    for (const inp of box.querySelectorAll("input[type=color]")) inp.addEventListener("input", (e) => { ui.colours[e.target.dataset.key] = e.target.value; });
  }

  function bind() {
    $("ex-close").addEventListener("click", close);
    $("ex-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      ui.mode = b.dataset.mode; app.setCamMode(ui.mode); render(); layoutFrame();
    });
    $("ex-aspect").addEventListener("change", (e) => { ui.aspect = e.target.value; layoutFrame(); updatePrint(); });
    $("ex-long").addEventListener("change", (e) => { ui.long = Number(e.target.value); updatePrint(); });
    $("ex-bg").addEventListener("change", (e) => { ui.background = e.target.value; });
    $("ex-times").addEventListener("input", (e) => { ui.times = e.target.value; renderLayers(); });
    for (const [id, key] of [["ex-natural", "natural"], ["ex-lrv", "lrv"], ["ex-hrv", "hrv"], ["ex-lake2", "useLake2"]]) {
      $(id).addEventListener("change", (e) => { ui[key] = e.target.checked; renderLayers(); });
    }
    if (app.getHeritage()) {
      $("ex-km").addEventListener("change", (e) => { ui.km = e.target.checked; $("ex-km-cats").classList.toggle("hidden", !ui.km); renderLayers(); });
      for (const cb of panel.querySelectorAll("[data-exkm]")) cb.addEventListener("change", (e) => { ui.kmCats[Number(e.target.dataset.exkm)] = e.target.checked; renderLayers(); });
      $("ex-kmpolys").addEventListener("change", (e) => { ui.kmPolys = e.target.checked; });
      $("ex-kmids").addEventListener("change", (e) => { ui.kmIds = e.target.checked; renderLayers(); });
      $("ex-kmsize").addEventListener("input", (e) => { ui.kmSize = Number(e.target.value); $("ex-kmsize-o").textContent = `${ui.kmSize} px`; });
    }
    $("ex-fill").addEventListener("input", (e) => { ui.fill = Number(e.target.value); $("ex-fill-o").textContent = `${Math.round(ui.fill * 100)} %`; });
    $("ex-outline").addEventListener("input", (e) => { ui.outline = Number(e.target.value); $("ex-outline-o").textContent = `${ui.outline} px`; });
    $("ex-copy").addEventListener("click", async () => { $("ex-code").value = viewCode(); try { await navigator.clipboard.writeText($("ex-code").value); app.toast(S().ex_copied); } catch { $("ex-code").select(); } });
    $("ex-apply").addEventListener("click", () => applyViewCode($("ex-code").value));
    $("ex-run").addEventListener("click", run);
    panel.querySelector(".ex-code").addEventListener("toggle", () => { $("ex-code").value = viewCode(); });
  }

  const state = () => app.state;

  // ------------------------------------------------------------------ framing
  function crop() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const a = ASPECTS[ui.aspect];
    if (!a) return { x: 0, y: 0, w: vw, h: vh, vw, vh };
    const left = panel.classList.contains("hidden") ? 16 : panel.getBoundingClientRect().right + 16;
    const rx = left, ry = 16, rw = vw - left - 16, rh = vh - 32;
    let w = rw, h = w / a;
    if (h > rh) { h = rh; w = h * a; }
    return { x: rx + (rw - w) / 2, y: ry + (rh - h) / 2, w, h, vw, vh };
  }
  function layoutFrame() {
    if (!ui.open) return;
    const c = crop();
    Object.assign(frame.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
  }
  function outSize() {
    const c = crop(), a = c.w / c.h;
    return a >= 1 ? { W: ui.long, H: Math.round(ui.long / a) } : { W: Math.round(ui.long * a), H: ui.long };
  }
  function updatePrint() {
    const { W, H } = outSize();
    const cm = (px) => (px / 300 * 2.54).toFixed(0);
    $("ex-print").textContent = S().ex_print(W, H, cm(W), cm(H));
  }

  // ------------------------------------------------------------------ view code
  function viewCode() {
    const cam = app.getCamera(), ctl = app.getControls();
    const [tx, ty] = lake.toUtm(ctl.target.x, ctl.target.y);
    const o = { v: 1, mode: app.isMapView() ? "map" : "persp", target: [Math.round(tx), Math.round(ty)], exag: state().exag, aspect: ui.aspect };
    if (app.isMapView()) o.height = Math.round((cam.top - cam.bottom) / cam.zoom);
    else {
      const [px, py] = lake.toUtm(cam.position.x, cam.position.y);
      o.camera = [Math.round(px), Math.round(py), Math.round(cam.position.z)];
    }
    return JSON.stringify(o);
  }
  function applyViewCode(text) {
    try {
      const o = JSON.parse(text);
      ui.mode = o.mode === "map" ? "map" : "persp";
      if (o.aspect && o.aspect in ASPECTS) ui.aspect = o.aspect;
      if (o.exag) { state().exag = o.exag; $("r-exag").value = o.exag; $("o-exag").textContent = `${o.exag}×`; }
      app.setCamMode(ui.mode);
      const cam = app.getCamera(), ctl = app.getControls();
      const [tx, ty] = lake.toLocal(o.target[0], o.target[1]);
      if (ui.mode === "map") {
        const visH = cam.top - cam.bottom;
        cam.zoom = visH / o.height; cam.position.set(tx, ty, cam.position.z); cam.updateProjectionMatrix();
      } else {
        const [px, py] = lake.toLocal(o.camera[0], o.camera[1]);
        cam.position.set(px, py, o.camera[2]);
      }
      ctl.target.set(tx, ty, 0); ctl.update();
      app.markDirty(); render(); layoutFrame();
    } catch (e) {
      app.toast(S().ex_code_bad);
    }
  }

  // ------------------------------------------------------------------ export
  async function ensureTexture(id) {
    if (app.baseTex[id]) return app.baseTex[id];
    if (id === "ortho") app.baseTex.ortho = app.makeTexture(await app.loadOrtho());
    else {
      const bm = meta.basemaps.find((b) => b.id === id);
      app.baseTex[id] = app.makeTexture(await loadImage(`${app.DATA}/${bm.file}`));
    }
    return app.baseTex[id];
  }

  async function run() {
    if (busy) return;
    const L = S();
    const prog = $("ex-progress");
    const lys = layers();
    const kmf = kmFiles(lys.length);
    if (!lys.length && !kmf.length) { prog.textContent = L.ex_nolayers; return; }
    busy = true; $("ex-run").disabled = true;
    // the live camera decides the mode (it can be switched outside the panel)
    const mode = app.isMapView() ? "map" : "persp";
    const { W, H } = outSize();
    const c = crop();
    try {
      if (ui.background === "topo") await ensureTexture("topo");
      if (ui.background === "ortho" && mode !== "map") { prog.textContent = L.ex_p_background; await ensureTexture("ortho"); }
      app.setExporting(true);
      const blob = await exporter.run({
        camera: app.getCamera(), mode, W, H, crop: c,
        layers: lys.map((Ly) => ({ ...Ly, color: Ly.colour })),
        fillAlpha: ui.fill, outlinePx: ui.outline, background: ui.background, useLake2: ui.useLake2,
        exag: mode === "map" ? 1 : state().exag, baseState: { ...state() }, lang: state().lang,
        baseTextures: app.baseTex, viewCode: viewCode(), L,
        km: kmf.length ? { heritage: app.getHeritage(), files: kmf, size: ui.kmSize, polys: ui.kmPolys, ids: app.state.kmIds } : null,
      }, (msg) => { $("ex-progress").textContent = msg; });
      const a = document.createElement("a");
      const day = new Date().toISOString().slice(0, 10);
      a.download = `${meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}_poster_${mode}_${day}.zip`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      $("ex-progress").textContent = L.ex_done((blob.size / 1e6).toFixed(1));
    } catch (e) {
      console.error(e);
      $("ex-progress").textContent = `${L.ex_failed} ${e.message ?? e}`;
    } finally {
      busy = false;
      app.setExporting(false);
      if ($("ex-run")) $("ex-run").disabled = false;   // the panel may have been re-rendered (language change)
    }
  }

  // ------------------------------------------------------------------ open / close
  function open() {
    app.onOpen();
    ui.open = true;
    ui.mode = app.isMapView() ? "map" : "persp";
    // an Askeladden ID selection ignores the category switches, so every category starts on in the export too
    ui.km = app.state.km; ui.kmCats = app.getHeritage()?.filter ? KM_CATS.map(() => true) : [...app.state.kmCats];
    ui.kmIds = app.state.kmIdLabels;
    render();
    panel.classList.remove("hidden"); frame.classList.remove("hidden");
    document.getElementById("app").classList.add("exporting");
    layoutFrame();
  }
  function close() {
    if (busy) return;
    ui.open = false;
    panel.classList.add("hidden"); frame.classList.add("hidden");
    document.getElementById("app").classList.remove("exporting");
  }
  void THREE; void T_NOW;
  return { open, close, layoutFrame, rerender: () => ui.open && render(), isOpen: () => ui.open, isBusy: () => busy };
}
