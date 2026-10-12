"""Reconstruct the natural (pre-regulation) landscape around the lake.

Steps
  1. Kartverket DTM (10 m, NN2000) -> block mean to `cell_dem` (default 20 m).
  2. Cells inside the regulated reservoir polygon whose DTM value is the flat
     reservoir water surface are "unknown bottom".
  3. Inside the 1959 depth-survey shoreline the bottom is the NVE bathymetry:
         z = survey_level + datum_shift - depth.
  4. The flooded land between the 1959 shoreline and the present reservoir
     shore is interpolated with a tension spline (boundary values: 1959
     shoreline = survey level, surrounding dry land = DTM).
  5. A natural outlet channel is carved from the natural threshold through the
     dam site, so the dam does not act as the lake's spillway.

Usage: python tools/natural_dem.py [tools/scene_config.json]
Writes data/processed/<lake>_natural<cell>.npz  (z, x0, y_top, cell, masks)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bathymetry import build as build_bathymetry, solve_tension_spline  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def load_cfg(path=None):
    p = Path(path) if path else ROOT / "tools" / "scene_config.json"
    return json.loads(p.read_text(encoding="utf-8"))


def load_dtm(base: str, cell: float):
    meta = json.loads((ROOT / f"{base}.json").read_text())
    a = np.load(ROOT / f"{base}.npy")
    k = int(round(cell / meta["dx"]))
    H, W = a.shape
    a = a[: H - H % k, : W - W % k]
    z = a.reshape(H // k, k, W // k, k).mean(axis=(1, 3), dtype=np.float64)
    return z, meta["x0"], meta["y0"], cell


def cell_centres(x0, y_top, cell, shape_):
    ny, nx = shape_
    xc = x0 + (np.arange(nx) + 0.5) * cell
    yc = y_top - (np.arange(ny) + 0.5) * cell
    return xc, yc


def polygon_mask(poly, xc, yc):
    shapely.prepare(poly)
    out = np.zeros((yc.size, xc.size), bool)
    for r0 in range(0, yc.size, 256):
        X, Y = np.meshgrid(xc, yc[r0:r0 + 256])
        out[r0:r0 + 256] = shapely.contains_xy(poly, X, Y)
    return out


def main():
    cfg = load_cfg(sys.argv[1] if len(sys.argv) > 1 else None)
    lake, cell = cfg["lake"], float(cfg["cell_dem"])
    t0 = time.time()
    dtm, x0, y_top, cell = load_dtm(cfg["dtm"], cell)
    ny, nx = dtm.shape
    xc, yc = cell_centres(x0, y_top, cell, dtm.shape)
    print(f"DTM {nx}x{ny} @ {cell} m  ({time.time() - t0:.1f}s)")

    feats = lambda n: json.loads((ROOT / "data" / "raw" / f"{lake}_{n}.geojson").read_text(encoding="utf-8"))["features"]
    regulated = shape(feats("innsjo")[0]["geometry"])
    survey = shape(feats("omkrets_dybdemalt")[0]["geometry"])

    # Bounding window around the reservoir to keep the masks/solve small.
    bx0, by0, bx1, by1 = regulated.buffer(2000).bounds
    c0, c1 = int((bx0 - x0) // cell), int((bx1 - x0) // cell) + 1
    r0, r1 = int((y_top - by1) // cell), int((y_top - by0) // cell) + 1
    win = (slice(r0, r1), slice(c0, c1))
    z = dtm[win].copy()
    wx, wy = xc[c0:c1], yc[r0:r1]

    in_reg = polygon_mask(regulated.buffer(cell), wx, wy)
    gy, gx = np.gradient(z, cell)
    flat = np.hypot(gx, gy) < 0.01
    water = in_reg & flat & (z < cfg["reservoir_water_max_m"])
    in_survey = polygon_mask(survey, wx, wy)

    # Bathymetry (same lattice: both grids have origins on multiples of `cell`).
    depth, bx, by, _ = build_bathymetry(lake, cell, 0.35)
    level = cfg["survey_level_m"] + cfg["survey_datum_to_nn2000_m"]
    bed = np.full(z.shape, np.nan)
    # bathymetry grid: lower-left origin (bx, by), rows increase northwards
    for_rows = ((wy - by) // cell).astype(int)
    for_cols = ((wx - bx) // cell).astype(int)
    rr, cc = np.meshgrid(for_rows, for_cols, indexing="ij")
    ok = (rr >= 0) & (rr < depth.shape[0]) & (cc >= 0) & (cc < depth.shape[1])
    bed[ok] = level - depth[rr[ok], cc[ok]]

    use_bed = in_survey & ~np.isnan(bed) & (water | (z < cfg["regulated_hrv_m"] + 1))
    nat = z.copy()
    nat[use_bed] = bed[use_bed]

    # Flooded land between the 1959 shore and the present reservoir shore.
    unknown = water & ~use_bed
    fixed = nat.copy()
    fixed[unknown] = np.nan
    active = unknown.copy()
    for _ in range(2):  # include two rings of fixed neighbours
        g = active.copy()
        g[1:] |= active[:-1]; g[:-1] |= active[1:]; g[:, 1:] |= active[:, :-1]; g[:, :-1] |= active[:, 1:]
        active = g
    t = time.time()
    filled = solve_tension_spline(fixed, active, 0.5)
    nat[unknown] = np.minimum(filled[unknown], cfg["regulated_hrv_m"])
    # outside the 1959 shoreline the land was dry at the survey level
    nat[unknown] = np.maximum(nat[unknown], level + 0.05)
    print(f"interpolated {int(unknown.sum())} flooded cells in {time.time() - t:.1f}s")

    # Natural outlet channel. Vertex elevations come from `outlet_channel_z`
    # (null = interpolate along the line); the first vertex is the natural
    # threshold, the last one defaults to the DTM minimum found there.
    line = LineString(cfg["outlet_channel"])
    width = cfg.get("outlet_channel_width_m", 60)
    X, Y = np.meshgrid(wx, wy)
    near = shapely.distance(line, shapely.points(X.ravel(), Y.ravel())).reshape(X.shape) <= width / 2
    s = shapely.line_locate_point(line, shapely.points(X[near], Y[near]))
    vz = list(cfg.get("outlet_channel_z") or [None] * len(line.coords))
    if vz[-1] is None:
        ex, ey = line.coords[-1]
        jr, jc = int((y_top - ey) // cell) - r0, int((ex - x0) // cell) - c0
        vz[-1] = float(np.min(z[jr - 2:jr + 3, jc - 2:jc + 3]))
    vd = np.array([line.project(shapely.Point(c)) for c in line.coords])
    known = [i for i, v in enumerate(vz) if v is not None]
    vz = np.interp(vd, vd[known], [vz[i] for i in known])
    prof = np.interp(s, vd, vz)
    nat[near] = np.minimum(nat[near], prof)
    print(f"outlet channel {line.length:.0f} m, vertex z {np.round(vz, 1).tolist()}, {int(near.sum())} cells")

    full = dtm.copy()
    full[win] = nat
    masks = np.zeros(dtm.shape, np.uint8)  # bit0 regulated water, bit1 surveyed lake, bit2 flooded land, bit3 channel
    mw = masks[win]
    mw[water] |= 1; mw[use_bed] |= 2; mw[unknown] |= 4; mw[near] |= 8
    out = ROOT / "data" / "processed" / f"{lake}_natural{int(cell)}.npz"
    np.savez_compressed(out, z=full.astype(np.float32), x0=x0, y_top=y_top, cell=cell, masks=masks)
    print(f"wrote {out.relative_to(ROOT)}  total {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
