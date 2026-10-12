"""Sample the 10 m DTM inside Altevatnet's regulated-lake polygon and the 1959 survey outline.
Usage: python -I tools/analyze_lake_dtm.py"""
import json
import numpy as np
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = "D:/Programmering/Lake tilt/"
a = np.load(ROOT + "data/raw/dtm/dtm10_altevatn.npy")
m = json.load(open(ROOT + "data/raw/dtm/dtm10_altevatn.json"))
x0, y0, d = m["x0"], m["y0"], m["dx"]


def sample(x, y):
    c = np.floor((np.asarray(x) - x0) / d).astype(int)
    r = np.floor((y0 - np.asarray(y)) / d).astype(int)
    return a[r, c]


def load(fn):
    gj = json.load(open(ROOT + fn))
    return unary_union([shape(f["geometry"]) for f in gj["features"]]), gj


lake, gj = load("data/raw/altevatn_innsjo.geojson")
print("regulated lake: area %.2f km2, props:" % (lake.area / 1e6), {k: v for k, v in gj["features"][0]["properties"].items() if k in ("hoyde", "areal_km2", "navn", "magasinNr", "vatnLnr")})
surv, _ = load("data/raw/altevatn_omkrets_dybdemalt.geojson")
print("survey outline area %.2f km2" % (surv.area / 1e6))

# cell centres
H, W = a.shape
xs = x0 + (np.arange(W) + 0.5) * d
ys = y0 - (np.arange(H) + 0.5) * d
XX, YY = np.meshgrid(xs, ys)
inside = shapely.contains_xy(lake.buffer(-30), XX, YY)
v = a[inside]
print("cells inside (30 m inset):", inside.sum())
vals, cnt = np.unique(np.round(v, 2), return_counts=True)
o = np.argsort(cnt)[::-1][:8]
print("most common values in lake:", [(float(vals[i]), int(cnt[i])) for i in o])
print("percentiles 1,5,50,95,99:", np.percentile(v, [1, 5, 50, 95, 99]).round(2))

# 20 points along the lake axis: points at regular distance along the polygon's long axis
pts = []
coords = np.array([(x, y) for x, y in zip(XX[inside], YY[inside])])
# principal axis
c0 = coords.mean(0)
u, s, vt = np.linalg.svd(coords - c0, full_matrices=False)
ax = vt[0] if vt[0][0] > 0 else -vt[0]
t = (coords - c0) @ ax
print("axis direction (unit, E,N):", ax.round(3), "azimuth %.1f deg" % np.degrees(np.arctan2(ax[0], ax[1])))
rng = np.random.default_rng(1)
rows = []
for q in np.linspace(0.01, 0.99, 20):
    tq = np.quantile(t, q)
    sel = np.flatnonzero(np.abs(t - tq) < 50)
    k = sel[rng.integers(sel.size)]
    x, y = coords[k]
    rows.append((q, x, y, float(sample(x, y))))
print(" frac_along     x          y        dtm_z")
for q, x, y, z in rows:
    print(f"  {q:5.2f}  {x:10.0f} {y:11.0f}  {z:8.2f}")

# map of lake-surface value classes: which value where?
for val in [float(vals[i]) for i in o[:4]]:
    msk = inside & (np.abs(a - val) < 0.005)
    if msk.sum():
        print(f"value {val}: {msk.sum()} cells, x range {XX[msk].min():.0f}-{XX[msk].max():.0f}, y {YY[msk].min():.0f}-{YY[msk].max():.0f}")

# survey-outline ring (1959 shoreline at stated level 477.0): DTM along it
ring = surv.boundary
L = ring.length
ps = [ring.interpolate(s) for s in np.linspace(0, L, 400, endpoint=False)]
zr = sample([p.x for p in ps], [p.y for p in ps])
print("DTM along 1959 survey shoreline: median %.2f, p10 %.2f, p90 %.2f" % tuple(np.percentile(zr, [50, 10, 90])))
outside_reg = [p for p in ps if not lake.contains(p)]
print("survey-shoreline points outside today's regulated polygon:", len(outside_reg), "of", len(ps))
