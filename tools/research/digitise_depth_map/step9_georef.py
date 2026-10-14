import json, sys
import numpy as np, shapely
from shapely.geometry import shape, Polygon
from scipy import ndimage as ndi
from scipy.optimize import minimize
ROOT = sys.argv[1]
lab = np.load("lab.npy"); exp = np.load("exp.npy")
G = __import__("pickle").load(open("graph.pkl", "rb"))
scan_lake = ndi.binary_fill_holes(lab != 1)
H, W = scan_lake.shape
poly = shape(json.load(open(f"{ROOT}/data/raw/tunnsjoen_innsjo.geojson", encoding="utf-8"))["features"][0]["geometry"])
ext = Polygon(poly.exterior) if poly.geom_type == "Polygon" else Polygon(max(poly.geoms, key=lambda g: g.area).exterior)
# exclude Litl-Tunnsjøen (not on the 1946 map): cut SE of the narrows at Tunnsjøen village
cut = shapely.box(435150, 7160000, 440000, 7174250)
ref = ext.difference(cut)
c = 40.0
x0, y0, x1, y1 = ref.buffer(2000).bounds
xs = np.arange(x0, x1, c) + c / 2; ys = np.arange(y1, y0, -c) - c / 2
X, Y = np.meshgrid(xs, ys)
R = shapely.contains_xy(ref, X, Y).astype(float)
soft = ndi.gaussian_filter(scan_lake.astype(float), 2)
def iou(p):
    a, b, tx, cc, d, ty = p   # utm -> scan px: col = a*X+b*Y+tx ; row = cc*X+d*Y+ty  (X,Y in km rel)
    u = (X - 425000) / 1000; v = (Y - 7180000) / 1000
    col = a * u + b * v + tx; row = cc * u + d * v + ty
    m = ndi.map_coordinates(soft, [row, col], order=1, cval=0)
    inter = (m * R).sum(); uni = m.sum() + R.sum() - inter
    return 1 - inter / uni
# initial: bbox match (north up)
rr, cc_ = np.nonzero(scan_lake[:, :int(W * 0.9)]); 
sx = (cc_.max() - cc_.min()) / ((ref.bounds[2] - ref.bounds[0]) / 1000)
sy = (rr.max() - rr.min()) / ((ref.bounds[3] - ref.bounds[1]) / 1000)
s0 = (sx + sy) / 2
p0 = [s0, 0, cc_.min() - s0 * (ref.bounds[0] - 425000) / 1000, 0, -s0, rr.min() + s0 * (ref.bounds[3] - 7180000) / 1000]
print("init IoU", 1 - iou(p0), "scale px/km", s0)
best = minimize(iou, p0, method="Nelder-Mead", options=dict(maxiter=6000, xatol=1e-4, fatol=1e-6))
for k in range(3):
    best = minimize(iou, best.x, method="Nelder-Mead", options=dict(maxiter=6000, xatol=1e-5, fatol=1e-7))
print("final IoU", 1 - best.fun, best.x)
a, b, tx, cc, d, ty = best.x
M = np.array([[a, b], [cc, d]]); Minv = np.linalg.inv(M)
print("pixel size m: %.2f x %.2f, rotation deg %.2f" % (1000 / np.hypot(a, cc), 1000 / np.hypot(b, d), np.degrees(np.arctan2(cc, a))))
json.dump({"utm_to_px": best.x.tolist(), "origin": [425000, 7180000], "iou": 1 - best.fun}, open("georef.json", "w"))
