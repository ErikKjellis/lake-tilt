// Askeladden ID labels next to the heritage-site markers: DOM labels over the 3D view.
// The labels are laid out without overlap (askeladden.js: placeLabels) and only when something changed
// (camera, time, exaggeration, what is shown), so an idle view costs nothing.
import { placeLabels } from "./askeladden.js";
import { KM_COLOURS } from "./heritage.js";

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
   * @param {import("./heritage.js").Heritage} heritage
   * @param {THREE.Camera} camera
   * @param {number} w  view size in CSS px
   * @param {number} h
   * @param {{t: number, frame: number, exag: number}} state
   * @param {number} markerPx marker diameter in CSS px
   */
  update(heritage, camera, w, h, state, markerPx) {
    camera.updateMatrixWorld();
    const sig = [...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements, w, h, state.t, state.frame, state.exag, markerPx, heritage.version, heritage.model.F(state.t)];   // F: the tilted frame moves the markers with tau, k ...
    if (this.sig && this.sig.length === sig.length && this.sig.every((v, i) => v === sig[i])) return;
    this.sig = sig;
    const anchors = heritage.anchors(camera, w, h, state, { radiusPx: markerPx * 0.4 });
    const items = anchors.map((a) => ({ x: a.sx, y: a.sy, w: this.width(a.site.id), h: KM_LABEL.h, r: markerPx / 2 + 1, prio: -a.z }));
    const pos = placeLabels(items, w, h, { max: KM_LABEL.max });
    let n = 0;
    anchors.forEach((a, i) => {
      if (!pos[i]) return;
      const node = this._node(n++), id = a.site.id;
      if (node._id !== id) { node.textContent = id; node._id = id; }
      if (node._c !== a.site.c) { node.style.borderLeftColor = KM_COLOURS[a.site.c]; node._c = a.site.c; }
      node.style.transform = `translate(${pos[i].x.toFixed(1)}px, ${pos[i].y.toFixed(1)}px)`;
      node.style.width = `${items[i].w}px`;
      node.style.display = "";
    });
    for (let i = n; i < this.used; i++) this.pool[i].style.display = "none";
    this.used = n;
  }
}
