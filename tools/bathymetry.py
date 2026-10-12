"""Interpolate NVE depth contours + soundings into a gridded bathymetry.

The surface is a discrete tension spline (cf. GMT `surface`): inside the
surveyed lake outline we minimise

    (1 - T) * sum (laplacian z)^2  +  T * sum (gradient z)^2

with the depths on contour cells, sounding cells and the shoreline (depth 0)
held fixed.  T = 0 gives a minimum-curvature surface, T = 1 a harmonic one.

Usage:
    python tools/bathymetry.py [--cell 20] [--tension 0.35] [--lake altevatn]
Writes data/processed/<lake>_bathy<cell>.npz with fields
    depth (ny, nx, float32, NaN outside lake), x0, y0 (lower-left corner), cell
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
import shapely
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]


def load_features(lake: str, name: str):
    path = ROOT / "data" / "raw" / f"{lake}_{name}.geojson"
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def grid_for(poly, cell: float, pad_cells: int = 3):
    minx, miny, maxx, maxy = poly.bounds
    x0 = np.floor(minx / cell) * cell - pad_cells * cell
    y0 = np.floor(miny / cell) * cell - pad_cells * cell
    nx = int(np.ceil((maxx - x0) / cell)) + pad_cells
    ny = int(np.ceil((maxy - y0) / cell)) + pad_cells
    return x0, y0, nx, ny


def rasterize_lines(features, x0, y0, cell, nx, ny):
    """Mean contour depth per cell (NaN where no contour passes)."""
    acc = np.zeros((ny, nx))
    cnt = np.zeros((ny, nx))
    for f in features:
        line = shapely.segmentize(shape(f["geometry"]), cell / 4)
        xy = shapely.get_coordinates(line)
        i = np.floor((xy[:, 0] - x0) / cell).astype(int)
        j = np.floor((xy[:, 1] - y0) / cell).astype(int)
        ok = (i >= 0) & (i < nx) & (j >= 0) & (j < ny)
        np.add.at(acc, (j[ok], i[ok]), f["properties"]["dybde_m"])
        np.add.at(cnt, (j[ok], i[ok]), 1)
    out = np.full((ny, nx), np.nan)
    m = cnt > 0
    out[m] = acc[m] / cnt[m]
    return out


def solve_tension_spline(fixed: np.ndarray, active: np.ndarray, tension: float):
    """Fill NaNs of `fixed` inside `active` with a tension spline.

    fixed  : (ny, nx) known values, NaN = unknown
    active : (ny, nx) bool, cells taking part (unknown cells must be active,
             and every active cell on the outer edge should be fixed)
    """
    ny, nx = fixed.shape
    idx = -np.ones((ny, nx), dtype=np.int64)
    act = np.flatnonzero(active.ravel())
    idx.ravel()[act] = np.arange(act.size)
    n = act.size
    known = ~np.isnan(fixed.ravel()[act])

    # Edge-difference operator D over 4-neighbour pairs of active cells.
    rows, cols, vals = [], [], []
    e = 0
    for dj, di in ((0, 1), (1, 0)):
        a = idx[: ny - dj, : nx - di]
        b = idx[dj:, di:]
        ok = (a >= 0) & (b >= 0)
        aa, bb = a[ok], b[ok]
        k = np.arange(aa.size) + e
        rows += [k, k]
        cols += [aa, bb]
        vals += [np.ones(aa.size), -np.ones(aa.size)]
        e += aa.size
    D = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(e, n))

    # 5-point Laplacian rows at cells whose 4 neighbours are all active.
    c = idx[1:-1, 1:-1]
    nb = [idx[:-2, 1:-1], idx[2:, 1:-1], idx[1:-1, :-2], idx[1:-1, 2:]]
    ok = c >= 0
    for q in nb:
        ok &= q >= 0
    cc = c[ok]
    m = cc.size
    k = np.arange(m)
    rows = [k] + [k] * 4
    cols = [cc] + [q[ok] for q in nb]
    vals = [-4 * np.ones(m)] + [np.ones(m)] * 4
    L = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(m, n))

    Q = (1 - tension) * (L.T @ L) + tension * (D.T @ D)
    Q = Q.tocsr()
    u = np.flatnonzero(~known)
    kk = np.flatnonzero(known)
    zk = fixed.ravel()[act][kk]
    A = Q[u][:, u].tocsc()
    b = -(Q[u][:, kk] @ zk)
    zu = spla.spsolve(A, b)

    z = np.full(n, np.nan)
    z[kk] = zk
    z[u] = zu
    out = np.full(ny * nx, np.nan)
    out[act] = z
    return out.reshape(ny, nx)


def build(lake: str, cell: float, tension: float):
    outline = shape(load_features(lake, "omkrets_dybdemalt")[0]["geometry"])
    x0, y0, nx, ny = grid_for(outline, cell)
    xc = x0 + (np.arange(nx) + 0.5) * cell
    yc = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xc, yc)
    inside = shapely.contains_xy(outline, X, Y)

    # Shoreline ring: cells just outside the water touching it -> depth 0.
    grow = inside.copy()
    grow[1:, :] |= inside[:-1, :]
    grow[:-1, :] |= inside[1:, :]
    grow[:, 1:] |= inside[:, :-1]
    grow[:, :-1] |= inside[:, 1:]
    shore = grow & ~inside

    fixed = np.full((ny, nx), np.nan)
    contours = rasterize_lines(load_features(lake, "dybdekurve"), x0, y0, cell, nx, ny)
    fixed[inside & ~np.isnan(contours)] = contours[inside & ~np.isnan(contours)]
    for f in load_features(lake, "dybdepunkt"):
        px, py = f["geometry"]["coordinates"][:2]
        i, j = int((px - x0) // cell), int((py - y0) // cell)
        if 0 <= i < nx and 0 <= j < ny and inside[j, i]:
            fixed[j, i] = f["properties"]["dybde_m"]
    fixed[shore] = 0.0

    t = time.time()
    depth = solve_tension_spline(fixed, grow, tension)
    print(f"solved {int(inside.sum())} lake cells in {time.time() - t:.1f}s")
    depth[~inside] = np.nan
    depth = np.clip(depth, 0, None).astype(np.float32)
    return depth, x0, y0, inside


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lake", default="altevatn")
    ap.add_argument("--cell", type=float, default=20.0)
    ap.add_argument("--tension", type=float, default=0.35)
    a = ap.parse_args()
    depth, x0, y0, inside = build(a.lake, a.cell, a.tension)
    out = ROOT / "data" / "processed" / f"{a.lake}_bathy{int(a.cell)}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, depth=depth, x0=x0, y0=y0, cell=a.cell)
    d = depth[inside]
    print(f"wrote {out.relative_to(ROOT)}  grid {depth.shape[1]}x{depth.shape[0]}  "
          f"max {np.nanmax(d):.1f} m  mean {np.nanmean(d):.1f} m  "
          f"volume {np.nansum(d) * a.cell ** 2 / 1e6:.0f} Mm3  area {inside.sum() * a.cell ** 2 / 1e6:.1f} km2")


if __name__ == "__main__":
    main()
