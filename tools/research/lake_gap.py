"""Nearest points between Altevatn (489 polygon) and Leinavatn polygon. Usage: python tools/lake_gap.py RAWDIR"""
import json, sys
from shapely.geometry import shape
from shapely.ops import nearest_points
from pyproj import Transformer
raw = sys.argv[1]
tr = Transformer.from_crs(25833, 4326, always_xy=True)
alt = shape(json.load(open(f"{raw}/altevatn_innsjo.geojson", encoding="utf-8"))["features"][0]["geometry"])
alt59 = shape(json.load(open(f"{raw}/altevatn_omkrets_dybdemalt.geojson", encoding="utf-8"))["features"][0]["geometry"])
d = json.load(open(f"{raw}/nve_vannkraft/lakes_leinavatn_geavdnja.geojson", encoding="utf-8"))
for f in d["features"]:
    g = shape(f["geometry"]); nm = f["properties"]["navn"]
    for lab, A in (("HRV489", alt), ("survey477", alt59)):
        a, b = nearest_points(A, g)
        print(nm, lab, "gap m %.0f" % a.distance(b), "alt pt", round(a.x), round(a.y), tr.transform(a.x, a.y), "lake pt", round(b.x), round(b.y))
# west end of polygons
for lab, A in (("HRV489", alt), ("survey477", alt59)):
    xs = [(x, y) for x, y in A.exterior.coords]
    w = min(xs); e = max(xs)
    print(lab, "westmost", [round(v) for v in w], tr.transform(*w), "eastmost", [round(v) for v in e], tr.transform(*e))
