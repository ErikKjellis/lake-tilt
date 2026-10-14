"""Screening-grade natural DEM + uplift grid for a multi-lake scene, in the formats paleolakes.py reads.

Unlike tools/natural_dem.py this needs no digital bathymetry and no reservoir reconstruction:
  * each lake polygon (NVE innsjo, regulated outline) is replaced by a placeholder bowl below its
    natural level: depth = min(max_depth * bowl_cap, bowl_slope * distance to shore). The palaeo
    spill levels depend on the sills, not on the bottom, so this is enough to find outlet switches;
    areas near the shore at low levels and volumes are not meaningful.
  * dams listed per lake are replaced by a sill plug: cells within `radius_m` are set to the natural
    level, so the lake spills there at exactly its natural level today (F = 0).
  * NKG2016LU_lev is sampled on a 1 km grid over the scene (same JSON layout as
    data/processed/uplift_rate_grid.json).

Usage: python -I tools/research/lake_screening/simple_natural_dem.py CONFIG.json
Config keys used: lake, dtm, cell_dem, uplift_grid, nkg_dir, screen_lakes[{file, natural_level_m,
max_depth_m, dams[{x, y, radius_m}]}], bowl_slope, bowl_cap.
"""
import json
import sys
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[3]


def uplift_grid(cfg, x0, x1, y0, y1):
    lat0, lon0 = 49.0, 0.0
    LAT, LON = lat0 + np.arange(313) / 12.0, lon0 + np.arange(301) / 6.0
    a = np.loadtxt(ROOT / cfg["nkg_dir"] / "NKG2016LU_lev.dat")
    g = np.full((313, 301), np.nan)
    g[np.rint((a[:, 0] - lat0) * 12).astype(int), np.rint((a[:, 1] - lon0) * 6).astype(int)] = a[:, 2]
    f = RegularGridInterpolator((LAT, LON), g)
    d = 1000.0
    xs, ys = np.arange(x0, x1 + 0.5, d), np.arange(y0, y1 + 0.5, d)
    X, Y = np.meshgrid(xs, ys)
    lon, lat = Transformer.from_crs("EPSG:25833", "EPSG:4258", always_xy=True).transform(X.ravel(), Y.ravel())
    lev = f(np.column_stack([lat, lon]))
    return dict(crs="EPSG:25833", x0=x0, y0=y0, dx=d, dy=d, nx=int(xs.size), ny=int(ys.size),
                values=[round(float(t), 4) for t in lev],
                model="NKG2016LU_lev (levelled land uplift), mm/yr",
                source_url="https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Landhojning/")


def main():
    cfg_path = Path(sys.argv[1])
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    meta = json.loads((ROOT / f"{cfg['dtm']}.json").read_text())
    a = np.load(ROOT / f"{cfg['dtm']}.npy").astype(np.float64)
    k = int(round(cfg["cell_dem"] / meta["dx"]))
    H, W = a.shape
    z = a[: H - H % k, : W - W % k].reshape(H // k, k, W // k, k).mean(axis=(1, 3))
    cell = float(cfg["cell_dem"])
    x0, y_top = meta["x0"], meta["y0"]
    ny, nx = z.shape
    xc = x0 + (np.arange(nx) + 0.5) * cell
    yc = y_top - (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xc, yc)
    masks = np.zeros(z.shape, np.uint8)

    for L in cfg["screen_lakes"]:
        poly = shape(json.loads((ROOT / L["file"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
        shapely.prepare(poly)
        inside = shapely.contains_xy(poly, X, Y)
        dist = ndimage.distance_transform_edt(inside) * cell
        depth = np.minimum(L["max_depth_m"] * cfg.get("bowl_cap", 0.6), cfg.get("bowl_slope", 0.05) * dist + 0.5)
        lvl = L["natural_level_m"]
        z[inside] = np.minimum(z[inside], lvl - depth[inside])
        masks[inside] |= 2
        print(f"{L['file']}: {int(inside.sum())} cells, level {lvl}, bowl max {depth[inside].max():.0f} m")
        for d in L.get("dams", []):
            near = np.hypot(X - d["x"], Y - d["y"]) <= d.get("radius_m", 150)
            before = float(z[near].max())
            z[near] = lvl  # sill plug: the dam site becomes a natural threshold at the natural level
            masks[near] |= 16  # not bit 3: paleolakes.py would take the block minimum there
            print(f"  dam {d.get('name', '')}: {int(near.sum())} cells, max {before:.1f} -> {float(z[near].max()):.1f}")

    out = ROOT / "data" / "processed" / f"{cfg['lake']}_natural{int(cell)}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, z=z.astype(np.float32), x0=x0, y_top=y_top, cell=cell, masks=masks)
    print("wrote", out.relative_to(ROOT))

    grid = uplift_grid(cfg, x0, x0 + nx * cell, y_top - ny * cell, y_top)
    (ROOT / cfg["uplift_grid"]).write_text(json.dumps(grid), encoding="utf-8")
    v = np.array(grid["values"])
    print("wrote", cfg["uplift_grid"], f"lev {v.min():.2f}..{v.max():.2f} mm/yr")


if __name__ == "__main__":
    main()
