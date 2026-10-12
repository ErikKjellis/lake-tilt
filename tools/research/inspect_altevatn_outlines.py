"""Inspect Altevatn outline polygons: area, bounds, parts (EPSG:25833)."""
import json, sys
from shapely.geometry import shape
from pyproj import Transformer

base = sys.argv[1]
tr = Transformer.from_crs(25833, 4326, always_xy=True)
for name in ["altevatn_omkrets_dybdemalt", "altevatn_innsjo", "altevatn_dybdekart"]:
    try:
        d = json.load(open(f"{base}/{name}.geojson", encoding="utf-8"))
    except Exception as e:
        print(name, "ERR", e); continue
    print("===", name, len(d["features"]))
    for f in d["features"]:
        g = shape(f["geometry"]) if f["geometry"] else None
        props = {k: v for k, v in f["properties"].items() if v not in (None, "", " ")}
        print(props)
        if g is not None:
            print(" type", g.geom_type, "area km2 %.2f" % (g.area / 1e6), "bounds", [round(b) for b in g.bounds])
            if g.geom_type == "MultiPolygon":
                for p in sorted(g.geoms, key=lambda p: -p.area)[:6]:
                    c = p.centroid
                    print("   part %.3f km2 centroid" % (p.area / 1e6), round(c.x), round(c.y), tr.transform(c.x, c.y))
