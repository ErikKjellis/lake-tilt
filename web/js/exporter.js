// Poster export: separate, exactly registered images of the water extent for
// several times, plus a background map, rendered from the current viewpoint.
//
// Each water layer is a transparent PNG (flat fill + outline). The terrain is
// drawn depth-only, so in 3D views mountains in front still hide the water.
// In map mode (orthographic, north up) the images are georeferenced in
// EPSG:25833 and get world files (.pgw/.jgw) and a .prj.
import * as THREE from "three";
import { makeZip } from "./zip.js";
import { formatYear, T_NOW } from "./model.js";
import { loadImage } from "./data.js";

const TILE = 2048;
const WMS = "https://wms.geonorge.no/skwms1/wms.nib";
const PRJ_25833 = 'PROJCS["ETRS89 / UTM zone 33N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",15],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]';

const hexToVec = (hex) => {
  const c = new THREE.Color(hex);           // sRGB hex -> linear working space
  c.convertLinearToSRGB();                  // shaders pass sRGB straight through
  return new THREE.Vector3(c.r, c.g, c.b);
};
const canvasBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q));
const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());

/** Fetch a Norge i bilder orthophoto for a bbox (EPSG:25833) into a canvas of W x H pixels.
 *  Areas without coverage (e.g. Sweden) are transparent in the PNG tiles and show `underlay`
 *  (a function drawing into the canvas first), e.g. the natural-relief map. */
export async function fetchOrtho(bbox, W, H, onTile, underlay) {
  const [x0, y0, x1, y1] = bbox;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  underlay?.(ctx, W, H);
  const nx = Math.ceil(W / TILE), ny = Math.ceil(H / TILE);
  const jobs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px0 = i * TILE, py0 = j * TILE, pw = Math.min(TILE, W - px0), ph = Math.min(TILE, H - py0);
    const bx0 = x0 + (px0 / W) * (x1 - x0), bx1 = x0 + ((px0 + pw) / W) * (x1 - x0);
    const by1 = y1 - (py0 / H) * (y1 - y0), by0 = y1 - ((py0 + ph) / H) * (y1 - y0);
    jobs.push({ px0, py0, pw, ph, url: `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=ortofoto&styles=&crs=EPSG:25833&bbox=${bx0},${by0},${bx1},${by1}&width=${pw}&height=${ph}&format=image/png&transparent=true` });
  }
  let done = 0;
  const worker = async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      let img;
      for (let k = 0; k < 3 && !img; k++) { try { img = await loadImage(job.url); } catch (e) { if (k === 2) throw e; } }
      ctx.drawImage(img, job.px0, job.py0, job.pw, job.ph);
      onTile?.(++done, nx * ny);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return cv;
}

export class PosterExporter {
  /**
   * @param {object} app  { renderer, scene, lake, model, meta, hideExtras(on), originUtm(X,Y) }
   */
  constructor(app) { this.app = app; }

  /** Render the scene in tiles into a W x H canvas, cropped to `crop` of the viewport. */
  renderToCanvas(camera, W, H, crop, clear) {
    const { renderer, scene } = this.app;
    const s = W / crop.w;
    const fullW = crop.vw * s, fullH = crop.vh * s;
    const rt = new THREE.WebGLRenderTarget(TILE, TILE, { samples: Math.min(4, renderer.capabilities.maxSamples || 0) });
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const octx = out.getContext("2d");
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const buf = new Uint8Array(TILE * TILE * 4);
    for (let ty = 0; ty < H; ty += TILE) for (let tx = 0; tx < W; tx += TILE) {
      const tw = Math.min(TILE, W - tx), th = Math.min(TILE, H - ty);
      rt.setSize(tw, th);
      camera.setViewOffset(fullW, fullH, crop.x * s + tx, crop.y * s + ty, tw, th);
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(clear.color, clear.alpha);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, tw, th, buf);
      const img = octx.createImageData(tw, th);
      for (let r = 0; r < th; r++) img.data.set(buf.subarray((th - 1 - r) * tw * 4, (th - r) * tw * 4), r * tw * 4);
      octx.putImageData(img, tx, ty);
    }
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    return out;
  }

  /** Bounding box (EPSG:25833) of the terrain visible inside the crop, for a perspective camera. */
  visibleBbox(camera, crop, exag) {
    const { lake } = this.app;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const planes = [0, (900 - lake.zBase) * exag, (-90) * exag].map((z) => new THREE.Plane(new THREE.Vector3(0, 0, 1), -z));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sky = false;
    const halfW = lake.width / 2, halfH = lake.heightM / 2;
    for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) {
      const sx = crop.x + (i / 24) * crop.w, sy = crop.y + (j / 24) * crop.h;
      ndc.set((sx / crop.vw) * 2 - 1, -(sy / crop.vh) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      let any = false;
      for (const pl of planes) {
        if (ray.ray.intersectPlane(pl, hit)) {
          any = true;
          x0 = Math.min(x0, hit.x); x1 = Math.max(x1, hit.x); y0 = Math.min(y0, hit.y); y1 = Math.max(y1, hit.y);
        }
      }
      if (!any) sky = true;
    }
    if (sky || !Number.isFinite(x0)) { x0 = -halfW; y0 = -halfH; x1 = halfW; y1 = halfH; }
    const mx = 0.06 * (x1 - x0), my = 0.06 * (y1 - y0);
    x0 = Math.max(-halfW, x0 - mx); x1 = Math.min(halfW, x1 + mx); y0 = Math.max(-halfH, y0 - my); y1 = Math.min(halfH, y1 + my);
    const [ux0, uy0] = lake.toUtm(x0, y0), [ux1, uy1] = lake.toUtm(x1, y1);
    return [ux0, uy0, ux1, uy1];
  }

  /** Extent (EPSG:25833) of the crop for an orthographic, north-up camera. */
  mapBbox(camera, crop) {
    const { lake } = this.app;
    const w = (camera.right - camera.left) / camera.zoom, h = (camera.top - camera.bottom) / camera.zoom;
    const X0 = camera.position.x + (crop.x / crop.vw - 0.5) * w;
    const X1 = camera.position.x + ((crop.x + crop.w) / crop.vw - 0.5) * w;
    const Y1 = camera.position.y + (0.5 - crop.y / crop.vh) * h;
    const Y0 = camera.position.y + (0.5 - (crop.y + crop.h) / crop.vh) * h;
    const [x0, y0] = lake.toUtm(X0, Y0), [x1, y1] = lake.toUtm(X1, Y1);
    return [x0, y0, x1, y1];
  }

  /**
   * opts: { camera, mode: 'persp'|'map', W, H, crop, layers: [{kind, t, level, color, label, file}],
   *         fillAlpha, outlinePx, background: 'ortho'|'relief'|'topo'|'none', useLake2, exag,
   *         lang, viewCode, baseTextures: { relief, topo, ortho } , L (strings) }
   */
  async run(opts, progress) {
    const { lake, model, meta } = this.app;
    const tm = lake.terrainMat.uniforms, wm = lake.waterMat;
    const cam = opts.camera.clone();
    if (cam.isPerspectiveCamera) cam.aspect = opts.crop.vw / opts.crop.vh;
    cam.updateProjectionMatrix();
    const saved = {
      base: tm.uBase.value, isMap: tm.uBaseIsMap.value, lightK: tm.uLightK.value, recon: tm.uRecon.value, overlay: tm.uOverlay.value,
      hiOn: tm.uHiOn.value, hiTex: tm.uBaseHi.value, hiRect: tm.uHiRect.value.clone(),
      flat: wm.uniforms.uFlat.value, blending: wm.blending, terrainColor: lake.terrainMat.colorWrite,
      terrainVis: lake.terrain.visible, waterVis: lake.water.visible,
    };
    const files = [];
    const stamp = (n) => String(n).padStart(2, "0");
    const isMap = opts.mode === "map";
    const bbox = isMap ? this.mapBbox(cam, opts.crop) : null;
    const preview = document.createElement("canvas");
    const pk = Math.min(1, 2400 / Math.max(opts.W, opts.H));
    preview.width = Math.round(opts.W * pk); preview.height = Math.round(opts.H * pk);
    const pctx = preview.getContext("2d");
    pctx.fillStyle = "#ffffff"; pctx.fillRect(0, 0, preview.width, preview.height);
    this.app.hideExtras(true);
    try {
      // ---------------------------------------------------------------- background
      if (opts.background !== "none") {
        progress?.(opts.L.ex_p_background);
        let bg;
        if (isMap && opts.background === "ortho") {
          tm.uBase.value = opts.baseTextures.relief; tm.uHiOn.value = 0;
          tm.uBaseIsMap.value = 0; tm.uRecon.value = 0; tm.uOverlay.value = 0; tm.uLightK.value = 0;
          lake.update({ ...opts.baseState, t: T_NOW, regulated: false, frame: 0, overlay: 0, iso: false, exag: 1 });
          lake.water.visible = false; lake.terrain.visible = true; lake.terrainMat.colorWrite = true;
          const relief = this.renderToCanvas(cam, opts.W, opts.H, opts.crop, { color: 0xffffff, alpha: 1 });
          bg = await fetchOrtho(bbox, opts.W, opts.H, (i, n) => progress?.(`${opts.L.ex_p_background} ${i}/${n}`),
            (ctx) => ctx.drawImage(relief, 0, 0));
        } else {
          if (opts.background === "ortho") {
            // perspective: drape a high-resolution photo of the visible area over the low-resolution full map
            const vb = this.visibleBbox(cam, opts.crop, opts.exag);
            const maxTex = Math.min(8192, this.app.renderer.capabilities.maxTextureSize);
            const bw = vb[2] - vb[0], bh = vb[3] - vb[1];
            const long = Math.min(maxTex, Math.ceil(Math.max(bw, bh) / 0.5));
            const tw = Math.round(bw >= bh ? long : long * bw / bh), th = Math.round(bh > bw ? long : long * bh / bw);
            const reliefImg = opts.baseTextures.relief.image, g = this.app.meta.grid;
            const dw = g.nx * g.cell, dh = g.ny * g.cell;
            const sx = (vb[0] - g.x0) / dw * reliefImg.width, sy = (g.y1 - vb[3]) / dh * reliefImg.height;
            const sw = bw / dw * reliefImg.width, sh = bh / dh * reliefImg.height;
            const hiCv = await fetchOrtho(vb, tw, th, (i, n) => progress?.(`${opts.L.ex_p_background} ${i}/${n}`),
              (ctx, W2, H2) => ctx.drawImage(reliefImg, sx, sy, sw, sh, 0, 0, W2, H2));
            const hiTex = new THREE.CanvasTexture(hiCv);
            hiTex.colorSpace = THREE.NoColorSpace; hiTex.anisotropy = this.app.renderer.capabilities.getMaxAnisotropy();
            hiTex.minFilter = THREE.LinearMipmapLinearFilter; hiTex.generateMipmaps = true;
            const [lx0, ly0] = lake.toLocal(vb[0], vb[1]);
            tm.uBaseHi.value = hiTex; tm.uHiRect.value.set(lx0, ly0, bw, bh); tm.uHiOn.value = 1;
            tm.uBase.value = opts.baseTextures.ortho ?? opts.baseTextures.relief;
            this._hiTex = hiTex;
          } else {
            tm.uBase.value = opts.baseTextures[opts.background] ?? opts.baseTextures.relief;
            tm.uHiOn.value = 0;
          }
          tm.uBaseIsMap.value = 0; tm.uRecon.value = 0; tm.uOverlay.value = 0;
          tm.uLightK.value = isMap ? 0 : opts.background === "relief" ? 0.45 : opts.background === "ortho" ? 0.35 : 0.85;
          lake.update({ ...opts.baseState, t: T_NOW, regulated: false, frame: 0, overlay: 0, iso: false, exag: opts.exag });
          lake.water.visible = false; lake.terrain.visible = true; lake.terrainMat.colorWrite = true;
          bg = this.renderToCanvas(cam, opts.W, opts.H, opts.crop, { color: 0xffffff, alpha: 1 });
        }
        const name = `${stamp(0)}_background_${opts.background === "ortho" ? "aerial_today" : opts.background}.jpg`;
        files.push({ name, data: await blobBytes(await canvasBlob(bg, "image/jpeg", 0.92)) });
        if (isMap) files.push(...this.worldFiles(name, bbox, opts.W, opts.H, "jgw"));
        pctx.drawImage(bg, 0, 0, preview.width, preview.height);
      }

      // ---------------------------------------------------------------- water layers
      lake.terrain.visible = true; lake.terrainMat.colorWrite = false;   // depth only: hides water behind mountains
      tm.uHiOn.value = 0;
      lake.water.visible = true;
      wm.blending = THREE.NoBlending; wm.uniforms.uFlat.value = 1;
      wm.uniforms.uFlatAlpha.value = opts.fillAlpha;
      wm.uniforms.uOutlinePx.value = opts.outlinePx;
      const previews = [];
      for (let i = 0; i < opts.layers.length; i++) {
        const Ly = opts.layers[i];
        progress?.(`${opts.L.ex_p_layer} ${i + 1}/${opts.layers.length}: ${Ly.label}`);
        await new Promise((r) => setTimeout(r, 0));
        const st = { ...opts.baseState, frame: 0, overlay: 0, iso: false, exag: opts.exag, useLake2: opts.useLake2 };
        if (Ly.kind === "lrv" || Ly.kind === "hrv") Object.assign(st, { t: T_NOW, regulated: true, resLevel: Ly.level });
        else Object.assign(st, { t: Ly.kind === "natural" ? T_NOW : Ly.t, regulated: false });
        lake.update(st);
        const fill = hexToVec(Ly.color);
        wm.uniforms.uFlatColor.value.copy(fill);
        wm.uniforms.uOutlineColor.value.copy(fill).multiplyScalar(0.55);
        const cv = this.renderToCanvas(cam, opts.W, opts.H, opts.crop, { color: 0x000000, alpha: 0 });
        files.push({ name: Ly.file, data: await blobBytes(await canvasBlob(cv, "image/png")) });
        if (isMap) files.push(...this.worldFiles(Ly.file, bbox, opts.W, opts.H, "pgw"));
        const small = document.createElement("canvas"); small.width = preview.width; small.height = preview.height;
        small.getContext("2d").drawImage(cv, 0, 0, preview.width, preview.height);
        previews.push({ Ly, small });
      }
      const order = [...previews.filter((p) => p.Ly.kind !== "past"), ...previews.filter((p) => p.Ly.kind === "past").reverse()];
      pctx.globalAlpha = 0.6;
      for (const p of order) pctx.drawImage(p.small, 0, 0);
      pctx.globalAlpha = 1;

      progress?.(opts.L.ex_p_zip);
      files.push({ name: "preview_all_layers.jpg", data: await blobBytes(await canvasBlob(preview, "image/jpeg", 0.88)) });
      files.push({ name: "legend.svg", data: this.legendSvg(opts) });
      files.push({ name: "info.txt", data: this.infoText(opts, bbox, cam) });
      return makeZip(files);
    } finally {
      tm.uBase.value = saved.base; tm.uBaseIsMap.value = saved.isMap; tm.uLightK.value = saved.lightK; tm.uRecon.value = saved.recon;
      tm.uOverlay.value = saved.overlay; tm.uHiOn.value = saved.hiOn; tm.uBaseHi.value = saved.hiTex; tm.uHiRect.value.copy(saved.hiRect);
      wm.uniforms.uFlat.value = saved.flat; wm.blending = saved.blending; lake.terrainMat.colorWrite = saved.terrainColor;
      lake.terrain.visible = saved.terrainVis; lake.water.visible = saved.waterVis;
      this._hiTex?.dispose(); this._hiTex = null;
      this.app.hideExtras(false);
    }
  }

  worldFiles(name, bbox, W, H, ext) {
    const [x0, , x1, y1] = bbox, ys = (bbox[3] - bbox[1]) / H, xs = (x1 - x0) / W;
    const base = name.replace(/\.[^.]+$/, "");
    const wld = [xs, 0, 0, -ys, x0 + xs / 2, y1 - ys / 2].map((v) => v.toFixed(6)).join("\n") + "\n";
    return [{ name: `${base}.${ext}`, data: wld }, { name: `${base}.prj`, data: PRJ_25833 }];
  }

  legendSvg(opts) {
    const rowH = 34, w = 640, h = 44 + rowH * opts.layers.length + 30;
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const rows = opts.layers.map((Ly, i) => {
      const y = 44 + i * rowH;
      const c = new THREE.Color(Ly.color).multiplyScalar(0.55).getHexString();
      return `<rect x="16" y="${y}" width="44" height="22" rx="3" fill="${Ly.color}" fill-opacity="${opts.fillAlpha}" stroke="#${c}" stroke-width="2.5"/>` +
        `<text x="72" y="${y + 16}" font-size="15">${esc(Ly.label)}</text>`;
    }).join("\n");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="28" font-size="18" font-weight="600">${esc(opts.L.ex_legend_title)}</text>
${rows}
<text x="16" y="${h - 10}" font-size="11" fill="#555">${esc(opts.L.ex_legend_note)}</text>
</svg>`;
  }

  infoText(opts, bbox, cam) {
    const { model, meta } = this.app;
    const L = opts.L;
    const lines = [
      "Altevatnet — poster export",
      `Exported: ${new Date().toISOString()}`,
      `View: ${opts.mode === "map" ? "map (orthographic, north up = UTM grid north)" : "3D perspective"}  ·  ${opts.W} x ${opts.H} px  ·  vertical exaggeration ${opts.exag}x`,
      bbox ? `Extent EPSG:25833 (ETRS89 / UTM 33N): x ${bbox[0].toFixed(1)}–${bbox[2].toFixed(1)}, y ${bbox[1].toFixed(1)}–${bbox[3].toFixed(1)}  ·  ${((bbox[2] - bbox[0]) / opts.W).toFixed(3)} m/px` : "Extent: perspective view (not georeferenced)",
      bbox ? "World files (.pgw/.jgw) and .prj are included for GIS (EPSG:25833)." : "",
      `Model: U = r·F(t), tau = ${model.tau} yr, k = ${model.k}, deglaciation ${model.deglac} cal BP; heights NN2000.`,
      "",
      "Layers (bottom to top):",
      ...(opts.background !== "none" ? [`  00  background: ${opts.background === "ortho" ? "aerial photo of today (Norge i bilder)" : opts.background}`] : []),
      ...opts.layers.map((Ly) => `  ${Ly.file}  ${Ly.label}  [${Ly.color}]`),
      "",
      `Water style: fill opacity ${Math.round(opts.fillAlpha * 100)} %, outline ${opts.outlinePx} px (inside the shoreline). Leinavatnet ${opts.useLake2 ? "included" : "excluded"}.`,
      "All images share the same camera, crop and pixel size, so they register exactly when stacked.",
      "",
      "View code (paste into the export panel to restore this viewpoint):",
      opts.viewCode,
      "",
      "Credits / terms:",
      "  Aerial photo: © Norge i bilder (Kartverket, Geovekst og kommunene). Check the Norge i bilder terms before printing or publishing.",
      "  Terrain: Kartverket DTM (CC BY 4.0). Lake depth data and outlines: NVE (non-commercial use, not for navigation).",
      "  Land uplift: NKG2016LU. Reconstruction and model: https://github.com/ErikKjellis/lake-tilt",
      `  ${L.ex_caveat}`,
    ];
    void formatYear; void meta;
    return lines.filter((l) => l !== null).join("\r\n") + "\r\n";
  }
}
