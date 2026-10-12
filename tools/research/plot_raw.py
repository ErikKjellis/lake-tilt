"""Quick-look plot of the raw NVE data for Altevatnet."""
import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import shape

def load(n):
    return json.load(open(f"data/raw/altevatn_{n}.geojson", encoding="utf-8"))["features"]

fig, ax = plt.subplots(figsize=(16, 9), dpi=110)
reg = shape(load("innsjo")[0]["geometry"])
ax.fill(*reg.exterior.xy, color="#cfe3f5", lw=0, label="regulated (HRV 489)")
for r in reg.interiors:
    ax.fill(*r.xy, color="white", lw=0)
sur = shape(load("omkrets_dybdemalt")[0]["geometry"])
ax.plot(*sur.exterior.xy, color="k", lw=0.8, label="1959 survey shore")
for r in sur.interiors:
    ax.plot(*r.xy, color="k", lw=0.5)
cm = plt.get_cmap("viridis_r")
for f in load("dybdekurve"):
    g = shape(f["geometry"]); d = f["properties"]["dybde_m"]
    ax.plot(*g.xy, color=cm(d / 100), lw=0.6)
for f in load("dybdepunkt"):
    x, y = f["geometry"]["coordinates"][:2]
    ax.plot(x, y, "r.", ms=3); ax.annotate(str(f["properties"]["dybde_m"]), (x, y), fontsize=5)
ax.set_aspect("equal"); ax.legend(loc="upper right"); ax.grid(alpha=.3)
plt.tight_layout(); plt.savefig(sys.argv[1] if len(sys.argv) > 1 else "scratch/raw.png")
