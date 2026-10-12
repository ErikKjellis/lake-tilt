// Uplift model shared by the 3D view, the profile and the read-outs.
//
// U(x, y, t) = r(x, y) * F(t) / 1000   [m], uplift from t (cal yr BP) until today (2026)
// F(t)       = k * tau * (exp((t - tE) / tau) - exp((T_NOW - tE) / tau))
//              so that dF/dt = k at the NKG2016LU epoch tE (2000 CE) and F(T_NOW) = 0
// r(x, y)    = present land uplift (NKG2016LU_lev, mm/yr), quadratic fit
// dr         = r - r(Luspi)   (only the differential part tilts the lake)
//
// The palaeo-lake tables in meta.json are indexed by F, so changing tau, k or
// the deglaciation age never requires recomputing the flood model.

export const YEAR_NOW_CE = 2026;
export const T_NOW = 1950 - YEAR_NOW_CE; // -76 (BP)
export const T_END = 1950 - 3000;        // 3000 CE
export const T_EPOCH = 1950 - 2000;      // NKG2016LU reference epoch

export class UpliftModel {
  constructor(meta) {
    this.meta = meta;
    this.Fgrid = Float64Array.from(meta.F);
    this.coef = meta.rate.coef;
    this.cx = meta.rate.centre[0];
    this.cy = meta.rate.centre[1];
    this.rRef = meta.rate.r_ref;
    this.defaults = { tau: 5000, k: 1, deglac: 10300 };
    this.tau = this.defaults.tau;
    this.k = this.defaults.k;
    this.deglac = this.defaults.deglac;
    this.lakes = meta.lakes;
    this._classify();
  }

  reset() { Object.assign(this, { tau: this.defaults.tau, k: this.defaults.k, deglac: this.defaults.deglac }); }

  /** Cumulative uplift from t until today (YEAR_NOW_CE) in "years at the present rate", scaled by k.
   *  F(T_NOW) = 0, so the terrain model (today's landscape) is the zero point. */
  F(t) { return this.k * this.tau * (Math.exp((t - T_EPOCH) / this.tau) - Math.exp((T_NOW - T_EPOCH) / this.tau)); }
  /** dF/dt: uplift rate at time t relative to the NKG2016LU rate. */
  rateFactor(t) { return this.k * Math.exp((t - T_EPOCH) / this.tau); }
  /** Inverse of F. */
  tOfF(F) { const a = F / (this.k * this.tau) + Math.exp((T_NOW - T_EPOCH) / this.tau); return a > 0 ? T_EPOCH + this.tau * Math.log(a) : -Infinity; }

  /** Present uplift rate (mm/yr) at EPSG:25833 x, y. */
  r(x, y) {
    const u = (x - this.cx) / 1000, v = (y - this.cy) / 1000, c = this.coef;
    return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * v * v + c[5] * u * v;
  }
  dr(x, y) { return this.r(x, y) - this.rRef; }

  /** Linear interpolation into a table defined on the F grid. */
  interp(table, F) {
    const g = this.Fgrid, n = g.length;
    if (F <= g[0]) return table[0];
    if (F >= g[n - 1]) return table[n - 1];
    const step = g[1] - g[0];
    const i = Math.min(n - 2, Math.floor((F - g[0]) / step));
    const f = (F - g[i]) / (g[i + 1] - g[i]);
    return table[i] * (1 - f) + table[i + 1] * f;
  }
  nearestIndex(F) {
    const g = this.Fgrid, step = g[1] - g[0];
    return Math.max(0, Math.min(g.length - 1, Math.round((F - g[0]) / step)));
  }
  /** Palaeo water level of lake li at F (frame: present-day relative to Luspi). */
  level(li, F) { return this.interp(this.lakes[li].S, F); }
  stats(li, F) {
    const st = this.lakes[li].stats;
    const i = this.nearestIndex(F);
    const pick = (k) => this.interp(this._col(li, k), F);
    return { area: pick("area_km2"), volume: pick("volume_Mm3"), maxDepth: pick("max_depth_m"), merged: st[i].merged_with, spill: [st[i].spill_x, st[i].spill_y] };
  }
  _col(li, key) {
    this._cols ??= {};
    const id = li + ":" + key;
    if (!this._cols[id]) this._cols[id] = Float64Array.from(this.lakes[li].stats, (s) => s[key] ?? 0);
    return this._cols[id];
  }

  /** Classify the outlet of the main lake (index 0) at every F grid node. */
  _classify() {
    const outlets = this.meta.outlets;
    const near = (s) => {
      if (s.spill_x == null) return "none";
      for (const o of outlets) if (Math.hypot(s.spill_x - o.x, s.spill_y - o.y) < o.radius_m) return o.id;
      return "other";
    };
    const L = this.lakes;
    this.regime = L[0].stats.map((s, i) => {
      const main = near(s);
      const merged = s.merged_with.length > 0;
      // follow the chain: Altevatn -> Leinavatn -> ...
      let final = main;
      if (main === "leina" && L.length > 2) final = near(L[2].stats[i]);
      const leinaMerged = s.merged_with.includes(2);
      const westSeparate = !s.merged_with.includes(1);
      return { main, final, merged, leinaMerged, westSeparate };
    });
    this.regimeKey = this.regime.map((r) => `${r.final}|${r.leinaMerged}|${r.westSeparate}|${r.main}`);
  }
  regimeAt(F) { return this.regime[this.nearestIndex(F)]; }

  /** Events where the drainage regime changes, as times BP for the current parameters. */
  events() {
    const ev = [];
    const g = this.Fgrid;
    for (let i = 1; i < g.length; i++) {
      const a = this.regime[i - 1], b = this.regime[i];
      const F = 0.5 * (g[i - 1] + g[i]);
      const t = this.tOfF(F);
      if (!(t > T_END && t < this.deglac)) continue;
      // going back in time = increasing F; describe the change forward in time (b -> a)
      if (a.final !== b.final) {
        const kind = { luspi: ["atl", "ev_to_atl"], secol: ["bal", "ev_to_bal"] }[a.final];
        if (kind) ev.push({ t, type: kind[0], key: kind[1], from: b.final, to: a.final });
      }
      if (a.leinaMerged !== b.leinaMerged) ev.push({ t, type: "lake", key: a.leinaMerged ? "ev_merge" : "ev_split" });
      if (a.westSeparate !== b.westSeparate) ev.push({ t, type: "lake", key: a.westSeparate ? "ev_west_split" : "ev_west_join" });
    }
    // merge near-simultaneous events of the same kind
    ev.sort((p, q) => q.t - p.t);
    return ev;
  }
}

export function formatYear(t, lang) {
  // t in cal yr BP (BP = before 1950)
  const ce = Math.round(1950 - t);
  const nb = (n) => Math.abs(Math.round(n)).toLocaleString(lang === "no" ? "nb-NO" : "en-GB").replace(/,/g, " ");
  if (t > 100) {
    const step = t > 2000 ? 50 : 10;   // avoid false precision for the early Holocene
    const ago = Math.round((t + (YEAR_NOW_CE - 1950)) / step) * step;
    return {
      main: lang === "no" ? `${nb(ago)} år siden` : `${nb(ago)} years ago`,
      sub: `${nb(Math.round(t / 10) * 10)} cal BP · ${ce < 0 ? `${nb(-ce)} ${lang === "no" ? "f.Kr." : "BCE"}` : `${nb(ce)} ${lang === "no" ? "e.Kr." : "CE"}`}`,
    };
  }
  if (ce <= YEAR_NOW_CE) return { main: lang === "no" ? `År ${ce}` : `Year ${ce}`, sub: ce === YEAR_NOW_CE ? (lang === "no" ? "i dag" : "today") : `${nb(Math.round(t))} BP` };
  return { main: lang === "no" ? `År ${ce}` : `Year ${ce}`, sub: lang === "no" ? `om ${nb(ce - YEAR_NOW_CE)} år (framskriving)` : `in ${nb(ce - YEAR_NOW_CE)} years (projection)` };
}
