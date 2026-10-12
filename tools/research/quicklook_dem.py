"""Quicklook PNG of a .npy/.json DEM with zero / nodata cells in red and optional GeoJSON overlay.
Usage: python -I tools/quicklook_dem.py BASE OUT.png [overlay.geojson ...]"""
import json
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

base, out = sys.argv[1], sys.argv[2]
a = np.load(base + ".npy")
m = json.load(open(base + ".json"))
ext = [m["x0"], m["x0"] + m["width"] * m["dx"], m["y0"] - m["height"] * m["dy"], m["y0"]]
nd = m.get("nodata")
bad = (a == 0) if nd is None else (a == nd)
v = np.where(bad, np.nan, a)
# hillshade
gy, gx = np.gradient(np.nan_to_num(v, nan=np.nanmean(v)), m["dy"], m["dx"])
az, alt = np.radians(315), np.radians(45)
slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
fig, ax = plt.subplots(figsize=(12, 12 * m["height"] / m["width"] + 0.5), dpi=110)
ax.imshow(v, extent=ext, cmap="terrain", vmin=0, vmax=np.nanpercentile(v, 99.5))
ax.imshow(hs, extent=ext, cmap="gray", alpha=0.35)
r = np.zeros(a.shape + (4,)); r[bad] = (1, 0, 0, 0.6)
ax.imshow(r, extent=ext)
for g in sys.argv[3:]:
    gj = json.load(open(g))
    for f in gj["features"]:
        geom = f["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"] if geom["type"] == "MultiPolygon" else []
        for poly in polys:
            for ring in poly:
                xy = np.array(ring)[:, :2]
                ax.plot(xy[:, 0], xy[:, 1], "b-", lw=0.6)
ax.set_title(f"{base}  red = exact 0 / nodata ({bad.mean()*100:.1f}%)")
fig.tight_layout(); fig.savefig(out)
print("wrote", out)
