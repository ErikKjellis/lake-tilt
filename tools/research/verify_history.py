"""Independent geometric check of Altevatn outlet / dam claims.

Usage (from anywhere; data paths are passed as arguments, nothing is imported
from the data directories):

    .venv/Scripts/python -I tools/verify_history.py "D:/Programmering/Lake tilt/data/raw"

Checks
  1. Where the claimed natural outlet (Kartverket 'Luspi', Os), the NVE dam
     points/lines and other places fall relative to
       a) the present regulated lake polygon  (altevatn_innsjo.geojson, HRV 489)
       b) the 1959 surveyed outline           (altevatn_omkrets_dybdemalt.geojson, 477 m)
     -> inside/outside, distance to boundary, along-axis chainage from the NW end.
  2. West (NW) extent of the 1959 outline and of the 0 m / 5 m contours.
  3. Lat/lon <-> UTM33 consistency of the quoted coordinates.
  4. A DTM (NN2000) profile along the old Barduelva course dam -> Luspi -> 1959 W end.
All coordinates EPSG:25833 (ETRS89 / UTM 33N).
"""
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiPoint, Point, shape
from shapely.ops import unary_union

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/Programmering/Lake tilt/data/raw")


def load(fn):
    with open(RAW / fn, encoding="utf-8") as f:
        return json.load(f)


present = unary_union([shape(f["geometry"]) for f in load("altevatn_innsjo.geojson")["features"]])
survey = unary_union([shape(f["geometry"]) for f in load("altevatn_omkrets_dybdemalt.geojson")["features"]])
contours = [(f["properties"].get("dybde_m"), shape(f["geometry"])) for f in load("altevatn_dybdekurve.geojson")["features"]]
soundings = [(f["properties"].get("dybde_m"), shape(f["geometry"])) for f in load("altevatn_dybdepunkt.geojson")["features"]]

print(f"present lake area {present.area/1e6:.2f} km2, bounds {[round(v) for v in present.bounds]}")
print(f"1959 outline area {survey.area/1e6:.2f} km2, bounds {[round(v) for v in survey.bounds]}")
print(f"present-lake area outside the 1959 outline: {present.difference(survey).area/1e6:.2f} km2;"
      f" 1959 outline outside present lake: {survey.difference(present).area/1e6:.3f} km2")

# principal axis of the present lake (PCA of densified boundary)
ext = present.exterior if present.geom_type == "Polygon" else max(present.geoms, key=lambda g: g.area).exterior
pts = np.array([ext.interpolate(d).coords[0] for d in np.arange(0, ext.length, 50.0)])
c = pts.mean(axis=0)
_, _, vt = np.linalg.svd(pts - c, full_matrices=False)
ax = vt[0]
if ax[0] < 0:  # make the axis point ESE (towards increasing easting)
    ax = -ax
perp = np.array([-ax[1], ax[0]])
proj = (pts - c) @ ax
nw_end = pts[np.argmin(proj)]
se_end = pts[np.argmax(proj)]
az = (np.degrees(np.arctan2(ax[0], ax[1])) + 360) % 360
print(f"lake axis azimuth {az:.1f} deg (from N, pointing ESE); length along axis {(proj.max()-proj.min())/1000:.2f} km")
print(f"present-lake NW extreme vertex {nw_end.round(0)}, SE extreme vertex {se_end.round(0)}")

spts = np.array([survey.exterior.interpolate(d).coords[0] for d in np.arange(0, survey.exterior.length, 50.0)])
sproj = (spts - c) @ ax
s_nw = spts[np.argmin(sproj)]
s_se = spts[np.argmax(sproj)]
print(f"1959 outline NW extreme {s_nw.round(0)} (chainage {(sproj.min()-proj.min())/1000:.2f} km from present NW end);"
      f" SE extreme {s_se.round(0)} (chainage {(sproj.max()-proj.min())/1000:.2f} km)")


def chain(xy):
    v = np.asarray(xy) - c
    return (v @ ax - proj.min()) / 1000.0, (v @ perp) / 1000.0


to_ll = Transformer.from_crs(25833, 4326, always_xy=True)
to_utm = Transformer.from_crs(4326, 25833, always_xy=True)

places = {
    # name: (x, y, quoted_lat, quoted_lon)
    "Luspi (Kartverket Os, claimed natural outlet)": (659376.83, 7621476.10, 68.65942, 18.92661),
    "Dam 1015 Altevatn point (NVE)": (657768.72, 7620977.70, 68.65588, 18.88633),
    "Dam 1015 line start (NVE)": (657679.05, 7621227.48, 68.65816, 18.88452),
    "Dam 1015 line end (NVE)": (657808.17, 7620714.96, None, None),
    "Dam 1016 overflow point (NVE)": (657936.73, 7620752.50, 68.65377, 18.89011),
    "Straumen (claimed)": (667672, 7618528, 68.62818, 19.12547),
    "Slåttmoberget intake (claimed)": (657678, 7621268, 68.65853, 18.88455),
    "scene_config outlet (660240,7621665)": (660240, 7621665, None, None),
    "Storfossen head (claimed)": (656767, 7620710, 68.65405, 18.86131),
    "Task NW end guess (657700,7621200)": (657700, 7621200, None, None),
}

print("\n--- places vs polygons ---")
for name, (x, y, qlat, qlon) in places.items():
    p = Point(x, y)
    lon, lat = to_ll.transform(x, y)
    s = f"{name}: lat {lat:.5f} lon {lon:.5f}"
    if qlat is not None:
        qx, qy = to_utm.transform(qlon, qlat)
        s += f" | quoted ({qlat},{qlon}) -> UTM {qx:.0f},{qy:.0f}, mismatch {np.hypot(qx-x, qy-y):.0f} m"
    ch, off = chain((x, y))
    s += (f"\n    chainage {ch:6.2f} km, lateral {off:+.2f} km | present lake: "
          f"{'INSIDE' if present.contains(p) else 'outside'} (dist to shore {present.exterior.distance(p):.0f} m)"
          f" | 1959 outline: {'INSIDE' if survey.contains(p) else 'outside'} (dist {survey.distance(p) if not survey.contains(p) else survey.exterior.distance(p):.0f} m)")
    print(s)

# distance between Luspi and dam, and Luspi and 1959 W end
lus = np.array([659376.83, 7621476.10])
dam = np.array([657768.72, 7620977.70])
print(f"\nLuspi -> dam 1015 point: {np.hypot(*(lus-dam)):.0f} m; Luspi -> 1959 NW extreme: {np.hypot(*(lus-s_nw)):.0f} m")
print(f"Luspi -> Straumen: {np.hypot(*(lus-np.array([667672, 7618528]))):.0f} m")

# western-most contour vertices by depth
print("\n--- NW-most extent of depth contours (chainage from present NW end) ---")
by_depth = {}
tip = {}
for dep, g in contours:
    geoms = [g] if g.geom_type == "LineString" else list(getattr(g, "geoms", [g]))
    for gg in geoms:
        arr = np.asarray(gg.coords)[:, :2]
        ch_arr = ((arr - c) @ ax - proj.min()) / 1000.0
        i = int(np.argmin(ch_arr))
        if ch_arr[i] < by_depth.get(dep, 1e9):
            by_depth[dep] = ch_arr[i]
            tip[dep] = arr[i]
for dep in sorted(by_depth)[:6]:
    print(f"  {dep:3} m contour: NW-most chainage {by_depth[dep]:.2f} km at {tip[dep].round(0)}")
# natural shoreline = 1.2 m depth line if survey stage 477.0 and natural 475.8 are in the same datum
w = 1.2 / 2.0
t12 = tip[0] + w * (tip[2] - tip[0])
print(f"  interpolated 1.2 m-depth (natural shoreline) NW tip ~ {t12.round(0)}, chainage {chain(t12)[0]:.2f} km")

near = sorted(((Point(lus).distance(g), dep, g.x, g.y) for dep, g in soundings))[:5]
print("nearest soundings to Luspi:", [(round(d), dep, round(x), round(y)) for d, dep, x, y in near])

# DTM profile along the old Barduelva course (NN2000 heights; over water = water surface at lidar time)
meta = json.load(open(RAW / "dtm/dtm10_altevatn.json", encoding="utf-8"))
dem = np.load(RAW / "dtm/dtm10_altevatn.npy", allow_pickle=False)


def sample(x, y):
    col = int((x - meta["x0"]) / meta["dx"])
    row = int((meta["y0"] - y) / meta["dy"])
    if 0 <= row < dem.shape[0] and 0 <= col < dem.shape[1]:
        return float(dem[row, col])
    return float("nan")


prof = LineString([(656767, 7620710), (657768, 7620978), (659377, 7621476), (s_nw[0], s_nw[1])])
print("\n--- DTM10 (NN2000) profile Storfossen head -> dam -> Luspi -> 1959 W end ---")
for d in np.arange(0, prof.length + 1, 250.0):
    q = prof.interpolate(d)
    print(f"  {d:6.0f} m  ({q.x:.0f},{q.y:.0f})  z={sample(q.x, q.y):7.2f}  in_present={present.contains(q)}  in_1959={survey.contains(q)}")

# DTM water-surface statistics inside the present lake (lidar-time reservoir level)
ys, xs = np.mgrid[0:dem.shape[0]:20, 0:dem.shape[1]:20]
X = meta["x0"] + (xs + 0.5) * meta["dx"]
Y = meta["y0"] - (ys + 0.5) * meta["dy"]
inside = np.array([present.contains(Point(a, b)) for a, b in zip(X.ravel(), Y.ravel())])
z = dem[ys, xs].ravel()[inside]
print(f"\nDTM10 inside present lake (subsampled n={inside.sum()}): median {np.median(z):.2f}, p5 {np.percentile(z,5):.2f}, p95 {np.percentile(z,95):.2f} m NN2000")
