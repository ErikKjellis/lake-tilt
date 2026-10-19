// Cultural heritage sites (Riksantikvaren) draped on the terrain:
//  - point markers, one colour and shape per category (circle, triangle, hexagon, square, diamond),
//    so they stay distinct in black-and-white print;
//  - when zoomed in: locality polygons (translucent fill + outline) and safety zones (dashed outline).
import * as THREE from "three";

export const KM_CATS = ["sami", "stone", "iron", "modern", "other"];
export const KM_COLOURS = ["#e63946", "#f4a261", "#2a9d8f", "#9d4edd", "#adb5bd"];
export const KM_SHAPES = ["circle", "triangle", "hexagon", "square", "diamond"];
export const KM_POLY_DIST = 8000;   // view distance (m) below which polygons and safety zones are shown

const RATE = /* glsl */ `
uniform float uRateC[6]; uniform vec2 uRateCentre; uniform float uRref;
uniform float uExag, uZBase, uFrame, uF;
uniform float uOn[5];
uniform float uFilter;      // 1: only the features selected by Askeladden ID (sel = 1), whatever their category
attribute float sel;
float rateAt(vec2 p){ vec2 q=(p-uRateCentre)/1000.0; return uRateC[0]+uRateC[1]*q.x+uRateC[2]*q.y+uRateC[3]*q.x*q.x+uRateC[4]*q.y*q.y+uRateC[5]*q.x*q.y; }
vec4 viewPos(vec3 p, float k) {
  float z = p.z - uFrame * (rateAt(p.xy) - uRref) * uF / 1000.0;
  vec4 mv = modelViewMatrix * vec4(p.xy, (z - uZBase) * uExag, 1.0);
  // keep it in front of the terrain facets: perspective = move along the view ray,
  // orthographic (map view) = move in depth only, so the map position is unchanged
  if (projectionMatrix[3][3] > 0.5) mv.z += (1.0 - k) * abs(mv.z); else mv.xyz *= k;
  return mv;
}
float catOn(float c) { int i = int(c + 0.5); return uOn[i]; }
bool shown(float c, float s) { return catOn(c) > 0.5 && (uFilter < 0.5 || s > 0.5); }
`;

const PTS_VS = /* glsl */ `
${RATE}
uniform float uSize;
attribute float cat;
varying float vCat;
void main() {
  gl_Position = projectionMatrix * viewPos(position, 0.996);
  gl_PointSize = shown(cat, sel) ? uSize : 0.0;
  vCat = cat;
}`;
const PTS_FS = /* glsl */ `
uniform vec3 uCol[5];
uniform vec3 uRim;
uniform float uPremul;
varying float vCat;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  int c = int(vCat + 0.5);
  float d;
  if (c == 0) d = length(q) - 0.80;                                                   // circle
  else if (c == 1) d = max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 0.45;                 // triangle
  else if (c == 2) d = max(abs(q.x) * 0.866 + abs(q.y) * 0.5, abs(q.y)) - 0.74;        // hexagon
  else if (c == 3) d = max(abs(q.x), abs(q.y)) - 0.68;                                // square
  else d = (abs(q.x) + abs(q.y)) / 1.414 - 0.62;                                       // diamond
  float aa = fwidth(d);
  float a = 1.0 - smoothstep(-aa, aa, d);
  float rim = smoothstep(-0.20 - aa, -0.20 + aa, d);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(mix(uCol[c], uRim, rim), a);
  gl_FragColor.rgb *= mix(1.0, a, uPremul);
}`;

const FILL_VS = /* glsl */ `
${RATE}
attribute float cat;
varying float vCat;
void main() {
  vCat = cat;
  gl_Position = shown(cat, sel) ? projectionMatrix * viewPos(position, 0.997) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FILL_FS = /* glsl */ `
uniform vec3 uCol[5];
uniform float uAlpha;
uniform float uPremul;
varying float vCat;
void main() { gl_FragColor = vec4(uCol[int(vCat + 0.5)] * mix(1.0, uAlpha, uPremul), uAlpha); }`;

const LINE_VS = /* glsl */ `
${RATE}
uniform vec2 uViewport;
uniform float uWidth;
attribute vec3 other;
attribute float side;
attribute float cat;
attribute float dist;
varying float vCat;
varying float vDist;
void main() {
  vec4 a = projectionMatrix * viewPos(position, 0.995), b = projectionMatrix * viewPos(other, 0.995);
  vec2 sa = a.xy / a.w * uViewport, sb = b.xy / b.w * uViewport;
  vec2 dir = normalize(sb - sa + vec2(1e-6));
  a.xy += vec2(-dir.y, dir.x) * side * uWidth / uViewport * a.w;
  vCat = cat; vDist = dist;
  gl_Position = shown(cat, sel) ? a : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const LINE_FS = /* glsl */ `
uniform vec3 uCol[5];
uniform float uDash;        // dash period in metres (0 = solid)
uniform float uLighten;
uniform float uAlpha;
uniform float uPremul;
varying float vCat;
varying float vDist;
void main() {
  if (uDash > 0.0 && fract(vDist / uDash) > 0.55) discard;
  gl_FragColor = vec4(mix(uCol[int(vCat + 0.5)], vec3(1.0), uLighten) * mix(1.0, uAlpha, uPremul), uAlpha);
}`;

const srgb = (hex) => { const c = new THREE.Color(hex).convertLinearToSRGB(); return new THREE.Vector3(c.r, c.g, c.b); };

/** Split triangles until no edge is longer than `maxLen` (so the polygon follows the terrain). */
function subdivide(tri, maxLen, out) {
  const [a, b, c] = tri;
  const l = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const lab = l(a, b), lbc = l(b, c), lca = l(c, a), m = Math.max(lab, lbc, lca);
  if (m <= maxLen) { out.push(a, b, c); return; }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (m === lab) { const d = mid(a, b); subdivide([a, d, c], maxLen, out); subdivide([d, b, c], maxLen, out); }
  else if (m === lbc) { const d = mid(b, c); subdivide([a, b, d], maxLen, out); subdivide([a, d, c], maxLen, out); }
  else { const d = mid(c, a); subdivide([a, b, d], maxLen, out); subdivide([d, b, c], maxLen, out); }
}

export class Heritage {
  constructor(lake, model, data) {
    this.lake = lake;
    this.model = model;
    this.data = data;
    this.sites = data.sites;
    this.zones = data.zones ?? [];
    this.on = [true, true, true, true, false];
    this.polyVisible = false;
    this.filter = false;          // true: only the sites selected by Askeladden ID are shown (see setSelection)
    this.selected = null;         // Uint8Array per site while the filter is on
    this.selLids = new Set();
    this.version = 0;             // counts changes of what is shown (the ID labels re-lay out on it)
    const common = {
      ...lake.uniformsCommon,
      uFilter: { value: 0 },
      uOn: { value: [1, 1, 1, 1, 0] },
      uCol: { value: KM_COLOURS.map(srgb) },
      uPremul: { value: 0 },
    };
    this.common = common;

    // ---- markers
    const n = this.sites.length;
    const pos = new Float32Array(n * 3), cat = new Float32Array(n);
    this.sites.forEach((s, i) => {
      s.i = i;
      const [X, Y] = lake.toLocal(s.x, s.y);
      s.X = X; s.Y = Y; s.h = lake.heightAtUtm(s.x, s.y); s.c = Math.max(0, KM_CATS.indexOf(s.cat));
      s.dr = model.dr(s.x, s.y);
      pos[3 * i] = X; pos[3 * i + 1] = Y; pos[3 * i + 2] = s.h; cat[i] = s.c;
      // screen-space picking data for the locality polygon (exterior rings, local coordinates)
      s.rings = (s.poly ?? []).map((p) => p[0].map(([x, y]) => [x - lake.ox, y - lake.oy, lake.heightAtUtm(x, y)]));
    });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    pg.setAttribute("cat", new THREE.BufferAttribute(cat, 1));
    pg.setAttribute("sel", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...common, uSize: { value: 11 }, uRim: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: PTS_VS, fragmentShader: PTS_FS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(pg, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.visible = false;

    // ---- locality polygons (fill + outline) and safety zones (dashed outline)
    this.polygons = new THREE.Group();
    this.polygons.visible = false;
    this.fill = this._fillMesh(this.sites.map((s) => ({ c: s.c, poly: s.poly ?? [] })));
    this.siteLines = this._lineMesh(this.sites.map((s) => ({ c: s.c, poly: s.poly ?? [] })), { dash: 0, lighten: 0, alpha: 0.95, width: 1.0 });
    this.zoneLines = this._lineMesh(this.zones.map((z) => ({ c: Math.max(0, KM_CATS.indexOf(z.cat)), poly: z.poly })), { dash: 2.0, lighten: 0.35, alpha: 0.9, width: 0.9 });
    this.polygons.add(this.fill, this.siteLines, this.zoneLines);
  }

  _fillMesh(items) {
    const L = this.lake, pos = [], cat = [], ranges = [];
    const addPoly = (poly, c) => {
      const contour = poly[0].map(([x, y]) => new THREE.Vector2(x, y));
      const holes = poly.slice(1).map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)));
      if (contour.length < 3) return;
      const pts = [...contour, ...holes.flat()];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
        const out = [];
        subdivide([[pts[i].x, pts[i].y], [pts[j].x, pts[j].y], [pts[k].x, pts[k].y]], 25, out);
        for (const [x, y] of out) { pos.push(x - L.ox, y - L.oy, L.heightAtUtm(x, y)); cat.push(c); }
      }
    };
    for (const it of items) {      // vertex range of every item, so setSelection can flag its vertices
      const v0 = cat.length;
      for (const poly of it.poly) addPoly(poly, it.c);
      ranges.push([v0, cat.length]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("cat", new THREE.Float32BufferAttribute(cat, 1));
    g.setAttribute("sel", new THREE.Float32BufferAttribute(new Float32Array(cat.length).fill(1), 1));
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...this.common, uAlpha: { value: 0.38 } },
      vertexShader: FILL_VS, fragmentShader: FILL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.renderOrder = 5;
    m.userData.ranges = ranges;
    return m;
  }

  _lineMesh(items, { dash, lighten, alpha, width }) {
    const L = this.lake, P = [], O = [], S = [], C = [], D = [], I = [], ranges = [];
    let v = 0;
    const seg = (p, q, c, d0, d1) => {
      // corners p+n, p-n, q-n, q+n (sides 1,-1,1,-1: the normal at q is computed from q->p)
      const corners = [[p, q, 1, d0], [p, q, -1, d0], [q, p, 1, d1], [q, p, -1, d1]];
      for (const [a, b, sd, dd] of corners) { P.push(...a); O.push(...b); S.push(sd); C.push(c); D.push(dd); }
      I.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    };
    const addRing = (ring, c) => {
      let dist = 0;
      const pts = [];
      for (let i = 0; i < ring.length; i++) {          // closed ring, densified every 10 m so it drapes
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
        for (let j = 0; j < k; j++) { const x = ax + (bx - ax) * j / k, y = ay + (by - ay) * j / k; pts.push([x - L.ox, y - L.oy, L.heightAtUtm(x, y)]); }
      }
      pts.push(pts[0]);
      for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        seg(pts[i], pts[i + 1], c, dist, dist + l);
        dist += l;
      }
    };
    for (const it of items) {      // vertex range of every item, so setSelection can flag its vertices
      const v0 = v;
      for (const poly of it.poly) for (const ring of poly) addRing(ring, it.c);
      ranges.push([v0, v]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("other", new THREE.Float32BufferAttribute(O, 3));
    g.setAttribute("side", new THREE.Float32BufferAttribute(S, 1));
    g.setAttribute("cat", new THREE.Float32BufferAttribute(C, 1));
    g.setAttribute("dist", new THREE.Float32BufferAttribute(D, 1));
    g.setAttribute("sel", new THREE.Float32BufferAttribute(new Float32Array(C.length).fill(1), 1));
    g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...this.common, uViewport: { value: new THREE.Vector2(1, 1) }, uWidth: { value: width },
        uDash: { value: dash }, uLighten: { value: lighten }, uAlpha: { value: alpha } },
      vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.renderOrder = 6;
    m.userData.baseWidth = width;
    m.userData.ranges = ranges;
    return m;
  }

  /** Premultiplied-alpha output (for rendering onto a transparent target, see PosterExporter). */
  setPremultiplied(on) {
    this.common.uPremul.value = on ? 1 : 0;
    for (const m of [this.material, this.fill.material, this.siteLines.material, this.zoneLines.material]) { m.premultipliedAlpha = on; m.needsUpdate = true; }
  }
  setCategories(on) { this.on = [...on]; this.common.uOn.value = this.on.map((v) => (v ? 1 : 0)); this.version++; }

  /**
   * Show only the sites selected by Askeladden ID (flags: Uint8Array per site), or all again (null).
   * While a selection is on, the category switches do not apply (the caller passes all categories on).
   */
  setSelection(flags) {
    this.filter = !!flags;
    this.selected = flags ?? null;
    this.common.uFilter.value = flags ? 1 : 0;
    const per = (i) => (flags ? flags[i] : 1);
    const pa = this.points.geometry.getAttribute("sel");
    for (let i = 0; i < this.sites.length; i++) pa.array[i] = per(i);
    pa.needsUpdate = true;
    this.selLids = new Set(flags ? this.sites.filter((s) => flags[s.i]).map((s) => s.lid) : []);
    const flag = (mesh, list) => {
      const a = mesh.geometry.getAttribute("sel");
      mesh.userData.ranges.forEach(([v0, v1], k) => a.array.fill(list(k), v0, v1));
      a.needsUpdate = true;
    };
    flag(this.fill, per);
    flag(this.siteLines, per);
    flag(this.zoneLines, (k) => (!flags || this.selLids.has(this.zones[k].lid) ? 1 : 0));
    this.version++;
  }
  /** Is the site drawn, given the category switches and the ID selection? */
  shows(s) { return !!this.on[s.c] && (!this.filter || !!this.selected[s.i]); }
  /** Categories (indices) that have at least one selected site; null without a selection. */
  selectedCategories() {
    if (!this.filter) return null;
    const cats = new Set();
    for (const s of this.sites) if (this.selected[s.i]) cats.add(s.c);
    return cats;
  }
  setSize(px) { this.material.uniforms.uSize.value = px; }
  /** Line widths in CSS px for the given viewport (and an optional scale, e.g. for poster export). */
  setViewport(w, h, scale = 1) {
    for (const m of [this.siteLines, this.zoneLines]) {
      m.material.uniforms.uViewport.value.set(w / 2, h / 2);
      m.material.uniforms.uWidth.value = m.userData.baseWidth * scale;
    }
  }
  /** Safety-zone dash length from the map scale (metres per CSS pixel), so dashes stay ~6 px on screen. */
  setScale(metresPerPx) { this.zoneLines.material.uniforms.uDash.value = Math.max(0.3, 9 * metresPerPx); }
  setVisible(on, polys) {
    this.points.visible = on;
    this.polyVisible = on && polys;
    this.polygons.visible = this.polyVisible;
  }

  _project(v, X, Y, h, F, state, camera) {
    return v.set(X, Y, (h - this.lake.zBase - state.frame * this.model.dr(X + this.lake.ox, Y + this.lake.oy) * F / 1000) * state.exag).project(camera);
  }

  /** Site under a screen position (CSS px): nearest marker, or (when polygons are shown) the polygon it is in. */
  pick(mx, my, camera, w, h, state, maxPx = 10) {
    if (!this.points.visible) return null;
    const F = this.model.F(state.t), v = new THREE.Vector3();
    let best = null, bd = maxPx * maxPx;
    for (const s of this.sites) {
      if (!this.shows(s)) continue;
      v.set(s.X, s.Y, (s.h - this.lake.zBase - state.frame * s.dr * F / 1000) * state.exag).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = { site: s, sx, sy }; }
    }
    if (best || !this.polyVisible) return best;
    for (const s of this.sites) {
      if (!this.shows(s)) continue;
      for (const ring of s.rings) {
        const scr = ring.map(([X, Y, hh]) => { this._project(v, X, Y, hh, F, state, camera); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z]; });
        if (scr.some((p) => p[2] > 1)) continue;
        let inside = false;
        for (let i = 0, j = scr.length - 1; i < scr.length; j = i++) {
          const [xi, yi] = scr[i], [xj, yj] = scr[j];
          if ((yi > my) !== (yj > my) && mx < ((xj - xi) * (my - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) return { site: s, sx: mx, sy: my };
      }
    }
    return null;
  }

  /**
   * Screen positions of the drawn sites for the ID labels: [{site, sx, sy, z}] in CSS px (or output px when the
   * camera has a view offset for an export). Sites behind the camera or outside the view are left out, and so
   * are sites hidden behind terrain (perspective camera; the map view looks straight down).
   * @param {{margin?: number, radiusPx?: number, viewH?: number}} [opt] margin: keep sites this far outside the
   *   view; radiusPx: radius of the marker symbol (a site is hidden only when even its upper edge is covered);
   *   viewH: height in px of the whole view when `h` is only a crop of it (poster export)
   */
  anchors(camera, w, h, state, { margin = 0, radiusPx = 4, viewH = h } = {}) {
    const F = this.model.F(state.t), L = this.lake, v = new THREE.Vector3(), out = [];
    const persp = camera.isPerspectiveCamera;
    camera.updateMatrixWorld();
    const cam = persp ? camera.getWorldPosition(new THREE.Vector3()) : null;
    const pxR = persp ? radiusPx * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / viewH : 0;   // view angle of the symbol radius
    for (const s of this.sites) {
      if (!this.shows(s)) continue;
      const z = (s.h - L.zBase - state.frame * s.dr * F / 1000) * state.exag;
      v.set(s.X, s.Y, z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
      if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;
      if (persp && this._hidden(cam, s.X, s.Y, z, state, F, pxR)) continue;
      out.push({ site: s, sx, sy, z: v.z });
    }
    return out;
  }

  /**
   * Is the point (local scene coordinates, already scaled in z) hidden from the camera by the terrain?
   * The marker is drawn at 99.6 % of its view ray (viewPos), so the sight line is followed to there. The
   * tolerance is the vertical equivalent of that bias, the mesh interpolation (about one exaggerated metre)
   * and the symbol's own radius: a marker whose upper edge still peeks out over the ridge keeps its label.
   * pxR is the view angle of the symbol radius in radians.
   */
  _hidden(cam, X, Y, Z, state, F, pxR) {
    const L = this.lake, dx = X - cam.x, dy = Y - cam.y, dz = Z - cam.z;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.min(300, Math.max(8, Math.ceil(dist / 80)));
    const base = state.exag + 0.004 * Math.abs(dz);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (t > 0.996) break;
      const ux = cam.x + dx * t + L.ox, uy = cam.y + dy * t + L.oy;
      const terr = (L.heightAtUtm(ux, uy) - L.zBase - state.frame * this.model.dr(ux, uy) * F / 1000) * state.exag;
      if (terr > cam.z + dz * t + base + pxR * dist * t) return true;
    }
    return false;
  }

  /** GeoJSON (EPSG:25833) for GIS / the poster ZIP: points, locality polygons or safety zones. */
  geojson(on, kind = "points") {
    const crs = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } };
    const props = (s) => ({ id: s.id, category: s.cat, name: s.name, type: s.art, dating: s.dating.join("; "), monuments: s.n, protection: s.vern, link: s.link });
    const mpoly = (poly) => ({ type: "MultiPolygon", coordinates: poly.map((p) => p.map((r) => [...r, r[0]])) });
    let features;
    const sel = (s) => !this.filter || !!this.selected[s.i];      // the ID selection, if any, narrows the export too
    if (kind === "points") features = this.sites.filter((s) => on[s.c] && sel(s)).map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.x, s.y] }, properties: props(s) }));
    else if (kind === "polygons") features = this.sites.filter((s) => on[s.c] && sel(s) && s.poly?.length).map((s) => ({ type: "Feature", geometry: mpoly(s.poly), properties: props(s) }));
    else features = this.zones.filter((z) => on[Math.max(0, KM_CATS.indexOf(z.cat))] && (!this.filter || this.selLids.has(z.lid))).map((z) => ({ type: "Feature", geometry: mpoly(z.poly), properties: { site: z.lid, category: z.cat } }));
    return JSON.stringify({ type: "FeatureCollection", crs, features, source: this.data.source, licence: this.data.licence });
  }
}
