import * as THREE from "three";

// ---------------------------------------------------------------------------
// Shared GLSL: present uplift rate r(x, y) from the quadratic fit.
const RATE_GLSL = /* glsl */ `
uniform float uRateC[6];
uniform vec2 uRateCentre;   // fit centre in local scene coordinates (m)
uniform float uRref;        // r at Luspi (mm/yr)
float rateAt(vec2 p) {
  vec2 q = (p - uRateCentre) / 1000.0;
  return uRateC[0] + uRateC[1]*q.x + uRateC[2]*q.y + uRateC[3]*q.x*q.x + uRateC[4]*q.y*q.y + uRateC[5]*q.x*q.y;
}
vec2 rateGrad(vec2 p) {   // mm/yr per metre
  vec2 q = (p - uRateCentre) / 1000.0;
  return vec2(uRateC[1] + 2.0*uRateC[3]*q.x + uRateC[5]*q.y, uRateC[2] + 2.0*uRateC[4]*q.y + uRateC[5]*q.x) / 1000.0;
}
`;

const TERRAIN_VS = /* glsl */ `
${RATE_GLSL}
attribute vec2 grad;
uniform float uExag, uZBase, uFrame, uF;
uniform vec4 uExtent;       // xmin, ymin, width, height (local)
varying vec2 vUv;
varying vec3 vN;
varying float vDr;
varying vec2 vXY;
varying float vH;
void main() {
  vec2 p = position.xy;
  float dr = rateAt(p) - uRref;
  float z = position.z - uFrame * dr * uF / 1000.0;
  vec2 g = grad - uFrame * rateGrad(p) * uF / 1000.0;
  vN = normalize(vec3(-g * uExag, 1.0));
  vDr = dr; vXY = p; vH = position.z;
  vUv = (p - uExtent.xy) / uExtent.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, (z - uZBase) * uExag, 1.0);
}
`;

const TERRAIN_FS = /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uBaseHi;   // optional high-resolution map for part of the area (poster export)
uniform vec4 uHiRect;        // its extent in local coordinates: x0, y0, w, h
uniform float uHiOn;
uniform sampler2D uMask;
uniform vec3 uSun;
uniform float uLightK;      // strength of 3D lighting (relief basemap already shaded)
uniform float uBaseIsMap;   // 1: topo/grey/ortho -> repaint reservoir area
uniform float uRecon;       // hatch reconstructed lake floor
uniform float uRegulated;   // today's reservoir shown
uniform int uOverlay;       // 0 none, 1 uplift since t (m), 2 present rate (mm/yr)
uniform float uF;
uniform float uRref;
uniform vec2 uOvRange;      // colour range
uniform float uOvSign;      // +1 past, -1 future (show uplift as positive)
uniform float uOvStep;      // contour interval
varying vec2 vUv;
varying vec3 vN;
varying float vDr;
varying vec2 vXY;
varying float vH;

vec3 turbo(float x) {       // compact polynomial approximation of 'turbo'
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x*x, x*x*x); vec2 v2 = v4.zw * v4.z;
  return vec3(
    dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
    dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973)));
}
vec3 diverge(float x) {     // blue - white - red, x in [-1, 1]
  vec3 b = vec3(0.19, 0.42, 0.75), w = vec3(0.96, 0.95, 0.92), r = vec3(0.80, 0.26, 0.20);
  return x < 0.0 ? mix(w, b, clamp(-x, 0.0, 1.0)) : mix(w, r, clamp(x, 0.0, 1.0));
}
float aaLine(float v, float width) {
  float w = fwidth(v) * width;
  return 1.0 - smoothstep(0.0, max(w, 1e-12), abs(v));
}
float gridLine(float x, float width) {   // derivative of the continuous value, not of fract()
  float w = max(fwidth(x) * width, 1e-6);
  return 1.0 - smoothstep(0.0, w, abs(fract(x + 0.5) - 0.5));
}
void main() {
  vec4 m = texture2D(uMask, vUv);
  vec3 col = texture2D(uBase, vUv).rgb;
  // sample unconditionally (implicit derivatives need uniform control flow), then select
  vec2 uh = (vXY - uHiRect.xy) / uHiRect.zw;
  vec3 hi = texture2D(uBaseHi, clamp(uh, 0.0, 1.0)).rgb;
  float inHi = uHiOn * step(0.0, uh.x) * step(uh.x, 1.0) * step(0.0, uh.y) * step(uh.y, 1.0);
  col = mix(col, hi, inHi);
  float reservoir = step(0.5, m.r);
  float surveyLake = step(0.5, m.g);
  float flooded = step(0.5, m.b);
  // Kartverket maps draw today's reservoir as water: repaint it neutral in the natural view.
  // The aerial photo (uBaseIsMap = 2) is shown as it is.
  if (uBaseIsMap > 0.5 && uBaseIsMap < 1.5 && uRegulated < 0.5 && reservoir > 0.5) {
    col = surveyLake > 0.5 ? vec3(0.62, 0.66, 0.66) : vec3(0.80, 0.78, 0.71);
  }
  float diff = max(dot(normalize(vN), uSun), 0.0);
  float shade = mix(1.0, 0.45 + 0.75 * diff, uLightK);
  col *= shade;

  if (uRecon > 0.5 && uRegulated < 0.5 && flooded > 0.5) {
    float h = fract((vXY.x + vXY.y) / 240.0);
    float hatch = 1.0 - smoothstep(0.0, 0.10, abs(h - 0.5) * 2.0 - 0.92);
    hatch *= 1.0 - smoothstep(0.15, 0.4, fwidth((vXY.x + vXY.y) / 240.0));
    col = mix(col, vec3(0.98, 0.82, 0.45), 0.30 * hatch);
  }

  if (uOverlay == 1) {
    float du = uOvSign * vDr * uF / 1000.0;
    vec3 oc = diverge(du >= 0.0 ? du / max(uOvRange.y, 1e-3) : du / max(-uOvRange.x, 1e-3));
    col = mix(col, oc * (0.55 + 0.45 * shade), 0.48);
    float l = gridLine(du / uOvStep, 1.2);
    col = mix(col, vec3(0.1), 0.55 * l);
    col = mix(col, vec3(0.0), 0.8 * aaLine(du, 1.6));
  } else if (uOverlay == 2) {
    float r = vDr + uRref;
    vec3 oc = turbo((r - uOvRange.x) / (uOvRange.y - uOvRange.x));
    col = mix(col, oc * (0.55 + 0.45 * shade), 0.55);
    float l = gridLine(r / uOvStep, 1.2);
    col = mix(col, vec3(0.08), 0.5 * l);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const WATER_VS = /* glsl */ `
${RATE_GLSL}
attribute vec2 iv0;
attribute vec2 iv1;
attribute vec2 iv2;
attribute float resv;
uniform float uExag, uZBase, uFrame, uF;
uniform vec3 uS;            // palaeo levels of the three tracked lakes
uniform float uRegulated;
uniform float uHRV;          // reservoir water level when regulated (HRV or LRV)
uniform float uUseLake2;     // include Leinavatnet (third tracked lake)
varying float vDepth;
varying vec3 vWorld;
void main() {
  vec2 p = position.xy;
  float h = position.z;
  float dr = rateAt(p) - uRref;
  float W;
  float depth;
  if (uRegulated > 0.5) {
    if (resv > 0.5) { W = uHRV; depth = W - h; }
    else if (uUseLake2 > 0.5 && uF >= iv2.x && uF <= iv2.y) { W = uS.z + dr * uF / 1000.0; depth = W - h; }
    else { W = h; depth = -100.0; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, (W - uZBase) * uExag, 1.0);
  } else {
    float level = -1.0e9;
    if (uF >= iv0.x && uF <= iv0.y) level = max(level, uS.x);
    if (uF >= iv1.x && uF <= iv1.y) level = max(level, uS.y);
    if (uUseLake2 > 0.5 && uF >= iv2.x && uF <= iv2.y) level = max(level, uS.z);
    bool known = level > -1.0e8;
    W = known ? level + dr * uF / 1000.0 : h;   // park vertices without a lake on the ground
    depth = known ? W - h : -100.0;
    float zf = W - uFrame * dr * uF / 1000.0;   // flat in the palaeo frame
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, (zf - uZBase) * uExag, 1.0);
  }
  vDepth = depth;
  vWorld = (modelMatrix * vec4(p, 0.0, 1.0)).xyz;
}
`;

const WATER_FS = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uFlat;         // poster export: flat fill + outline
uniform vec3 uFlatColor;
uniform float uFlatAlpha;
uniform float uOutlinePx;
uniform vec3 uOutlineColor;
varying float vDepth;
varying vec3 vWorld;
void main() {
  float d = vDepth;
  float w = fwidth(d);        // before discard: derivatives need uniform control flow
  if (d <= 0.0) discard;
  if (uFlat > 0.5) {
    // outline = band of uOutlinePx pixels inside the shoreline (w = depth change per pixel)
    float band = uOutlinePx > 0.0 ? 1.0 - smoothstep(uOutlinePx * w - 0.5 * w, uOutlinePx * w + 0.5 * w, d) : 0.0;
    gl_FragColor = vec4(mix(uFlatColor, uOutlineColor, band), mix(uFlatAlpha, 1.0, band));
    return;
  }
  vec3 shallow = vec3(0.42, 0.78, 0.84);
  vec3 deep = vec3(0.03, 0.16, 0.30);
  vec3 col = mix(shallow, deep, 1.0 - exp(-d / 22.0));
  float alpha = mix(0.55, 0.93, 1.0 - exp(-d / 6.0));
  // gentle ripples for the specular highlight
  vec2 q = vWorld.xy / 90.0;
  vec3 n = normalize(vec3(0.035 * sin(q.x * 1.7 + uTime * 0.6) + 0.025 * sin(q.y * 2.3 - uTime * 0.4),
                          0.03 * cos(q.y * 1.9 + uTime * 0.5) + 0.02 * cos(q.x * 2.9 - uTime * 0.3), 1.0));
  vec3 v = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 hlf = normalize(uSun + v);
  float spec = pow(max(dot(n, hlf), 0.0), 120.0);
  col = mix(col, vec3(0.80, 0.88, 0.95), 0.35 * fres) + 0.5 * spec;
  // bright line at the shore
  float shore = 1.0 - smoothstep(0.0, 2.0 * w + 0.15, d);
  col = mix(col, vec3(0.92, 0.98, 1.0), 0.75 * shore);
  alpha = max(alpha, 0.9 * shore);
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------

export class LakeScene {
  /**
   * @param {object} data   result of loadScene()
   * @param {UpliftModel} model
   */
  constructor(data, model, stride = 1) {
    this.data = data;
    this.model = model;
    const g = data.meta.grid;
    this.nx = g.nx; this.ny = g.ny; this.cell = g.cell;
    this.x0 = g.x0; this.y1 = g.y1;
    this.width = g.nx * g.cell; this.heightM = g.ny * g.cell;
    // local origin = centre of the render window
    this.ox = g.x0 + this.width / 2;
    this.oy = g.y1 - this.heightM / 2;
    this.zBase = data.meta.natural_level_m;
    // colour range of the uplift-rate overlay (mm/yr), rounded outwards to 0.1
    const rr = data.meta.rate_range ?? [4.0, 5.4];
    this.rateRange = [Math.floor(rr[0] * 10) / 10, Math.ceil(rr[1] * 10) / 10];
    this.group = new THREE.Group();
    this._buildIntervals();
    this.textures = {};
    this.uniformsCommon = this._commonUniforms();
    this.buildTerrain(stride);
    this.buildWater();
  }

  /** local scene coordinates <-> EPSG:25833 */
  toLocal(x, y) { return [x - this.ox, y - this.oy]; }
  toUtm(X, Y) { return [X + this.ox, Y + this.oy]; }
  vertexXY(r, c) { return [this.x0 + (c + 0.5) * this.cell - this.ox, this.y1 - (r + 0.5) * this.cell - this.oy]; }

  heightAtUtm(x, y) {
    const c = (x - this.x0) / this.cell - 0.5, r = (this.y1 - y) / this.cell - 0.5;
    const c0 = Math.max(0, Math.min(this.nx - 2, Math.floor(c))), r0 = Math.max(0, Math.min(this.ny - 2, Math.floor(r)));
    const fc = Math.min(1, Math.max(0, c - c0)), fr = Math.min(1, Math.max(0, r - r0));
    const H = this.data.height, nx = this.nx;
    const a = H[r0 * nx + c0], b = H[r0 * nx + c0 + 1], cc = H[(r0 + 1) * nx + c0], d = H[(r0 + 1) * nx + c0 + 1];
    return (a * (1 - fc) + b * fc) * (1 - fr) + (cc * (1 - fc) + d * fc) * fr;
  }

  _commonUniforms() {
    const m = this.model;
    const [cx, cy] = this.toLocal(m.cx, m.cy);
    return {
      uRateC: { value: m.coef.slice() },
      uRateCentre: { value: new THREE.Vector2(cx, cy) },
      uRref: { value: m.rRef },
      uExag: { value: 3 },
      uZBase: { value: this.zBase },
      uFrame: { value: 0 },
      uF: { value: 0 },
      uSun: { value: new THREE.Vector3(-0.55, 0.55, 0.63).normalize() },
    };
  }

  /** Per-vertex wet intervals: dense per lake (for water) and union (for shorelines). */
  _buildIntervals() {
    const n = this.nx * this.ny;
    const BIG = 1e9;
    this.iv = this.data.lakes.map((L) => {
      const a = new Float32Array(n).fill(BIG), b = new Float32Array(n).fill(-BIG);
      for (let i = 0; i < L.idx.length; i++) { a[L.idx[i]] = L.a[i]; b[L.idx[i]] = L.b[i]; }
      return { a, b };
    });
    // dilated per-lake intervals (3x3) so shore vertices just above water still know the lake level
    const nx = this.nx, ny = this.ny;
    this.ivDil = this.iv.map(({ a, b }) => {
      const da = new Float32Array(a), db = new Float32Array(b);
      for (let pass = 0; pass < 1; pass++) {
        const sa = new Float32Array(da), sb = new Float32Array(db);
        for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
          const i = r * nx + c;
          if (sa[i] > sb[i] && !hasNeighbourInterval(sa, sb, r, c, nx, ny)) continue;
          let mn = sa[i], mx = sb[i];
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= ny || cc < 0 || cc >= nx) continue;
            const j = rr * nx + cc;
            if (sa[j] <= sb[j]) { if (sa[j] < mn) mn = sa[j]; if (sb[j] > mx) mx = sb[j]; }
          }
          da[i] = mn; db[i] = mx;
        }
      }
      return { a: da, b: db };
    });
    // reservoir flag per vertex from the 20 m mask (R channel)
    const { maskData, maskW, maskH } = this.data;
    const resv = new Uint8Array(n);
    const k = maskW / nx;
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const mr = Math.min(maskH - 1, Math.floor((r + 0.5) * k)), mc = Math.min(maskW - 1, Math.floor((c + 0.5) * k));
      resv[r * nx + c] = maskData[(mr * maskW + mc) * 4] > 127 ? 1 : 0;
    }
    this.resv = resv;
    this.data.maskData = null; // 33 MB, no longer needed
  }

  buildTerrain(stride) {
    if (this.terrain) { this.group.remove(this.terrain); this.terrain.geometry.dispose(); }
    const s = stride, nx = this.nx, ny = this.ny, H = this.data.height;
    const cols = Math.floor((nx - 1) / s) + 1, rows = Math.floor((ny - 1) / s) + 1;
    const nv = cols * rows;
    const pos = new Float32Array(nv * 3), grad = new Float32Array(nv * 2);
    const cell = this.cell;
    let k = 0;
    for (let rr = 0; rr < rows; rr++) {
      const r = rr * s;
      for (let cc = 0; cc < cols; cc++, k++) {
        const c = cc * s, i = r * nx + c;
        const [X, Y] = this.vertexXY(r, c);
        pos[3 * k] = X; pos[3 * k + 1] = Y; pos[3 * k + 2] = H[i];
        const cl = Math.max(0, c - s), cr = Math.min(nx - 1, c + s), ru = Math.max(0, r - s), rd = Math.min(ny - 1, r + s);
        grad[2 * k] = (H[r * nx + cr] - H[r * nx + cl]) / ((cr - cl) * cell);
        grad[2 * k + 1] = (H[ru * nx + c] - H[rd * nx + c]) / ((rd - ru) * cell);
      }
    }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let t = 0;
    for (let rr = 0; rr < rows - 1; rr++) for (let cc = 0; cc < cols - 1; cc++) {
      const a = rr * cols + cc, b = a + 1, c = a + cols, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("grad", new THREE.BufferAttribute(grad, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(this.width, this.heightM));
    if (!this.terrainMat) {
      const [ex, ey] = this.vertexXY(this.ny - 1, 0);
      this.terrainMat = new THREE.ShaderMaterial({
        uniforms: {
          ...this.uniformsCommon,
          uExtent: { value: new THREE.Vector4(this.x0 - this.ox, this.y1 - this.heightM - this.oy, this.width, this.heightM) },
          uBase: { value: null },
          uMask: { value: null },
          uBaseHi: { value: null },
          uHiRect: { value: new THREE.Vector4(0, 0, 1, 1) },
          uHiOn: { value: 0 },
          uLightK: { value: 0.55 },
          uBaseIsMap: { value: 0 },
          uRecon: { value: 1 },
          uRegulated: { value: 0 },
          uOverlay: { value: 0 },
          uOvRange: { value: new THREE.Vector2(-1, 1) },
          uOvStep: { value: 1 },
          uOvSign: { value: 1 },
        },
        vertexShader: TERRAIN_VS,
        fragmentShader: TERRAIN_FS,
        extensions: {},
      });
      void ex; void ey;
    }
    // the GPU keeps its copy; drop the ~90 MB of CPU-side arrays after upload
    for (const att of [...Object.values(geo.attributes), geo.index]) att.onUpload(function () { this.array = null; });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.terrain.frustumCulled = false;
    this.terrain.renderOrder = 0;
    this.group.add(this.terrain);
    this.stride = s;
  }

  buildWater() {
    const nx = this.nx, ny = this.ny, n = nx * ny, H = this.data.height;
    const member = new Uint8Array(n);
    for (const { a, b } of this.ivDil) for (let i = 0; i < n; i++) if (a[i] <= b[i]) member[i] = 1;
    // reservoir cells + one ring
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      if (!this.resv[r * nx + c]) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < ny && cc >= 0 && cc < nx) member[rr * nx + cc] = 1;
      }
    }
    const remap = new Int32Array(n).fill(-1);
    const quads = [];
    for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c, b = a + 1, cc = a + nx, d = cc + 1;
      if (member[a] && member[b] && member[cc] && member[d]) quads.push(a);
    }
    let nv = 0;
    const touch = (i) => { if (remap[i] < 0) remap[i] = nv++; return remap[i]; };
    const idx = new Uint32Array(quads.length * 6);
    let t = 0;
    for (const a of quads) {
      const b = a + 1, c = a + nx, d = c + 1;
      const A = touch(a), B = touch(b), C = touch(c), D = touch(d);
      idx[t++] = A; idx[t++] = C; idx[t++] = B; idx[t++] = B; idx[t++] = C; idx[t++] = D;
    }
    const pos = new Float32Array(nv * 3), resv = new Float32Array(nv);
    const ivs = [0, 1, 2].map(() => new Float32Array(nv * 2));
    for (let i = 0; i < n; i++) {
      const k = remap[i];
      if (k < 0) continue;
      const r = Math.floor(i / nx), c = i - r * nx;
      const [X, Y] = this.vertexXY(r, c);
      pos[3 * k] = X; pos[3 * k + 1] = Y; pos[3 * k + 2] = H[i];
      resv[k] = this.resv[i];
      for (let li = 0; li < 3; li++) {
        const L = this.ivDil[li] || { a: [1e9], b: [-1e9] };
        ivs[li][2 * k] = L.a[i] ?? 1e9; ivs[li][2 * k + 1] = L.b[i] ?? -1e9;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("iv0", new THREE.BufferAttribute(ivs[0], 2));
    geo.setAttribute("iv1", new THREE.BufferAttribute(ivs[1], 2));
    geo.setAttribute("iv2", new THREE.BufferAttribute(ivs[2], 2));
    geo.setAttribute("resv", new THREE.BufferAttribute(resv, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(this.width, this.heightM));
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniformsCommon,
        uS: { value: new THREE.Vector3() },
        uRegulated: { value: 0 },
        uHRV: { value: this.data.meta.regulated.hrv_m },
        uUseLake2: { value: 1 },
        uFlat: { value: 0 },
        uFlatColor: { value: new THREE.Vector3(0.1, 0.4, 0.8) },
        uFlatAlpha: { value: 1 },
        uOutlinePx: { value: 0 },
        uOutlineColor: { value: new THREE.Vector3(0, 0, 0) },
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      transparent: true,
      depthWrite: false,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.frustumCulled = false;
    this.water.renderOrder = 2;
    this.group.add(this.water);
    this.waterInfo = { vertices: nv, triangles: quads.length * 2 };
  }

  setTexture(name, tex) { this.terrainMat.uniforms[name].value = tex; }

  /** Update all time/model dependent uniforms. */
  update(state) {
    const m = this.model;
    const F = m.F(state.t);
    const u = this.uniformsCommon;
    u.uF.value = F;
    u.uExag.value = state.exag;
    u.uFrame.value = state.frame;
    this.waterMat.uniforms.uS.value.set(m.level(0, F), m.level(1, F), m.level(2, F));
    this.waterMat.uniforms.uRegulated.value = state.regulated ? 1 : 0;
    this.waterMat.uniforms.uHRV.value = state.resLevel ?? this.data.meta.regulated.hrv_m;
    this.waterMat.uniforms.uUseLake2.value = state.useLake2 === false ? 0 : 1;
    const tu = this.terrainMat.uniforms;
    tu.uRegulated.value = state.regulated ? 1 : 0;
    tu.uOverlay.value = state.overlay;
    tu.uRecon.value = state.recon ? 1 : 0;
    if (state.overlay === 1) {
      const span = Math.max(1, Math.abs(F) * 1.0 / 1000);
      tu.uOvRange.value.set(-0.35 * span, span);
      tu.uOvSign.value = F < 0 ? -1 : 1;
      const raw = span / 6, steps = [0.1, 0.2, 0.5, 1, 2, 5, 10];
      tu.uOvStep.value = steps.find((v) => v >= raw) ?? 10;
    } else if (state.overlay === 2) {
      tu.uOvRange.value.set(...this.rateRange);
      tu.uOvStep.value = 0.1;
    }
    return F;
  }

}

function hasNeighbourInterval(a, b, r, c, nx, ny) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= ny || cc < 0 || cc >= nx) continue;
    const j = rr * nx + cc;
    if (a[j] <= b[j]) return true;
  }
  return false;
}
