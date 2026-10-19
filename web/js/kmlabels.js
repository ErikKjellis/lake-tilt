// Askeladden ID labels next to the heritage-site markers: DOM labels over the 3D view.
// The labels are laid out without overlap (askeladden.js: placeLabels) and only when something changed
// (camera, time, exaggeration, what is shown), so an idle view costs nothing.
import { placeLabels } from "./askeladden.js";

export const KM_LABEL = { size: 11.5, h: 16, pad: 9, max: 400 };   // px; pad = bar (3) + padding (3 + 3)

/** The monospace font of the page (--mono in app.css), as a canvas font string. */
const labelFont = () => `600 ${KM_LABEL.size}px ${getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace"}`;

export class KmLabels {
  /** @param {HTMLElement} container absolutely positioned over the canvas (see #km-ids in app.css) */
  constructor(container) {
    this.el = container;
    this.pool = [];
    this.sig = null;
    this.used = 0;
    this.widths = new Map();
    this.ctx = document.createElement("canvas").getContext("2d");
    this.ctx.font = labelFont();
  }

  /** Width (px) of the label with this ID; the font is monospaced, so this is cheap and exact. */
  width(id) {
    let w = this.widths.get(id);
    if (w === undefined) { w = Math.ceil(this.ctx.measureText(id).width) + KM_LABEL.pad; this.widths.set(id, w); }
    return w;
  }

  /** Remove all labels (the layer is off). */
  clear() {
    if (this.used) for (let i = 0; i < this.used; i++) this.pool[i].style.display = "none";
    this.used = 0;
    this.sig = null;
  }

  /** Force a new layout on the next update (after a language switch, a resize ...). */
  invalidate() { this.sig = null; }

  _node(i) {
    let n = this.pool[i];
    if (!n) { n = document.createElement("span"); this.el.appendChild(n); this.pool[i] = n; }
    return n;
  }

  /**
   * @param {{version: number, markerPx: number, boost?: number, anchors: Function, text: (item) => string, colour: (item) => string}[]} layers
   *   the layers to label. version: counts changes of what the layer shows; markerPx: marker diameter in CSS px;
   *   boost: priority bonus when space is short; anchors(camera, w, h, state, opt) -> [{site, sx, sy, z}];
   *   text/colour: the label text (empty: no label, the marker only keeps its space) and the colour bar of an item
   * @param {THREE.Camera} camera
   * @param {number} w  view size in CSS px
   * @param {number} h
   * @param {{t: number, frame: number, exag: number}} state
   * @param {number} F cumulative uplift of the current time (model.F(state.t)): the tilted frame moves the markers with it
   */
  update(layers, camera, w, h, state, F) {
    camera.updateMatrixWorld();
    const sig = [...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements, w, h, state.t, state.frame, state.exag, F, layers.length];
    for (const L of layers) sig.push(L.version, L.markerPx);
    if (this.sig && this.sig.length === sig.length && this.sig.every((v, i) => v === sig[i])) return;
    this.sig = sig;
    const found = [];
    for (const L of layers) for (const a of L.anchors(camera, w, h, state, { radiusPx: L.markerPx * 0.4 })) found.push({ a, L, text: L.text(a.site) });
    const items = found.map(({ a, L, text }) => ({ x: a.sx, y: a.sy, w: text ? this.width(text) : 0, h: KM_LABEL.h, r: L.markerPx / 2 + 1, prio: -a.z + (L.boost ?? 0) }));
    const pos = placeLabels(items, w, h, { max: KM_LABEL.max });
    let n = 0;
    found.forEach(({ L, a, text }, i) => {
      if (!pos[i]) return;
      const node = this._node(n++), colour = L.colour(a.site);
      if (node._t !== text) { node.textContent = text; node._t = text; }
      if (node._c !== colour) { node.style.borderLeftColor = colour; node._c = colour; }
      node.style.transform = `translate(${pos[i].x.toFixed(1)}px, ${pos[i].y.toFixed(1)}px)`;
      node.style.width = `${items[i].w}px`;
      node.style.display = "";
    });
    for (let i = n; i < this.used; i++) this.pool[i].style.display = "none";
    this.used = n;
  }
}
