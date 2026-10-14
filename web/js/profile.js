// Long profile along the lake axis (Canvas 2D).
import { STRINGS } from "./i18n.js";

export class Profile {
  constructor(canvas, scene, model) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.scene = scene;
    this.model = model;
    const p = scene.data.meta.profile;
    this.s = Float64Array.from(p.s, (v) => v / 1000);
    this.x = p.x; this.y = p.y;
    this.z = Float64Array.from(p.z);
    this.dr = Float64Array.from(p.x, (x, i) => model.dr(x, p.y[i]));
    // per-sample wet intervals (nearest 40 m cell) for each lake
    const g = scene.data.meta.grid;
    this.iv = scene.iv.map(({ a, b }) => {
      const A = new Float64Array(this.s.length), B = new Float64Array(this.s.length);
      for (let i = 0; i < this.s.length; i++) {
        const c = Math.round((p.x[i] - g.x0) / g.cell - 0.5), r = Math.round((g.y1 - p.y[i]) / g.cell - 0.5);
        let mn = 1e9, mx = -1e9;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const j = (r + dr) * g.nx + (c + dc);
          if (a[j] <= b[j]) { mn = Math.min(mn, a[j]); mx = Math.max(mx, b[j]); }
        }
        A[i] = mn; B[i] = mx;
      }
      return { a: A, b: B };
    });
    this.marks = this._marks(scene.data.meta);
    this.hover = null;
    canvas.addEventListener("mousemove", (e) => { this.hover = e.offsetX; this.onHover?.(this._hoverSample()); this.draw(this.last); });
    canvas.addEventListener("mouseleave", () => { this.hover = null; this.onHover?.(null); this.draw(this.last); });
    new ResizeObserver(() => this.draw(this.last)).observe(canvas);
  }

  _nearestS(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.s.length; i++) {
      const d = Math.hypot(this.x[i] - x, this.y[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    return this.s[best];
  }

  _marks(meta) {
    const out = [];
    const add = (key, x, y) => out.push({ key, s: this._nearestS(x, y) });
    if (meta.dam) add("prof_dam", meta.dam.x, meta.dam.y);
    add("prof_outlet", meta.outlet.x, meta.outlet.y);
    const st = meta.outlets.find((o) => o.id === "straumen");
    if (st) add("prof_straumen", st.x, st.y);
    const le = meta.outlets.find((o) => o.id === "leina");
    if (le) add("prof_leina", le.x, le.y);
    if (meta.se_col) add("prof_col", meta.se_col.x, meta.se_col.y);
    return out;
  }

  _hoverSample() {
    if (this.hover == null || !this.geom) return null;
    const { px0, pw } = this.geom;
    const f = (this.hover - px0) / pw;
    if (f < 0 || f > 1) return null;
    const i = Math.round(f * (this.s.length - 1));
    return { x: this.x[i], y: this.y[i], s: this.s[i] };
  }

  draw(state) {
    if (!state) return;
    this.last = state;
    const S = STRINGS[state.lang];
    const dpr = window.devicePixelRatio || 1;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
      this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const m = this.model, F = m.F(state.t);
    const frame = state.frame;
    const n = this.s.length;
    const zf = (i, z) => (frame ? z - this.dr[i] * F / 1000 : z);
    const zTerr = Float64Array.from(this.z, (z, i) => zf(i, z));

    // water surface per sample: highest level among lakes whose interval contains F
    const lev = [0, 1, 2].map((li) => (li < m.lakes.length ? m.level(li, F) : -1e9));
    const W_ = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let L = -1e9;
      this.iv.forEach((iv, li) => { if (F >= iv.a[i] && F <= iv.b[i]) L = Math.max(L, lev[li]); });
      if (L > -1e8) {
        const w = L + this.dr[i] * F / 1000;
        if (w > this.z[i]) W_[i] = zf(i, w);
      }
    }

    const [zmin, zmax] = this.scene.data.meta.profile_range ?? [370, 540];
    const zStep = zmax - zmin > 200 ? 40 : 20;
    const px0 = 44, px1 = W - 10, py0 = 8, py1 = H - 22;
    const pw = px1 - px0;
    this.geom = { px0, pw };
    const X = (s) => px0 + (s / this.s[n - 1]) * pw;
    const Y = (z) => py1 - ((z - zmin) / (zmax - zmin)) * (py1 - py0);

    // axes
    ctx.font = "11px Inter, Segoe UI, system-ui, sans-serif";
    ctx.fillStyle = "#93a7b4"; ctx.strokeStyle = "rgba(160,190,210,0.12)"; ctx.lineWidth = 1;
    for (let z = Math.ceil((zmin + 1) / zStep) * zStep; z <= zmax; z += zStep) {
      ctx.beginPath(); ctx.moveTo(px0, Y(z)); ctx.lineTo(px1, Y(z)); ctx.stroke();
      ctx.fillText(String(z), 6, Y(z) + 4);
    }
    for (let s = 0; s <= this.s[n - 1]; s += 10) {
      ctx.fillText(`${s} km`, X(s) - 12, H - 6);
    }

    // water
    ctx.fillStyle = "rgba(89,195,214,0.55)";
    let open = false;
    for (let i = 0; i < n; i++) {
      const wet = Number.isFinite(W_[i]);
      if (wet && !open) { ctx.beginPath(); ctx.moveTo(X(this.s[i]), Y(zTerr[i])); open = true; }
      if (wet) ctx.lineTo(X(this.s[i]), Y(W_[i]));
      if (open && (!wet || i === n - 1)) {
        const end = wet ? i : i - 1;
        for (let j = end; j >= 0 && Number.isFinite(W_[j]); j--) ctx.lineTo(X(this.s[j]), Y(zTerr[j]));
        ctx.closePath(); ctx.fill(); open = false;
      }
    }
    // water surface line
    ctx.strokeStyle = "#bff3ff"; ctx.lineWidth = 1.6; ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(W_[i])) { pen ? ctx.lineTo(X(this.s[i]), Y(W_[i])) : ctx.moveTo(X(this.s[i]), Y(W_[i])); pen = true; } else pen = false;
    }
    ctx.stroke();

    // terrain
    ctx.fillStyle = "rgba(150,135,110,0.85)";
    ctx.beginPath(); ctx.moveTo(X(0), Y(zmin));
    for (let i = 0; i < n; i++) ctx.lineTo(X(this.s[i]), Y(Math.max(zmin, zTerr[i])));
    ctx.lineTo(X(this.s[n - 1]), Y(zmin)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#e8dcc8"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < n; i++) i ? ctx.lineTo(X(this.s[i]), Y(zTerr[i])) : ctx.moveTo(X(this.s[i]), Y(zTerr[i]));
    ctx.stroke();

    // reference levels (present-day frame only)
    const meta = this.scene.data.meta;
    if (!frame) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.moveTo(px0, Y(meta.natural_level_m)); ctx.lineTo(px1, Y(meta.natural_level_m)); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillText(S.prof_today, px1 - ctx.measureText(S.prof_today).width - 4, Y(meta.natural_level_m) - 4);
      if (Math.abs(meta.regulated.hrv_m - meta.natural_level_m) > 0.3) {   // a drawdown-only reservoir has HRV = natural
        ctx.strokeStyle = "rgba(255,138,122,0.6)";
        ctx.beginPath(); ctx.moveTo(px0, Y(meta.regulated.hrv_m)); ctx.lineTo(X(this.marks.find((k) => k.key === "prof_leina")?.s ?? 40), Y(meta.regulated.hrv_m)); ctx.stroke();
        ctx.fillStyle = "rgba(255,138,122,0.85)"; ctx.fillText(S.prof_hrv, px0 + 4, Y(meta.regulated.hrv_m) - 4);
      }
      ctx.setLineDash([]);
    }

    // marks
    ctx.fillStyle = "#cfdce4"; ctx.strokeStyle = "rgba(255,255,255,0.35)";
    let lastRight = -1e9, row = 0;
    for (const mk of [...this.marks].sort((a, b) => a.s - b.s)) {
      const x = X(mk.s);
      const label = S[mk.key];
      const w = ctx.measureText(label).width;
      const lx = Math.min(px1 - w, Math.max(px0, x - w / 2));
      row = lx < lastRight + 4 ? 1 - row : 0;
      lastRight = lx + w;
      const ly = py0 + 9 + row * 12;
      ctx.beginPath(); ctx.moveTo(x, ly + 3); ctx.lineTo(x, py1); ctx.stroke();
      ctx.fillText(label, lx, ly);
    }
    // Leinavatnet note
    const le = this.marks.find((k) => k.key === "prof_leina");
    if (le) { ctx.fillStyle = "#93a7b4"; ctx.fillText(`(${S.prof_unknown})`, X(le.s) + 30, Y(zf(n - 40, 491.3)) + 16); }

    ctx.fillStyle = "#93a7b4"; ctx.fillText(frame ? S.prof_frame1 : S.prof_frame0, px0 + 4, py1 - 6);

    if (this.hover != null && this.hover >= px0 && this.hover <= px1) {
      ctx.strokeStyle = "rgba(242,178,92,0.9)"; ctx.beginPath(); ctx.moveTo(this.hover, py0); ctx.lineTo(this.hover, py1); ctx.stroke();
      const i = Math.round(((this.hover - px0) / pw) * (n - 1));
      const txt = `${this.s[i].toFixed(1)} km · ${zTerr[i].toFixed(1)} m` + (Number.isFinite(W_[i]) ? ` · ${(W_[i] - zTerr[i]).toFixed(1)} m` : "");
      ctx.fillStyle = "#f2b25c"; ctx.fillText(txt, Math.min(px1 - 170, this.hover + 6), py0 + 26);
    }
  }
}
