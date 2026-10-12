// Cultural heritage sites (Riksantikvaren) as point markers draped on the terrain.
// Categories: 0 Sami, 1 Stone Age, 2 modern, 3 other/undated. Each has its own colour and shape
// (circle, triangle, square, diamond) so they stay distinct in black-and-white print.
import * as THREE from "three";

export const KM_CATS = ["sami", "stone", "modern", "other"];
export const KM_COLOURS = ["#e63946", "#f4a261", "#9d4edd", "#adb5bd"];
export const KM_SHAPES = ["circle", "triangle", "square", "diamond"];

const VS = /* glsl */ `
uniform float uRateC[6]; uniform vec2 uRateCentre; uniform float uRref;
uniform float uExag, uZBase, uFrame, uF;
uniform float uSize;
uniform vec4 uOn;
attribute float cat;
varying float vCat;
float rateAt(vec2 p){ vec2 q=(p-uRateCentre)/1000.0; return uRateC[0]+uRateC[1]*q.x+uRateC[2]*q.y+uRateC[3]*q.x*q.x+uRateC[4]*q.y*q.y+uRateC[5]*q.x*q.y; }
void main() {
  vec2 p = position.xy;
  float z = position.z - uFrame * (rateAt(p) - uRref) * uF / 1000.0;
  vec4 mv = modelViewMatrix * vec4(p, (z - uZBase) * uExag, 1.0);
  // keep it in front of the terrain facets: perspective = move along the view ray,
  // orthographic (map view) = move in depth only, so the map position is unchanged
  if (projectionMatrix[3][3] > 0.5) mv.z += (1.0 - 0.996) * abs(mv.z); else mv.xyz *= 0.996;
  gl_Position = projectionMatrix * mv;
  float on = cat < 0.5 ? uOn.x : cat < 1.5 ? uOn.y : cat < 2.5 ? uOn.z : uOn.w;
  gl_PointSize = on > 0.5 ? uSize : 0.0;
  vCat = cat;
}`;
const FS = /* glsl */ `
uniform vec3 uCol[4];
uniform vec3 uRim;
varying float vCat;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  int c = int(vCat + 0.5);
  float d;
  if (c == 0) d = length(q) - 0.80;                                         // circle
  else if (c == 1) d = max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 0.45;       // triangle
  else if (c == 2) d = max(abs(q.x), abs(q.y)) - 0.68;                      // square
  else d = (abs(q.x) + abs(q.y)) / 1.414 - 0.62;                             // diamond
  float aa = fwidth(d);
  float a = 1.0 - smoothstep(-aa, aa, d);
  float rim = smoothstep(-0.20 - aa, -0.20 + aa, d);   // outline band inside the edge
  if (a <= 0.001) discard;
  gl_FragColor = vec4(mix(uCol[c], uRim, rim), a);
}`;

const srgb = (hex) => { const c = new THREE.Color(hex).convertLinearToSRGB(); return new THREE.Vector3(c.r, c.g, c.b); };

export class Heritage {
  constructor(lake, model, data) {
    this.lake = lake;
    this.model = model;
    this.data = data;
    this.sites = data.sites;
    const n = this.sites.length;
    const pos = new Float32Array(n * 3), cat = new Float32Array(n);
    this.sites.forEach((s, i) => {
      const [X, Y] = lake.toLocal(s.x, s.y);
      s.X = X; s.Y = Y; s.h = lake.heightAtUtm(s.x, s.y); s.c = Math.max(0, KM_CATS.indexOf(s.cat));
      s.dr = model.dr(s.x, s.y);
      pos[3 * i] = X; pos[3 * i + 1] = Y; pos[3 * i + 2] = s.h; cat[i] = s.c;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("cat", new THREE.BufferAttribute(cat, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...lake.uniformsCommon,
        uSize: { value: 11 },
        uOn: { value: new THREE.Vector4(1, 1, 1, 0) },
        uCol: { value: KM_COLOURS.map(srgb) },
        uRim: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
  }

  setCategories(on) { this.material.uniforms.uOn.value.set(...on.map((v) => (v ? 1 : 0))); this.on = on; }
  setSize(px) { this.material.uniforms.uSize.value = px; }

  /** Nearest visible site to a screen position (CSS px), or null. */
  pick(mx, my, camera, w, h, state, maxPx = 10) {
    if (!this.points.visible) return null;
    const F = this.model.F(state.t), v = new THREE.Vector3();
    let best = null, bd = maxPx * maxPx;
    for (const s of this.sites) {
      if (!this.on?.[s.c]) continue;
      v.set(s.X, s.Y, (s.h - this.lake.zBase - state.frame * s.dr * F / 1000) * state.exag).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = { site: s, sx, sy }; }
    }
    return best;
  }

  /** GeoJSON (EPSG:25833) of the sites in the given categories, for GIS / the poster ZIP. */
  geojson(on) {
    return JSON.stringify({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } },
      features: this.sites.filter((s) => on[s.c]).map((s) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [s.x, s.y] },
        properties: { id: s.id, category: s.cat, type: s.art, dating: s.dating.join("; "), monuments: s.n, protection: s.vern, link: s.link },
      })),
      source: this.data.source, licence: this.data.licence,
    });
  }
}
