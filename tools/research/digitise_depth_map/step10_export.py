import sys, json, pickle
sys.path.insert(0, sys.argv[1]); ROOT = sys.argv[2]
import numpy as np, shapely, shapely.geometry
from shapely.geometry import Polygon, mapping, Point
from scipy import ndimage as ndi
from skimage.measure import find_contours
g = json.load(open("georef.json")); a, b, tx, c, d, ty = g["utm_to_px"]
M = np.array([[a, b], [c, d]]); Minv = np.linalg.inv(M)
def px2utm(col, row):
    uv = Minv @ np.vstack([np.asarray(col) - tx, np.asarray(row) - ty])
    return 425000 + 1000 * uv[0], 7180000 + 1000 * uv[1]
lab = np.load("lab.npy"); exp = np.load("exp.npy"); Lm = np.load("levels.npy"); sk = np.load("sk.npy"); added = np.load("added.npy")
G = pickle.load(open("graph.pkl", "rb")); OUT = G["OUT"]
H, W = lab.shape
# --- survey outline (1946 shoreline at ~355 m) with the islands as holes
lake = ndi.binary_fill_holes(lab != 1)
lake[:, int(W * 0.92):] = False                     # drop title block / stamps
lk, n = ndi.label(lake); lake = lk == (1 + np.argmax(ndi.sum(lake, lk, range(1, n + 1))))
isl_mask = np.zeros_like(lake)
reg = np.load("reg.npy")
for r in G["isl"]: isl_mask |= reg == r
isl_mask = ndi.binary_opening(isl_mask & lake, iterations=2)
def rings(mask):
    out = []
    for cnt in find_contours(np.pad(mask, 1).astype(float), 0.5):
        rr, cc = cnt[:, 0] - 1, cnt[:, 1] - 1
        x, y = px2utm(cc, rr); p = Polygon(np.column_stack([x, y])).buffer(0)
        if p.area > 2e4: out.append(p)
    return out
outer = max(rings(lake), key=lambda p: p.area)
holes = [p for p in rings(isl_mask) if p.area > 5e4]
# islands: NVE's own island outlines (holes of the lake polygon) are better than the scan's
nve = shapely.geometry.shape(json.load(open(f"{ROOT}/data/raw/tunnsjoen_innsjo.geojson", encoding="utf-8"))["features"][0]["geometry"])
nve_islands = [Polygon(r) for r in nve.interiors]
survey = outer.difference(shapely.union_all(nve_islands)).simplify(5)
holes = nve_islands
print("survey area km2", round(survey.area / 1e6, 1), "islands", len(holes), [round(h.area / 1e6, 2) for h in holes])
# --- depth points along resolved contours
pts = []
skel = (sk | added) & lake & ~isl_mask
ys, xs = np.nonzero(skel)
sm = ndi.gaussian_filter(skel.astype(float), 2)
gy, gx = ndi.sobel(sm, 0), ndi.sobel(sm, 1)
keep = 0
for y, x in zip(ys[::2], xs[::2]):
    nv = np.array([gy[y, x], gx[y, x]]); nn = np.hypot(*nv)
    if nn < 1e-6: continue
    nv /= nn
    lv = []
    for s in (5, -5):
        yy, xx = int(round(y + s * nv[0])), int(round(x + s * nv[1]))
        if 0 <= yy < H and 0 <= xx < W and exp[yy, xx] not in (0, OUT): lv.append(int(Lm[yy, xx]))
    if len(lv) == 2 and abs(lv[0] - lv[1]) == 1 and min(lv) >= 0:
        pts.append((x, y, 10 + 20 * min(lv))); keep += 1
# --- steep-shore smears: merged contours between the shore and the first resolved band
ink2 = np.load("ink2.npy")
shore = (exp == OUT) | ~lake
resolved = (exp != OUT) & (exp != 0) & ~ink2 & (Lm >= 1)
ds = ndi.distance_transform_edt(~shore)
dd, (iy, ix_) = ndi.distance_transform_edt(~resolved, return_indices=True)
Lnear = Lm[iy, ix_]
smear = (len(sys.argv) > 3) & ink2 & lake & ~isl_mask & (Lnear >= 2) & (dd < 60) & (ds < 80)
# only where the band next to the shore is genuinely missing: nearest resolved level >= 2 and the smear touches the shore
sy, sx = np.nonzero(smear)
nsm = 0
for y, x in zip(sy[::3], sx[::3]):
    c_ = 10 + 20 * (int(Lnear[y, x]) - 1)
    dep = c_ * ds[y, x] / (ds[y, x] + dd[y, x])
    pts.append((x, y, round(float(dep), 1))); nsm += 1
print("smear points", nsm)
spots = json.load(open("spots.json"))
K = 1.725
feats = []
X, Y = px2utm([p[0] for p in pts], [p[1] for p in pts])
inside = shapely.contains_xy(survey, X, Y)
for xx, yy, (_, _, dd), ok in zip(X, Y, pts, inside):
    if ok: feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(xx, 1), round(yy, 1)]}, "properties": {"dybde_m": dd, "kilde": "kote"}})
for s in spots:
    xx, yy = px2utm([s["x"] * K], [s["y"] * K])
    feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(xx[0]), 1), round(float(yy[0]), 1)]}, "properties": {"dybde_m": s["d"], "kilde": "loddskudd"}})
print("contour points", int(inside.sum()), "of", len(pts), "spots", len(spots))
from collections import Counter; print(sorted(Counter(f["properties"]["dybde_m"] for f in feats if f["properties"]["kilde"] == "kote").items()))
note = "Digitised in this project from NVE's scanned depth map 696a.pdf (Tunnsjø, sounded by Olaf Ångaby 1946, ~355 m, 20 m contours from 10 m). Georeferenced by fitting the shoreline to NVE's lake polygon. Contour depths inferred from nesting; see tools/research/digitise_depth_map/README.md."
crs = {"type": "name", "properties": {"name": "EPSG:25833"}}
def fc(f): return {"type": "FeatureCollection", "crs": crs, "note": note, "features": f}
json.dump(fc(feats), open(f"{ROOT}/data/raw/tunnsjoen_dybdepunkt.geojson", "w", encoding="utf-8"))
json.dump(fc([]), open(f"{ROOT}/data/raw/tunnsjoen_dybdekurve.geojson", "w", encoding="utf-8"))
json.dump(fc([{"type": "Feature", "geometry": mapping(survey), "properties": {"vatnlnr": 696, "oppmaltvannstand_m": 355, "oppmaltaar": 1946}}]), open(f"{ROOT}/data/raw/tunnsjoen_omkrets_dybdemalt.geojson", "w", encoding="utf-8"))
print("written")
