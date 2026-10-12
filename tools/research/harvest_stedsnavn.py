"""Harvest Kartverket place names along Altevatn axis via /punkt radius search.
Usage: python tools/harvest_stedsnavn.py OUTDIR
"""
import json, sys, time, urllib.request, urllib.parse
from pyproj import Transformer

out = sys.argv[1]
tr = Transformer.from_crs(25833, 4258, always_xy=True)
# sample points along axis, NW end -> SE end, plus some off-axis
pts = []
x0, y0, x1, y1 = 655000, 7622500, 700000, 7607000
n = 16
for i in range(n + 1):
    t = i / n
    pts.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0)))
allnames = {}
for (x, y) in pts:
    lon, lat = tr.transform(x, y)
    for side in (1, 2, 3):
        q = urllib.parse.urlencode({"nord": round(lat, 5), "ost": round(lon, 5), "koordsys": 4258,
                                    "radius": 5000, "treffPerSide": 500, "side": side, "utkoordsys": 4258})
        url = "https://ws.geonorge.no/stedsnavn/v1/punkt?" + q
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                d = json.load(r)
        except Exception as e:
            print("ERR", url, e); break
        for nm in d.get("navn", []):
            allnames[nm["stedsnummer"]] = nm
        md = d.get("metadata", {})
        if md.get("viserTil", 0) >= md.get("totaltAntallTreff", 0):
            break
        time.sleep(0.2)
json.dump(list(allnames.values()), open(f"{out}/altevatn_stedsnavn.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("total", len(allnames))
