"""Plot HRV polygon, 1959 survey outline, Leinavatn and key points. Usage: python tools/plot_outlines.py RAWDIR OUTPNG [xmin xmax ymin ymax]"""
import json, sys
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import shape
raw, out = sys.argv[1], sys.argv[2]
def geoms(fn):
    d = json.load(open(fn, encoding="utf-8"))
    return [shape(f["geometry"]) for f in d["features"] if f["geometry"]]
fig, ax = plt.subplots(figsize=(16, 8))
for g in geoms(f"{raw}/altevatn_innsjo.geojson"):
    x, y = g.exterior.xy; ax.fill(x, y, color="#cfe3f7", label="HRV 489 (NVE)")
for g in geoms(f"{raw}/nve_vannkraft/lakes_leinavatn_geavdnja.geojson"):
    x, y = g.exterior.xy; ax.fill(x, y, color="#e7d7f7")
cont = json.load(open(f"{raw}/altevatn_dybdekurve.geojson", encoding="utf-8"))
for f in cont["features"]:
    d = f["properties"].get("dybde_m"); g = shape(f["geometry"])
    if d in (0, 2):
        for ln in (g.geoms if hasattr(g, "geoms") else [g]):
            x, y = ln.xy; ax.plot(x, y, color="k" if d == 0 else "r", lw=0.5)
for g in geoms(f"{raw}/altevatn_omkrets_dybdemalt.geojson"):
    x, y = g.exterior.xy; ax.plot(x, y, color="b", lw=0.8)
pts = {"Luspi": (659377, 7621476), "dam": (657769, 7620978), "Straumen": (667672, 7618528),
       "Gjeddebukta": (693092, 7604747), "Andersholmen": (691971, 7606530), "Leinavatn outlet": (692436, 7604368)}
for k, (x, y) in pts.items():
    ax.plot(x, y, "k^"); ax.annotate(k, (x, y), fontsize=8)
ax.set_aspect("equal")
if len(sys.argv) > 6:
    ax.set_xlim(float(sys.argv[3]), float(sys.argv[4])); ax.set_ylim(float(sys.argv[5]), float(sys.argv[6]))
plt.savefig(out, dpi=110, bbox_inches="tight")
