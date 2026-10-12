"""Depth contours/points near a location in the 1959 survey. Usage: python tools/straumen_depths.py RAWDIR X Y R"""
import json, sys
from shapely.geometry import shape, Point
raw, X, Y, R = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
p = Point(X, Y)
cont = json.load(open(f"{raw}/altevatn_dybdekurve.geojson", encoding="utf-8"))
res = {}
for f in cont["features"]:
    g = shape(f["geometry"]); d = f["properties"].get("dybde_m")
    dist = g.distance(p)
    if dist < R:
        res.setdefault(d, []).append(round(dist))
for d in sorted(res, key=lambda v: (v is None, v)):
    print("contour", d, "m: distances", sorted(res[d])[:5])
pts = json.load(open(f"{raw}/altevatn_dybdepunkt.geojson", encoding="utf-8"))
for f in pts["features"]:
    g = shape(f["geometry"])
    if g.distance(p) < R * 3:
        print("point", {k: v for k, v in f["properties"].items() if "dyb" in k.lower()}, round(g.x), round(g.y), round(g.distance(p)))
