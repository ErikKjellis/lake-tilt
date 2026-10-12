// Screen-space ribbons draped on the terrain: palaeo-shorelines (contoured on
// the CPU with marching squares over the cells that can ever be wet), today's
// shoreline, the national border and the profile track.
import * as THREE from "three";

const VS = /* glsl */ `
uniform float uRateC[6]; uniform vec2 uRateCentre; uniform float uRref;
uniform float uExag, uZBase, uFrame, uF;
uniform vec2 uViewport;
uniform float uWidth;
attribute vec3 other;
attribute float side;
attribute float age;      // 0 (oldest) .. 1 (youngest)
varying float vAge;
float rateAt(vec2 p){ vec2 q=(p-uRateCentre)/1000.0; return uRateC[0]+uRateC[1]*q.x+uRateC[2]*q.y+uRateC[3]*q.x*q.x+uRateC[4]*q.y*q.y+uRateC[5]*q.x*q.y; }
vec4 project(vec3 p) {
  float z = p.z - uFrame * (rateAt(p.xy) - uRref) * uF / 1000.0;
  vec4 mv = modelViewMatrix * vec4(p.xy, (z - uZBase) * uExag, 1.0);
  mv.xyz *= 0.995;   // pull towards the camera so the ribbon is not buried in the terrain facets
  return projectionMatrix * mv;
}
void main() {
  vec4 a = project(position), b = project(other);
  vec2 sa = a.xy / a.w * uViewport, sb = b.xy / b.w * uViewport;
  vec2 dir = normalize(sb - sa + vec2(1e-6));
  vec2 nrm = vec2(-dir.y, dir.x);
  a.xy += nrm * side * uWidth / uViewport * a.w;
  vAge = age;
  gl_Position = a;
}`;
const FS = /* glsl */ `
varying float vAge;
uniform float uAlpha;
uniform vec3 uColor;
uniform float uFixed;
void main() {
  vec3 c = uFixed > 0.5 ? uColor : mix(vec3(0.80, 0.45, 1.0), vec3(1.0, 0.86, 0.35), vAge);
  gl_FragColor = vec4(c, uAlpha);
}`;

/** Growable typed-array buffers for ribbon quads (one quad per segment). */
class RibbonBuffer {
  constructor() { this.n = 0; this.cap = 0; this._grow(4096); }
  _grow(quads) {
    const cap = Math.max(quads, this.cap * 2);
    const copy = (old, k) => { const a = new Float32Array(cap * 4 * k); if (old) a.set(old.subarray(0, this.n * 4 * k)); return a; };
    this.pos = copy(this.pos, 3); this.oth = copy(this.oth, 3); this.side = copy(this.side, 1); this.age = copy(this.age, 1);
    this.cap = cap;
  }
  /** Corners p+n, p-n, q-n, q+n, so triangles (0,1,2) and (0,2,3) share one winding.
   *  At q the shader's normal comes from q->p (reversed), hence sides (1,-1,1,-1). */
  add(px, py, pz, qx, qy, qz, ag) {
    if (this.n >= this.cap) this._grow(this.n + 1);
    const v = this.n * 4, P = this.pos, O = this.oth, sd = [1, -1, 1, -1];
    for (let k = 0; k < 4; k++) {
      const atP = k < 2, i3 = (v + k) * 3;
      P[i3] = atP ? px : qx; P[i3 + 1] = atP ? py : qy; P[i3 + 2] = atP ? pz : qz;
      O[i3] = atP ? qx : px; O[i3 + 1] = atP ? qy : py; O[i3 + 2] = atP ? qz : pz;
      this.side[v + k] = sd[k];
      this.age[v + k] = ag;
    }
    this.n++;
  }
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.n;
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, n * 12), 3));
    g.setAttribute("other", new THREE.BufferAttribute(this.oth.slice(0, n * 12), 3));
    g.setAttribute("side", new THREE.BufferAttribute(this.side.slice(0, n * 4), 1));
    g.setAttribute("age", new THREE.BufferAttribute(this.age.slice(0, n * 4), 1));
    const idx = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      const b = i * 4, o = i * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
}

export class Isochrones {
  constructor(lake, model, renderer, opts = {}) {
    this.lake = lake;
    this.model = model;
    this.renderer = renderer;
    // THREE.Color converts to linear; our shaders pass sRGB straight through
    const col = new THREE.Color(opts.color ?? "#ffffff").convertLinearToSRGB();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...lake.uniformsCommon, uViewport: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.6 }, uAlpha: { value: opts.alpha ?? 0.95 },
        uColor: { value: col }, uFixed: { value: opts.color ? 1 : 0 },
      },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 4;
    this.halfWidth = opts.halfWidth ?? 1.15;
    if (!opts.polylineOnly) this._prepare();
  }

  /** Grid cells whose 4 corners can ever be wet (dilated membership), with per-vertex data. */
  _prepare() {
    const L = this.lake, nx = L.nx, ny = L.ny;
    const member = new Uint8Array(nx * ny);
    for (const { a, b } of L.ivDil) for (let i = 0; i < a.length; i++) if (a[i] <= b[i]) member[i] = 1;
    const quads = [];
    for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
      const i = r * nx + c;
      if (member[i] && member[i + 1] && member[i + nx] && member[i + nx + 1]) quads.push(i);
    }
    const used = new Uint8Array(nx * ny);
    for (const i of quads) { used[i] = used[i + 1] = used[i + nx] = used[i + nx + 1] = 1; }
    const vids = [];
    for (let i = 0; i < used.length; i++) if (used[i]) vids.push(i);
    const slot = new Map();
    vids.forEach((i, k) => slot.set(i, k));
    // corner slots per quad in ring order (c, c+1, c+nx+1, c+nx)
    this.qslots = new Int32Array(quads.length * 4);
    quads.forEach((q, j) => {
      this.qslots[4 * j] = slot.get(q); this.qslots[4 * j + 1] = slot.get(q + 1);
      this.qslots[4 * j + 2] = slot.get(q + nx + 1); this.qslots[4 * j + 3] = slot.get(q + nx);
    });
    const nv = vids.length;
    this.nv = nv;
    this.dr = new Float32Array(nv); this.xy = new Float32Array(nv * 2); this.h = new Float32Array(nv);
    this.ivA = L.ivDil.map(() => new Float32Array(nv)); this.ivB = L.ivDil.map(() => new Float32Array(nv));
    vids.forEach((i, k) => {
      const r = Math.floor(i / nx), c = i - r * nx;
      const [X, Y] = L.vertexXY(r, c);
      this.xy[2 * k] = X; this.xy[2 * k + 1] = Y;
      const [x, y] = L.toUtm(X, Y);
      this.dr[k] = this.model.dr(x, y);
      this.h[k] = L.data.height[i];
      L.ivDil.forEach((iv, li) => { this.ivA[li][k] = iv.a[i]; this.ivB[li][k] = iv.b[i]; });
    });
    this.d = new Float32Array(nv);
  }

  /** Recompute the palaeo-shorelines for a list of times (cal BP). Returns label anchors. */
  build(times) {
    const m = this.model, nv = this.nv, d = this.d, xy = this.xy, H = this.h, qs = this.qslots;
    const buf = new RibbonBuffer();
    const labelPts = [];
    const ex = new Float64Array(12), S = new Int32Array(4), V = new Float64Array(4);
    times.forEach((t, k) => {
      const F = m.F(t);
      const lev = m.lakes.map((_, li) => m.level(li, F));
      for (let j = 0; j < nv; j++) {
        let level = -1e9;
        for (let li = 0; li < this.ivA.length; li++) {
          if (F >= this.ivA[li][j] && F <= this.ivB[li][j] && lev[li] > level) level = lev[li];
        }
        d[j] = level > -1e8 ? level + this.dr[j] * F / 1000 - H[j] : NaN;
      }
      const ag = times.length > 1 ? k / (times.length - 1) : 1;
      let best = -Infinity, bx = 0, by = 0, bz = 0;
      for (let q = 0; q < qs.length; q += 4) {
        S[0] = qs[q]; S[1] = qs[q + 1]; S[2] = qs[q + 2]; S[3] = qs[q + 3];
        V[0] = d[S[0]]; V[1] = d[S[1]]; V[2] = d[S[2]]; V[3] = d[S[3]];
        if (V[0] !== V[0] || V[1] !== V[1] || V[2] !== V[2] || V[3] !== V[3]) continue; // NaN: not a lake vertex
        const mask = (V[0] > 0 ? 1 : 0) | (V[1] > 0 ? 2 : 0) | (V[2] > 0 ? 4 : 0) | (V[3] > 0 ? 8 : 0);
        if (mask === 0 || mask === 15) continue;
        let np = 0;
        for (let e = 0; e < 4; e++) {
          const a = e, b = (e + 1) & 3;
          if ((V[a] > 0) !== (V[b] > 0)) {
            const f = V[a] / (V[a] - V[b]), sa = S[a], sb = S[b];
            ex[np * 3] = xy[2 * sa] + f * (xy[2 * sb] - xy[2 * sa]);
            ex[np * 3 + 1] = xy[2 * sa + 1] + f * (xy[2 * sb + 1] - xy[2 * sa + 1]);
            ex[np * 3 + 2] = H[sa] + f * (H[sb] - H[sa]);
            np++;
          }
        }
        if (np >= 2) buf.add(ex[0], ex[1], ex[2], ex[3], ex[4], ex[5], ag);
        if (np === 4) buf.add(ex[6], ex[7], ex[8], ex[9], ex[10], ex[11], ag);
        // label anchor: the most up-gradient (SSE, ~152 deg) point of this line
        const score = ex[0] * 0.47 - ex[1] * 0.88;
        if (score > best) { best = score; bx = ex[0]; by = ex[1]; bz = ex[2]; }
      }
      if (best > -Infinity) labelPts.push({ p: [bx, by, bz], t });
    });
    this.mesh.geometry.dispose();
    this.mesh.geometry = buf.geometry();
    return labelPts;
  }

  /** Drape EPSG:25833 polylines on the terrain (sampled every `step` metres). */
  buildFromPolylines(lines, step = 30) {
    const L = this.lake, buf = new RibbonBuffer();
    for (const line of lines) {
      let prev = null;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i], [bx, by] = line[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let k = i > 0 ? 1 : 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
          const [X, Y] = L.toLocal(x, y);
          const z = L.heightAtUtm(x, y);
          if (prev) buf.add(prev[0], prev[1], prev[2], X, Y, z, 1);
          prev = [X, Y, z];
        }
      }
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = buf.geometry();
  }

  setViewport(w, h) {
    this.material.uniforms.uViewport.value.set(w / 2, h / 2);
    this.material.uniforms.uWidth.value = this.halfWidth; // CSS px (half width)
  }
}
