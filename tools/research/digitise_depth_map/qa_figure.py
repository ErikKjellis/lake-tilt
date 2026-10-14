import json, sys
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import shape
ROOT = sys.argv[1]; S = sys.argv[2]
d = np.load(f"{ROOT}/data/processed/tunnsjoen_bathy20.npz"); dep = d["depth"]; x0 = float(d["x0"]); y0 = float(d["y0"]); c = float(d["cell"])
ny, nx = dep.shape
ext = [x0, x0 + nx * c, y0, y0 + ny * c]
pts = json.load(open(f"{ROOT}/data/raw/tunnsjoen_dybdepunkt.geojson", encoding="utf-8"))["features"]
P = np.array([f["geometry"]["coordinates"] + [f["properties"]["dybde_m"]] for f in pts])
fig, ax = plt.subplots(1, 2, figsize=(16, 7.5), constrained_layout=True)
from PIL import Image
g = np.load(f"{S}/dig/gray.npy")
ax[0].imshow(g, cmap="gray"); ax[0].set_title("NVE scanned depth map 696a.pdf (Ångaby 1946)"); ax[0].axis("off")
im = ax[1].imshow(dep, origin="lower", extent=ext, cmap="viridis_r", vmin=0, vmax=222)
ax[1].contour(np.arange(nx) * c + x0 + c / 2, np.arange(ny) * c + y0 + c / 2, np.nan_to_num(dep, nan=-1), levels=np.arange(10, 221, 20), colors="w", linewidths=0.5)
sc = ax[1].scatter(P[::8, 0], P[::8, 1], c=P[::8, 2], s=0.6, cmap="viridis_r", vmin=0, vmax=222, edgecolors="none")
for f in pts:
    if f["properties"].get("kilde") == "loddskudd":
        x, y = f["geometry"]["coordinates"]; ax[1].plot(x, y, "r+"); ax[1].annotate(f"{f['properties']['dybde_m']} m", (x, y), color="r", fontsize=8)
poly = shape(json.load(open(f"{ROOT}/data/raw/tunnsjoen_innsjo.geojson", encoding="utf-8"))["features"][0]["geometry"])
for r in [poly.exterior] + list(poly.interiors):
    xx, yy = r.xy; ax[1].plot(xx, yy, color="orange", lw=0.6)
ax[1].set_aspect("equal"); ax[1].set_title("Digitised: depth points (from contours) → tension-spline bathymetry, 20 m contours (white)\norange: NVE lake polygon (HRV); red: printed soundings used as anchors")
fig.colorbar(im, ax=ax[1], label="depth below 1946 survey level (≈ 355 m), m", shrink=0.8)
fig.savefig(f"{ROOT}/docs/tunnsjoen_digitisation_check.png", dpi=110)
print("ok")
