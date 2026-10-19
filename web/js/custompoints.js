// Own points: locations typed in by the user as coordinates (e.g. cultural heritage sites with restricted access,
// "begrenset offentlighet", that the open API does not deliver). Drawn like the heritage markers, draped on the
// terrain, as a yellow plus sign so that they cannot be mistaken for any of the heritage categories.
// The coordinates stay in the browser: nothing is sent anywhere.
import * as THREE from "three";
import { RATE_CORE, anchorList } from "./heritage.js";

export const PT_COLOUR = "#ffd60a";

const VS = /* glsl */ `
${RATE_CORE}
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * viewPos(position, 0.995);
  gl_PointSize = uSize;
}`;
const FS = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uRim;
uniform float uPremul;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  float d = min(max(abs(q.x) - 0.36, abs(q.y) - 0.90), max(abs(q.x) - 0.90, abs(q.y) - 0.36));   // plus sign
  float aa = fwidth(d);
  float a = 1.0 - smoothstep(-aa, aa, d);
  float rim = smoothstep(-0.17 - aa, -0.17 + aa, d);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(mix(uCol, uRim, rim), a);
  gl_FragColor.rgb *= mix(1.0, a, uPremul);
}`;

const srgb = (hex) => { const c = new THREE.Color(hex).convertLinearToSRGB(); return new THREE.Vector3(c.r, c.g, c.b); };

export class CustomPoints {
  constructor(lake, model) {
    this.lake = lake;
    this.model = model;
    this.items = [];          // drawn points: {x, y, label, line, X, Y, h, dr}
    this.outside = [];        // typed points outside this scene's render window
    this.version = 0;         // counts changes (the labels re-lay out on it)
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...lake.uniformsCommon, uSize: { value: 13 }, uCol: { value: srgb(PT_COLOUR) }, uRim: { value: new THREE.Vector3(1, 1, 1) }, uPremul: { value: 0 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
    this.set([]);
  }

  get count() { return this.items.length; }

  /** Is (x, y) in EPSG:25833 inside the render window of the scene? */
  contains(x, y) {
    const L = this.lake;
    return x >= L.x0 && x <= L.x0 + L.width && y >= L.y1 - L.heightM && y <= L.y1;
  }

  /** Replace the points: [{x, y, label, line}] in EPSG:25833. Points outside the render window are not drawn. */
  set(list) {
    const L = this.lake;
    this.items = []; this.outside = [];
    for (const p of list) {
      if (!this.contains(p.x, p.y)) { this.outside.push(p); continue; }
      const [X, Y] = L.toLocal(p.x, p.y);
      this.items.push({ ...p, X, Y, h: L.heightAtUtm(p.x, p.y), dr: this.model.dr(p.x, p.y) });
    }
    const pos = new Float32Array(this.items.length * 3);
    this.items.forEach((s, i) => { pos[3 * i] = s.X; pos[3 * i + 1] = s.Y; pos[3 * i + 2] = s.h; });
    this.points.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.points.geometry = g;
    this.version++;
  }

  setSize(px) { this.material.uniforms.uSize.value = px; }
  get size() { return this.material.uniforms.uSize.value; }
  setPremultiplied(on) { this.material.uniforms.uPremul.value = on ? 1 : 0; this.material.premultipliedAlpha = on; this.material.needsUpdate = true; }

  /** Screen positions for the labels: [{site, sx, sy, z}] (the item is called `site`, as for the heritage sites; see anchorList). */
  anchors(camera, w, h, state, opt) {
    return anchorList(this.lake, this.model, this.items, camera, w, h, state, opt);
  }

  /** The point nearest to a screen position (CSS px) within maxPx, or null. */
  pick(mx, my, camera, w, h, state, maxPx = 10) {
    if (!this.points.visible || !this.items.length) return null;
    const F = this.model.F(state.t), v = new THREE.Vector3();
    let best = null, bd = maxPx * maxPx;
    for (const s of this.items) {
      v.set(s.X, s.Y, (s.h - this.lake.zBase - state.frame * s.dr * F / 1000) * state.exag).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h, d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = { point: s, sx, sy }; }
    }
    return best;
  }

  /** GeoJSON (EPSG:25833) for GIS / the poster ZIP. */
  geojson() {
    const crs = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } };
    const features = this.items.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [Math.round(s.x * 100) / 100, Math.round(s.y * 100) / 100] }, properties: { label: s.label } }));
    return JSON.stringify({ type: "FeatureCollection", crs, features, source: "Entered by the user (not from an open data source)" });
  }
}
