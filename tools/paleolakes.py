"""Paleo-lake extents as a function of cumulative differential uplift.

Model
-----
Present land uplift r(x, y) (NKG2016LU_lev, mm/yr) is fitted by a quadratic
surface.  Uplift from time t BP until today is assumed separable,

    U(x, y, t) = r(x, y) * F(t) / 1000          [m]

where F(t) (in "years at today's rate") carries the whole time dependence.
Only the differential part matters for a lake, so with r_ref = r(outlet)

    P(x, y; F) = z(x, y) - (r(x, y) - r_ref) * F / 1000

is the palaeo-topography relative to the present natural outlet.  For every F
on a grid the lake that contains a seed point is filled until it spills
(lowest escape path to the domain edge), giving the palaeo water level S(F),
the spill point and the flooded cells.  Because everything depends on t only
through F, the web viewer can change the time function freely.

Per cell and lake we store the interval [a, b] of F in which the cell belongs
to that lake.  The viewer then uses: wet(x, F) = a <= F <= b, and water
surface (present-day frame)  W = S(F) + (r - r_ref) * F / 1000.

Usage: python tools/paleolakes.py [tools/scene_config.json]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
FOUR = ndimage.generate_binary_structure(2, 1)


def load_cfg(path=None):
    p = Path(path) if path else ROOT / "tools" / "scene_config.json"
    return json.loads(p.read_text(encoding="utf-8"))


def fit_rate_surface(grid_path: Path, xc: float, yc: float):
    """Quadratic fit r = c0 + c1 u + c2 v + c3 u^2 + c4 v^2 + c5 u v (u, v in km)."""
    g = json.loads(grid_path.read_text())
    v = np.array(g["values"], float).reshape(g["ny"], g["nx"])
    X, Y = np.meshgrid(g["x0"] + np.arange(g["nx"]) * g["dx"], g["y0"] + np.arange(g["ny"]) * g["dy"])
    u, w = (X.ravel() - xc) / 1000, (Y.ravel() - yc) / 1000
    A = np.c_[np.ones_like(u), u, w, u * u, w * w, u * w]
    coef, *_ = np.linalg.lstsq(A, v.ravel(), rcond=None)
    resid = v.ravel() - A @ coef
    return coef, float(np.abs(resid).max()), g


def rate(coef, xc, yc, X, Y):
    u, w = (X - xc) / 1000, (Y - yc) / 1000
    return coef[0] + coef[1] * u + coef[2] * w + coef[3] * u * u + coef[4] * w * w + coef[5] * u * w


def block(z, k, how):
    H, W = z.shape
    b = z[: H - H % k, : W - W % k].reshape(H // k, k, W // k, k)
    return getattr(b, how)(axis=(1, 3))


def main():
    cfg = load_cfg(sys.argv[1] if len(sys.argv) > 1 else None)
    lake = cfg["lake"]
    t0 = time.time()
    d = np.load(ROOT / "data" / "processed" / f"{lake}_natural{int(cfg['cell_dem'])}.npz")
    z20, x0, y_top, c20, m20 = d["z"].astype(np.float64), float(d["x0"]), float(d["y_top"]), float(d["cell"]), d["masks"]
    k = int(round(cfg["cell_mesh"] / c20))
    cell = c20 * k
    z = block(z20, k, "mean")
    zmin = block(z20, k, "min")
    chan = block((m20 & 8) > 0, k, "max")
    z[chan] = zmin[chan]  # keep the carved outlet channel open
    ny, nx = z.shape
    xc = x0 + (np.arange(nx) + 0.5) * cell
    yc = y_top - (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xc, yc)

    # Lakes with no depth data: give them a nominal 1 m depth so they hold water.
    nodepth = []
    for spec in cfg.get("lakes_without_bathymetry", []):
        f = json.loads((ROOT / spec["file"]).read_text(encoding="utf-8"))["features"][0]
        poly = shape(f["geometry"]).buffer(-cell)
        shapely.prepare(poly)
        inside = shapely.contains_xy(poly, X, Y)
        surf = float(np.median(z[inside]))
        z[inside] = np.minimum(z[inside], surf - spec.get("nominal_depth_m", 1.0))
        nodepth.append({"name": spec["name"], "surface_m": round(surf, 2), "cells": int(inside.sum())})
        print(f"{spec['name']}: surface {surf:.2f} m, {int(inside.sum())} cells lowered")

    # Uplift-rate surface.
    ox, oy = cfg["outlet"]["x"], cfg["outlet"]["y"]
    fc = cfg.get("rate_fit_centre", [680000.0, 7612000.0])
    coef, fit_err, g = fit_rate_surface(ROOT / cfg["uplift_grid"], *fc)
    r = rate(coef, *fc, X, Y)
    r_ref = float(rate(coef, *fc, ox, oy))
    dr = r - r_ref
    print(f"rate fit max residual {fit_err:.4f} mm/yr; r_ref {r_ref:.3f}; dr range {dr.min():.3f}..{dr.max():.3f}")

    boundary = np.zeros((ny, nx), bool)
    boundary[0, :] = boundary[-1, :] = boundary[:, 0] = boundary[:, -1] = True

    def rc(x, y):
        return int((y_top - y) // cell), int((x - x0) // cell)

    # Each lake is seeded from a region (its present outline); at every F the
    # seed is the lowest palaeo-elevation cell of that region.
    lakes = cfg["lakes"]
    regions = []
    for L in lakes:
        f = json.loads((ROOT / L["region"]).read_text(encoding="utf-8"))["features"][0]
        poly = shape(f["geometry"]).buffer(-cell)
        if "clip_bbox" in L:
            poly = poly.intersection(shapely.box(*L["clip_bbox"]))
        shapely.prepare(poly)
        m = shapely.contains_xy(poly, X, Y)
        lab, n = ndimage.label(m, structure=FOUR)  # keep the main water body only
        if n > 1:
            m = lab == 1 + np.argmax(ndimage.sum(m, lab, range(1, n + 1)))
        regions.append(np.flatnonzero(m.ravel()))

    def seed_of(P, li):
        k = regions[li][np.argmin(P.ravel()[regions[li]])]
        return divmod(int(k), nx)

    fg = cfg["F_grid"]
    Fs = np.arange(fg["min"], fg["max"] + 0.5 * fg["step"], fg["step"], dtype=float)
    nF = Fs.size
    nl = len(lakes)
    first = np.full((nl, ny, nx), -1, np.int32)
    last = np.full((nl, ny, nx), -1, np.int32)
    count = np.zeros((nl, ny, nx), np.int32)
    S = np.zeros((nl, nF))
    stats = [[None] * nF for _ in range(nl)]
    prevS = [None] * nl
    tol = 0.005

    def escapes(P, seed, level):
        lab, _ = ndimage.label(P < level, structure=FOUR)
        L = lab[seed]
        return L > 0 and bool(np.any(lab[boundary] == L)), lab, L

    for i, F in enumerate(Fs):
        P = z - dr * F / 1000.0
        seeds = [seed_of(P, li) for li in range(nl)]
        for li, seed in enumerate(seeds):
            p0 = P[seed]
            if prevS[li] is not None and prevS[li] > p0:
                lo, hi = max(p0, prevS[li] - 2.0), prevS[li] + 2.0
                if escapes(P, seed, lo)[0]:
                    lo = p0
                while not escapes(P, seed, hi)[0]:
                    hi += 10.0
            else:
                lo, hi = p0, p0 + 50.0
                while not escapes(P, seed, hi)[0]:
                    hi += 50.0
            while hi - lo > tol:
                mid = 0.5 * (lo + hi)
                if escapes(P, seed, mid)[0]:
                    hi = mid
                else:
                    lo = mid
            level = 0.5 * (lo + hi)
            S[li, i] = level
            prevS[li] = level
            _, lab, L = escapes(P, seed, lo)
            wet = (lab == L) if L > 0 else np.zeros_like(boundary)
            # Spill point: the escaping region at `hi` that is new relative to
            # the lake at `lo` touches the lake exactly at the col.
            _, lab_hi, L_hi = escapes(P, seed, hi)
            new = (lab_hi == L_hi) & ~wet
            nlab, _ = ndimage.label(new, structure=FOUR)
            out_l = np.unique(nlab[boundary & new])
            esc = np.isin(nlab, out_l[out_l > 0])
            col = esc & ndimage.binary_dilation(wet, FOUR)
            rr, cc = np.nonzero(col)
            spill = (float(xc[cc].mean()), float(yc[rr].mean())) if rr.size else (None, None)
            depth = np.where(wet, level - P, 0.0)
            stats[li][i] = {
                "area_km2": round(float(wet.sum()) * cell * cell / 1e6, 3),
                "volume_Mm3": round(float(depth.sum()) * cell * cell / 1e6, 1),
                "max_depth_m": round(float(depth.max()), 1),
                "spill_x": spill[0], "spill_y": spill[1],
                "merged_with": [lj for lj, s2 in enumerate(seeds) if lj != li and wet[s2]],
            }
            first[li][wet & (first[li] < 0)] = i
            last[li][wet] = i
            count[li][wet] += 1
        if i % 20 == 0 or i == nF - 1:
            s0, s1 = stats[0][i], stats[-1][i]
            print(f"F={F:8.0f}  S0={S[0, i]:7.2f} A0={s0['area_km2']:6.1f} spill0=({s0['spill_x']},{s0['spill_y']})"
                  f"  S1={S[-1, i]:7.2f} A1={s1['area_km2']:6.1f} spill1=({s1['spill_x']},{s1['spill_y']})"
                  f"  merged={s0['merged_with']}   {time.time() - t0:5.0f}s", flush=True)

    # Sub-step refinement of the interval ends using the cell's own crossing.
    out = {}
    for li in range(nl):
        ever = first[li] >= 0
        gaps = ever & (count[li] != last[li] - first[li] + 1)
        print(f"lake {lakes[li]['name']}: {int(ever.sum())} cells ever wet, {int(gaps.sum())} with split intervals")
        idx = np.flatnonzero(ever)
        fi, la = first[li].ravel()[idx], last[li].ravel()[idx]
        zz, dd = z.ravel()[idx], dr.ravel()[idx]

        def crossing(i0, i1):
            # g(F) = P(F) - S(F); find root on [F_i0, F_i1] by linear interpolation
            F0, F1 = Fs[i0], Fs[i1]
            g0 = zz - dd * F0 / 1000 - S[li, i0]
            g1 = zz - dd * F1 / 1000 - S[li, i1]
            with np.errstate(divide="ignore", invalid="ignore"):
                f = g0 / (g0 - g1)
            f = np.where(np.isfinite(f) & (f >= 0) & (f <= 1), f, 0.5)
            return F0 + f * (F1 - F0)

        a = np.where(fi > 0, crossing(np.maximum(fi - 1, 0), fi), -np.inf)
        b = np.where(la < nF - 1, crossing(la, np.minimum(la + 1, nF - 1)), np.inf)
        out[li] = (idx, a, b)

    # Write intermediate products.
    res = {
        "cell": cell, "x0": x0, "y_top": y_top, "nx": nx, "ny": ny,
        "F": Fs.tolist(), "rate_coef": coef.tolist(), "rate_fit_centre": fc, "rate_fit_max_resid": fit_err,
        "rate_model": g.get("model"), "rate_source": g.get("source_url"),
        "r_ref": r_ref, "outlet": cfg["outlet"],
        "lakes": [{"name": L["name"], "region": L["region"],
                   "S": S[li].round(3).tolist(), "stats": stats[li]} for li, L in enumerate(lakes)],
        "lakes_without_bathymetry": nodepth,
    }
    (ROOT / "data" / "processed" / f"{lake}_paleolakes.json").write_text(json.dumps(res))
    np.savez_compressed(ROOT / "data" / "processed" / f"{lake}_paleolakes.npz", z=z.astype(np.float32), dr=dr.astype(np.float32),
                        **{f"idx{li}": out[li][0] for li in out}, **{f"a{li}": out[li][1] for li in out},
                        **{f"b{li}": out[li][2] for li in out})
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
